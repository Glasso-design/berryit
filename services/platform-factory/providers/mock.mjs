import { FactoryError, hash, requireOwned } from '../contract.mjs';

/** Deterministic durable provider simulator. No fetch, SSH, Docker or email. */
export class MockProvider {
  mode='MOCK';
  constructor({db,capabilities={},faults={},localSteps={}}) {
    this.db=db;this.capabilities={tenant:true,standalone:true,standaloneEligible:true,standaloneRemaining:5,managed:true,region:'eu',capacity:true,verifiedDomain:true,verifiedEmail:true,transactional:true,mailbox:false,identityLinked:true,...capabilities};
    this.faults=faults;this.localSteps=localSteps;
  }
  async preflight(job) {
    if(!this.capabilities.capacity)return {allowed:false,code:'BLOCKED_RUNTIME_CAPACITY'};
    if(job.input.region!==this.capabilities.region&&!(job.input.region==='eea'&&this.capabilities.region==='eu'))return {allowed:false,code:'BLOCKED_DATA_RESIDENCY'};
    const cents=this.capabilities.monthlyCostCents??0;
    if(!Number.isSafeInteger(cents)||cents<0||cents>job.input.monthlyBudgetCents)return {allowed:false,code:'BLOCKED_COST_APPROVAL'};
    return {allowed:true,estimate:{mode:'MOCK',monthlyCents:cents,liveEstimateUnknown:true,freeStoragePerInstance:false}};
  }
  async ensure(context) {
    const {job,step,idempotencyKey}=context;const c=this.capabilities;
    if(step==='account') {
      const m=job.input.accountMode;
      if(m==='DEDICATED_MANAGED'&&!c.tenant)throw new FactoryError('BLOCKED_CLOUDFLARE_ACCOUNT','Tenant-behörighet saknas. Ingen tyst nedgradering.');
      if(m==='LIMITED_STANDALONE'&&(!c.standalone||!c.standaloneEligible||c.standaloneRemaining<=0))throw new FactoryError('BLOCKED_CLOUDFLARE_ACCOUNT','Standalone-behörighet eller kontokapacitet saknas.');
      if(m==='MANAGED_RESOURCE_ISOLATION'&&!c.managed)throw new FactoryError('BLOCKED_CLOUDFLARE_ACCOUNT','Godkänd resursisolering saknas.');
    }
    if(step==='domain'&&!c.verifiedDomain)throw new FactoryError('WAITING_DOMAIN_OWNERSHIP','Domänägarskap har inte verifierats.');
    if(step==='identity'&&!c.identityLinked)throw new FactoryError('WAITING_IDENTITY_LINK','Betrodd ONARLY-identitetsrelation saknas. Ingen ny ONARLY-användare skapas.');
    if(step==='email'&&job.input.emailMode!=='none') {
      if(!c.verifiedEmail)throw new FactoryError('WAITING_EMAIL_VERIFICATION','Mottagaren är inte verifierad.');
      if(job.input.emailMode==='mailbox'&&!c.mailbox)throw new FactoryError('BLOCKED_MAILBOX_PROVIDER','Routing är inte en mailbox.');
      if(job.input.emailMode==='transactional'&&!c.transactional)throw new FactoryError('BLOCKED_TRANSACTIONAL_EMAIL','Godkänd sändarleverantör saknas.');
    }
    if(this.faults[step]==='before')throw new FactoryError('TIMEOUT','Syntetiskt provider-timeout',true);
    const found=(await this.db.query('select data from factory.mock_resources where idempotency_key=$1',[idempotencyKey])).rows[0];
    if(found)return requireOwned(found.data,job,step);
    const resource={id:`mock-${step}-${hash(idempotencyKey).slice(0,24)}`,provider:'mock',jobId:job.id,instanceId:job.instance_id,step,
      evidence:{mode:'MOCK',owner:job.instance_id,accountMode:job.input.accountMode,dedicatedAccount:job.input.accountMode!=='MANAGED_RESOURCE_ISOLATION',verified:false}};
    if(this.localSteps[step])resource.evidence.local=await this.localSteps[step](context,resource);
    if(step==='email')resource.evidence.email={mode:job.input.emailMode,fullMailbox:job.input.emailMode==='mailbox',sent:false};
    if(step==='quota')resource.evidence.quotaBytes=job.input.storageQuotaBytes;
    await this.db.query(`insert into factory.mock_resources(idempotency_key,job_id,instance_id,step,data) values($1,$2,$3,$4,$5::jsonb)
      on conflict(idempotency_key) do nothing`,[idempotencyKey,job.id,job.instance_id,step,JSON.stringify(resource)]);
    const stored=(await this.db.query('select data from factory.mock_resources where idempotency_key=$1',[idempotencyKey])).rows[0].data;
    if(this.faults[step]==='after')throw new FactoryError('TIMEOUT','Provider committed before timeout; retry must reconcile',true);
    return requireOwned(stored,job,step);
  }
  async verify({job,step,resource}) {
    requireOwned(resource,job,step);
    const actual=(await this.db.query('select data from factory.mock_resources where job_id=$1 and step=$2',[job.id,step])).rows;
    if(actual.length!==1||actual[0].data.id!==resource.id)throw new FactoryError('UNVERIFIED_RESOURCE','Syntetiskt providerunderlag saknas.');
    return {...resource.evidence,mode:'MOCK',verified:true,method:'durable-provider-lookup',resourceId:resource.id};
  }
  async cleanupPreview({job}) {
    const resources=(await this.db.query('select step,data from factory.mock_resources where job_id=$1',[job.id])).rows;
    for(const r of resources)requireOwned(r.data,job,r.step);
    return {executionMode:'MOCK',deleted:false,requiresManualReview:true,resources:resources.map(r=>({id:r.data.id,step:r.step,action:'REVIEW_ONLY'}))};
  }
  async operation({operation}) {throw new FactoryError('WAITING_OPERATION_APPROVAL',`${operation} kräver separat resurs-, ägarskaps- och återställningsverifiering. Ingen automatisk åtgärd.`);}
}
