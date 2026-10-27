import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,randomBytes} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {ResourceRegistry} from '../providers/resource-registry.mjs';
import {publishProviderStatus} from '../providers/status.mjs';
import {QuotaBroker} from '../providers/quota-broker.mjs';
import {assertIsolatedPgliteEnvironment} from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
const sha=s=>createHash('sha256').update(s).digest('hex');

test('provider SQL: authority, explicit fallback, durable ownership and server quota',async t=>{
 const f=await fixture();try{
  const jobId=await f.create(f.request({storageQuotaBytes:100}));const snapshot=await f.rpc(f.ids.adminA,'factory_snapshot',[jobId]),instance=snapshot.instance.id;
  const reg=new ResourceRegistry(f.db);
  await t.test('account model fallback requires separate current MFA and matching scope',async()=>{
   await assert.rejects(f.rpc(f.ids.adminB,'factory_approve_account_mode',[jobId,'MANAGED_RESOURCE_ISOLATION','Synthetic explicit fallback approval']));
   await assert.rejects(f.rpc(f.ids.adminA,'factory_approve_account_mode',[jobId,'MANAGED_RESOURCE_ISOLATION','Synthetic explicit fallback approval'],'aal1'));
   await f.rpc(f.ids.adminA,'factory_approve_account_mode',[jobId,'MANAGED_RESOURCE_ISOLATION','Synthetic explicit fallback approval']);
  });
  let job=await f.store.claim(jobId);
  await t.test('durable intent reuses verified resource, detects changed input and cross-instance collision',async()=>{
   await reg.assertAccountMode(job,'MANAGED_RESOURCE_ISOLATION');await assert.rejects(reg.assertAccountMode(job,'LIMITED_STANDALONE'));
   const plan={method:'POST',path:'/accounts',body:{name:'synthetic'},headers:{'Idempotency-Key':'synthetic-stable-key'}};let requests=0;
   const perform=async()=>{requests++;return {id:'a'.repeat(32),kind:'account'};};
   await reg.ensure(job,'account',plan,perform);await new ResourceRegistry(f.db).ensure(job,'account',plan,perform);assert.equal(requests,1);
   await assert.rejects(reg.ensure(job,'account',{...plan,body:{name:'changed'}},perform),e=>e.code==='INTENT_CONFLICT');
   await assert.rejects(reg.ensure(job,'live-safety',{...plan,verification:'LIVE_HTTP'},perform),e=>e.code==='BLOCKED_LIVE_PROVIDER');assert.equal(requests,1);
   await reg.recordAccount(job,'a'.repeat(32),'DEDICATED_MANAGED');
   const otherId=await f.create(f.request({organizationId:f.ids.orgB,projectId:f.ids.projectB,ownerId:f.ids.customerB}),f.ids.adminB);const other=await f.store.claim(otherId);
   await assert.rejects(reg.recordAccount(other,'a'.repeat(32),'DEDICATED_MANAGED'),e=>e.code==='ACCOUNT_COLLISION');
   await assert.rejects(reg.ensure(other,'account',plan,perform));
  });
  await t.test('partial provisioning keeps ambiguous intent and reconciles instead of duplicate blind writes',async()=>{
   let calls=0;const plan={method:'POST',path:'/zones/synthetic/dns_records',body:{name:'synthetic'},headers:{}};
   await assert.rejects(reg.ensure(job,'domain',plan,async()=>{calls++;throw Error('synthetic after-provider-commit fault');}));
   const recovered=await reg.ensure(job,'domain',plan,async i=>{assert.equal(i.previousAttempt,true);return {id:'b'.repeat(32),kind:'dns'};});assert.equal(recovered.kind,'dns');assert.equal(calls,1);
   const busy=reg.ensure(job,'email',plan,async()=>{await new Promise(r=>setTimeout(r,50));return {id:'c'.repeat(32),kind:'email'};});
   await new Promise(r=>setTimeout(r,5));await assert.rejects(reg.ensure(job,'email',plan,async()=>{throw Error('duplicate must not execute');}),e=>e.code==='PROVIDER_INTENT_BUSY');await busy;
  });
  await t.test('provider registry works as service_role, not only as schema owner',async()=>{
   const worker=new ResourceRegistry({query:async(sql,args)=>{const rows=await f.as(f.ids.adminA,sql,args,'aal2','service_role');return {rows,rowCount:rows.length};}});
   const result=await worker.ensure(job,'isolation',{method:'GET',path:'/synthetic',headers:{}},async()=>({id:'synthetic-isolation-reference',kind:'isolation'}));assert.equal(result.kind,'isolation');
  });
  await t.test('clients cannot write provider/checklist evidence or call privileged helpers',async()=>{
   for(const table of ['provider_status','provider_intents','storage_bindings','multipart_uploads','external_accounts'])await assert.rejects(f.as(f.ids.adminA,'update factory.'+table+' set '+(table==='provider_status'?'verification=\'LIVE_VERIFIED\'':'instance_id=instance_id')));
   await assert.rejects(f.rpc(f.ids.adminA,'factory_manual',[jobId,'storage','Synthetic fake verified resource evidence']));
   await assert.rejects(f.rpc(f.ids.adminA,'factory_worker_r2_inventory',[instance,0,'[]']));
   await assert.rejects(f.rpc(f.ids.adminA,'factory_broker_reserve',[randomUUID(),'synthetic',randomUUID(),f.ids.customerA,randomUUID(),1,8388608]));
   assert.equal(await f.rpc(f.ids.adminB,'factory_provider_status',[instance]),null);
   await publishProviderStatus(f.db,instance,{accountMode:'DEDICATED_MANAGED',capabilities:{verification:'SYNTHETIC_HTTP',capabilities:{'r2.read':'VERIFIED_READ','r2.write':'UNVERIFIED'},missingPermissions:['dns.write'],blockers:['EXTERNAL_BACKUP_AND_RESTORE_REQUIRED']},cost:{objectBytes:10000000000}});
   const status=await f.rpc(f.ids.adminA,'factory_provider_status',[instance]);assert.equal(status.verification,'SYNTHETIC_HTTP');assert.equal(status.cost.actualBillVerified,false);assert.equal(Number(status.quota.quota_bytes),100);
   await assert.rejects(publishProviderStatus(f.db,instance,{accountMode:'DEDICATED_MANAGED',capabilities:{verification:'SYNTHETIC_HTTP',capabilities:{'r2.read':'Bearer secret'},missingPermissions:[],blockers:[]}}));
  });
  const binding=randomUUID(),secret=randomBytes(32).toString('hex'),tenant='synthetic-product-tenant';
  await f.db.query('insert into factory.storage_bindings(id,instance_id,secret_hash,product_tenant_id,account_id,bucket,jurisdiction) values($1,$2,$3,$4,$5,$6,$7)',[binding,instance,sha(secret),tenant,'d'.repeat(32),'synthetic-bucket','eu']);
  const principal={kind:'user',userId:randomUUID(),tenantId:tenant,permissions:new Set(['sites.manage'])};let active=true;
  const db={query:async(sql,args)=>{await f.db.exec('set role factory_broker');try{return await f.db.query(sql,args);}finally{await f.db.exec('reset role');}}};
  const r2={initiate:async()=>randomUUID(),partUrl:async p=>({synthetic:true,...p})};
  const broker=new QuotaBroker({db,binding,secret,tenantId:tenant,r2,authorize:async p=>active&&p.permissions?.has('sites.manage')});
  let upload;
  await t.test('limited product broker rejects wrong tenant, credentials, unknown subject and quota overflow',async()=>{
   await assert.rejects(broker.reserve({...principal,tenantId:'foreign'},{idempotencyKey:randomUUID(),bytes:1}));
   await assert.rejects(broker.reserve({...principal,permissions:new Set()},{idempotencyKey:randomUUID(),bytes:1}));
   await assert.rejects(new QuotaBroker({db,binding,secret:'wrong',tenantId:tenant,r2,authorize:async()=>true}).reserve(principal,{idempotencyKey:randomUUID(),bytes:1}));
   const key=randomUUID();upload=await broker.reserve(principal,{idempotencyKey:key,bytes:80});assert.equal(upload.state,'OPEN');
   assert.deepEqual(await broker.reserve(principal,{idempotencyKey:key,bytes:80}),upload);
   await assert.rejects(broker.reserve(principal,{idempotencyKey:key,bytes:81}));
   await assert.rejects(broker.reserve(principal,{idempotencyKey:randomUUID(),bytes:21}));
   assert.equal((await f.rpc(f.ids.adminA,'factory_storage_status',[instance])).warning,80);
  });
  await t.test('parts bind digest and observed length; foreign reservations, stale roles and replay changes denied',async()=>{
   const md5=createHash('md5').update(Buffer.alloc(80)).digest('base64');const part=await broker.part(principal,{reservationId:upload.reservationId,number:1,md5});assert.equal(Number(part.bytes),80);
   await assert.rejects(broker.part(principal,{reservationId:upload.reservationId,number:2,md5}));
   await assert.rejects(broker.part(principal,{reservationId:upload.reservationId,number:1,md5:createHash('md5').update('changed').digest('base64')}));
   await assert.rejects(broker.part({...principal,userId:randomUUID()},{reservationId:upload.reservationId,number:1,md5}));
   active=false;await assert.rejects(broker.part(principal,{reservationId:upload.reservationId,number:1,md5}));active=true;
   await f.db.query('update factory.storage_bindings set revoked_at=now() where id=$1',[binding]);await assert.rejects(broker.reserve(principal,{idempotencyKey:randomUUID(),bytes:1}));
  });
  await t.test('old session grant revocation stops new provider calls',async()=>{
   await f.db.query("update public.support_role_grants set revoked_at=now(),revoked_by=$2,revoke_reason='Synthetic revocation test' where grantee_id=$1",[f.ids.adminA,f.ids.owner]);
   await assert.rejects(reg.ensure(job,'quota',{method:'GET',path:'/synthetic',headers:{}},async()=>{throw Error('must not execute');}),e=>e.code==='AUTHORIZATION_REVOKED');
  });
 }finally{await f.db.close();}
});
