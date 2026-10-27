import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.mjs';
import { FactoryEngine } from '../engine.mjs';
import { MockProvider } from '../providers/mock.mjs';
import { FactoryError } from '../contract.mjs';
import { assertIsolatedPgliteEnvironment } from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);

test('MOCK provisioning is durable, scoped, resumable and never claims live deployment',async t=>{
 const f=await fixture();const {db,ids,rpc,create,request,store,registry}=f;
 const provider=new MockProvider({db});const engine=new FactoryEngine({store,registry,provider});
 const resume=id=>rpc(ids.adminA,'factory_resume',[id]);
 const finishManual=async id=>{for(const step of ['company','pricing'])await rpc(ids.adminA,'factory_manual',[id,step,'Synthetic review, no pilot/customer data']);};
 try {
  const job=await create();
  await t.test('technical steps proceed while external/manual requirements block activation',async()=>{
   const result=await engine.run(job);assert.equal(result.state,'WAITING_FOR_EXTERNAL');
   assert.deepEqual(result.remaining,['company','pricing']);
   const data=await rpc(ids.adminA,'factory_snapshot',[job]);assert.equal(data.instance.execution_mode,'MOCK');
   assert.equal(data.resources.length,13);assert.equal(data.job.checklist.filter(c=>c.type==='AUTO').every(c=>c.evidence.mode==='MOCK'&&c.evidence.verified),true);
  });
  await t.test('manual completion and resumed job preserve all provider IDs',async()=>{
   const before=(await rpc(ids.adminA,'factory_snapshot',[job])).resources.map(x=>x.id).sort();
   await finishManual(job);await resume(job);const result=await engine.run(job);assert.equal(result.state,'READY');assert.equal(result.liveProvisioning,false);
   const after=await rpc(ids.adminA,'factory_snapshot',[job]);assert.deepEqual(after.resources.map(x=>x.id).sort(),before);assert.equal(after.instance.status,'SIMULATED');
   assert.ok(after.audit.some(x=>x.action==='factory.manual_attestation'));assert.ok(after.audit.some(x=>x.action==='factory.claimed'));
  });
  await t.test('two concurrent workers cannot both claim one job',async()=>{
   const id=await create();const results=await Promise.all([engine.run(id),engine.run(id)]);assert.equal(results.filter(x=>x.claimed).length,1);
   assert.equal((await db.query('select count(*) n from factory.resources where job_id=$1',[id])).rows[0].n,13);
  });
  await t.test('timeout AFTER provider commit reconciles the same resource on retry',async()=>{
   const id=await create();provider.faults.account='after';assert.equal((await engine.run(id)).state,'RETRYABLE_FAILURE');
   const owned=(await db.query("select data from factory.mock_resources where job_id=$1 and step='account'",[id])).rows[0].data.id;
   delete provider.faults.account;await resume(id);await engine.run(id);
   const data=await rpc(ids.adminA,'factory_snapshot',[id]);assert.equal(data.resources.find(x=>x.step==='account').id,owned);
   assert.equal((await db.query("select count(*) n from factory.mock_resources where job_id=$1 and step='account'",[id])).rows[0].n,1);
  });
  await t.test('crash after record survives worker restart; expired lease is fenced',async()=>{
   const id=await create();let first=true;
   const crashing=new FactoryEngine({store,registry,provider,afterResource:async()=>{if(first){first=false;throw new FactoryError('TEST_PROCESS_CRASH','Synthetic crash');}}});
   await assert.rejects(crashing.run(id));
   const stale=(await db.query('select * from factory.jobs where id=$1',[id])).rows[0];
   await db.query("update factory.jobs set lease_until=now()-interval '1 second' where id=$1",[id]);
   await engine.run(id);
   await assert.rejects(store.scalar('factory_worker_save',[id,stale.lease_token,stale.revision,'READY','[]',null]));
   assert.equal((await db.query('select count(*) n from factory.mock_resources where job_id=$1',[id])).rows[0].n,13);
  });
  // Avoid sharing a rate-limit window with the next independent scenarios.
  await db.exec("update factory.jobs set created_at=now()-interval '2 hours'");
  await t.test('dedicated account requirement never silently falls back to shared',async()=>{
   const id=await create();provider.capabilities.tenant=false;assert.equal((await engine.run(id)).state,'BLOCKED');
   const data=await rpc(ids.adminA,'factory_snapshot',[id]);assert.equal(data.job.checklist.find(c=>c.id==='account').error,'BLOCKED_CLOUDFLARE_ACCOUNT');
   assert.ok(data.resources.some(r=>r.step==='database'));assert.ok(!data.resources.some(r=>r.step==='account'));
   provider.capabilities.tenant=true;
  });
  await t.test('unverified email, domain and mailbox capabilities remain blocked',async()=>{
   const id=await create(request({emailMode:'mailbox'}));await engine.run(id);
   assert.equal((await rpc(ids.adminA,'factory_snapshot',[id])).job.checklist.find(c=>c.id==='email').error,'BLOCKED_MAILBOX_PROVIDER');
  });
  await t.test('cost and region preflight create no provider resources',async()=>{
   const id=await create(request({monthlyBudgetCents:1}));provider.capabilities.monthlyCostCents=2;
   assert.equal((await engine.run(id)).blocker,'BLOCKED_COST_APPROVAL');delete provider.capabilities.monthlyCostCents;
   assert.equal((await db.query('select count(*) n from factory.mock_resources where job_id=$1',[id])).rows[0].n,0);
   const region=await create(request({region:'us'}));assert.equal((await engine.run(region)).blocker,'BLOCKED_DATA_RESIDENCY');
  });
  await t.test('revoked initiating role prevents the NEXT provider operation',async()=>{
   const id=await create();let count=0;
   const revoking=new FactoryEngine({store,registry,provider,afterResource:async()=>{count++;await db.query('update public.support_role_grants set revoked_at=now(),revoked_by=$1,revoke_reason=$2 where grantee_id=$3',[ids.owner,'Synthetic live revoke',ids.adminA]);}});
   await assert.rejects(revoking.run(id),e=>e.code==='AUTHORIZATION_REVOKED');assert.equal(count,1);
   assert.equal((await db.query('select state from factory.jobs where id=$1',[id])).rows[0].state,'BLOCKED');
  });
  await t.test('cleanup is a scoped review, never an automatic delete',async()=>{
   const row=(await db.query('select * from factory.jobs where id=$1',[job])).rows[0];
   const before=(await db.query('select count(*) n from factory.mock_resources')).rows[0].n;
   const result=await f.adapter.safeCleanup({job:row,provider});assert.equal(result.deleted,false);assert.equal(result.requiresManualReview,true);
   await assert.rejects(provider.verify({job:row,step:'account',resource:{id:'other',jobId:randomUUID(),instanceId:row.instance_id,step:'account'}}));
   assert.equal((await db.query('select count(*) n from factory.mock_resources')).rows[0].n,before);
  });
 }finally{await db.close();}
});
