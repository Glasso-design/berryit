import { FactoryError, PROVIDER_KINDS, requireOwned, safeEvidence,orderChecklist } from './contract.mjs';
import { setTimeout as delay } from 'node:timers/promises';

/** Durable jobs + fenced leases. No browser timers, arbitrary shell or provider
 * credentials. Every provider step is preceded by current SQL authorization. */
export class FactoryEngine {
  constructor({store,registry,provider,clock=()=>new Date(),afterResource=null}) {Object.assign(this,{store,registry,provider,clock,afterResource});}
  async run(jobId) {
    if(this.provider.mode!=='MOCK')throw new FactoryError('LIVE_PROVIDER_DISABLED','Detta lokala paket tillåter inte verklig molnprovisionering.');
    let job=await this.store.claim(jobId);if(!job)return {claimed:false};
    const adapter=this.registry.get(job.input.productId,job.input.version);
    let checks=orderChecklist(structuredClone(job.checklist));let transient=false,manualRecovery=false;
    const providerPreflight=await this.provider.preflight(job);
    if(!providerPreflight.allowed) {
      job=await this.store.save(job,'BLOCKED',checks,providerPreflight.code);
      return {claimed:true,state:job.state,blocker:providerPreflight.code};
    }
    for(const check of checks) {
      if(check.type!=='AUTO'||check.status==='VERIFIED'||check.status==='NOT_APPLICABLE')continue;
      if(!PROVIDER_KINDS.includes(check.id))throw new FactoryError('INVALID_ADAPTER','Okänd teknisk provideroperation.');
      if(check.dependsOn.some(id=>checks.find(c=>c.id===id)?.status!=='VERIFIED'))continue;
      check.status='IN_PROGRESS';check.error=null;
      // SQL rechecks role revocation, expiry, account and live aal2 session here.
      job=await this.store.save(job,'PROVISIONING',checks);
      const context={job,step:check.id,idempotencyKey:`factory-${job.id}-${check.id}`,template:adapter.template,provider:this.provider};
      try {
        // Reconciliation is mandatory after a crash/timeout. Providers return
        // the already owned resource under the SAME stable idempotency key.
        const resource=requireOwned(await adapter.reconcile(context),job,check.id);
        await this.store.record(job,check.id,resource);
        if(this.afterResource)await this.afterResource(context,resource);
        const evidence=await adapter.verify({...context,resource});
        if(evidence?.verified!==true||evidence.mode!=='MOCK')throw new FactoryError('UNVERIFIED_RESOURCE','Providern saknar verifierbart underlag.');
        check.status='VERIFIED';check.verifiedAt=this.clock().toISOString();check.evidence=safeEvidence(evidence);
      } catch(error) {
        if(error.code==='TEST_PROCESS_CRASH')throw error;
        const known=error instanceof FactoryError;
        check.status=known&&error.code.startsWith('WAITING_')?'WAITING_FOR_PROVIDER':'BLOCKED';
        check.error=known?error.code:'PROVIDER_FAILURE';
        check.evidence={mode:'MOCK',verified:false};
        transient||=known&&error.retryable;manualRecovery||=error.code==='MANUAL_RECOVERY'||error.code==='RESOURCE_OWNERSHIP_MISMATCH';
      }
      job=await this.store.save(job,'PROVISIONING',checks);
    }
    const remaining=checks.filter(c=>c.required&&!['VERIFIED','NOT_APPLICABLE'].includes(c.status));
    const state=manualRecovery?'MANUAL_RECOVERY':transient?'RETRYABLE_FAILURE':remaining.some(c=>c.type==='AUTO')?'BLOCKED':remaining.length?'WAITING_FOR_EXTERNAL':'READY';
    if(state==='READY')job=await this.store.save(job,'VERIFYING',checks);
    job=await this.store.save(job,state,checks,remaining.map(c=>c.id+':'+(c.error??c.status)).join(',')||null);
    return {claimed:true,state:job.state,executionMode:'MOCK',liveProvisioning:false,remaining:remaining.map(c=>c.id)};
  }
}

export async function runWorker({engine,queue,signal,intervalMs=1000}) {
  if(intervalMs<100)throw new Error('Worker polling interval too small');
  while(!signal.aborted){for(const id of await queue()) {if(signal.aborted)break;await engine.run(id);}try{await delay(intervalMs,undefined,{signal});}catch(error){if(error.name!=='AbortError')throw error;}}
}
