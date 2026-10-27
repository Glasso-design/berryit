import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {syntheticR2} from './synthetic-r2.mjs';
import {QuotaBroker,reconcileR2} from '../providers/quota-broker.mjs';
import {assertIsolatedPgliteEnvironment} from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
const digest=b=>createHash('md5').update(b).digest('base64');

test('R2 multipart HTTP → limited broker role → actual SQL quota',async t=>{
 const f=await fixture(),s=await syntheticR2();
 try{
  const jobId=await f.create(f.request({storageQuotaBytes:20000000})),instance=(await f.rpc(f.ids.adminA,'factory_snapshot',[jobId])).instance.id;
  const binding=randomUUID(),secret=randomBytes(32).toString('hex'),tenant='synthetic-r2-tenant',principal={kind:'user',userId:randomUUID(),tenantId:tenant,permissions:new Set(['sites.manage'])};
  await f.db.query('insert into factory.storage_bindings(id,instance_id,secret_hash,product_tenant_id,account_id,bucket,jurisdiction) values($1,$2,$3,$4,$5,$6,$7)',[binding,instance,createHash('sha256').update(secret).digest('hex'),tenant,'a'.repeat(32),'synthetic-bucket','eu']);
  // PGlite is one connection. Serialize role changes; the SQL functions still
  // execute real row locks. A separate PostgreSQL test exercises parallel clients.
  let serial=Promise.resolve();const db={query:(sql,args)=>{const next=serial.then(async()=>{await f.db.exec('set role factory_broker');try{return await f.db.query(sql,args);}finally{await f.db.exec('reset role');}});serial=next.catch(()=>{});return next;}};
  const broker=new QuotaBroker({db,binding,secret,tenantId:tenant,r2:s.r2,authorize:async p=>p.permissions.has('sites.manage')});
  let first;
  await t.test('concurrent reservations never exceed quota; retries never create another MPU',async()=>{
   const attempts=await Promise.allSettled(Array.from({length:3},()=>broker.reserve(principal,{idempotencyKey:randomUUID(),bytes:12000000})));
   assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);first=attempts.find(r=>r.status==='fulfilled').value;
   const status=await f.rpc(f.ids.adminA,'factory_storage_status',[instance]);assert.equal(Number(status.reserved_bytes),12000000);assert.equal(s.counts().initiateCalls,1);
  });
  const data=[Buffer.alloc(8388608,65),Buffer.alloc(12000000-8388608,66)];let signed;
  await t.test('short-lived part URLs cannot enlarge, change digest, change key or finalize',async()=>{
   signed=await broker.part(principal,{reservationId:first.reservationId,number:1,md5:digest(data[0])});
   assert.equal(new URL(signed.url).searchParams.get('X-Amz-Expires'),'120');assert.equal(signed.headers['content-length'],'8388608');
   const changed=new URL(signed.url);changed.searchParams.set('partNumber','2');assert.equal((await s.upload({...signed,url:changed.href},data[0])).status,403);
   assert.equal((await s.upload({...signed,headers:{...signed.headers,'content-length':'1'}},Buffer.from('x'))).status,403);
   assert.equal((await s.upload(signed,Buffer.alloc(8388608,67))).status,400);
   assert.equal((await s.upload(signed,data[0])).status,200);assert.equal((await s.upload(signed,data[0])).status,200);
   const other=await broker.part(principal,{reservationId:first.reservationId,number:2,md5:digest(data[1])});assert.equal((await s.upload(other,data[1])).status,200);
  });
  await t.test('server verifies every paginated part and HEAD; completion is idempotent',async()=>{
   const result=await broker.complete(principal,{reservationId:first.reservationId});assert.equal(result.state,'COMMITTED');
   assert.equal((await broker.complete(principal,{reservationId:first.reservationId})).state,'COMMITTED');assert.equal(s.counts().completeCalls,1);
   const state=await f.rpc(f.ids.adminA,'factory_storage_status',[instance]);assert.equal(Number(state.used_bytes),12000000);assert.equal(Number(state.reserved_bytes),0);
   assert.equal((await s.upload(signed,data[0])).status,404);
  });
  let second;
  await t.test('80/90/100 warnings and unfinished uploads stay charged',async()=>{
   second=await broker.reserve(principal,{idempotencyKey:randomUUID(),bytes:4000000});assert.equal((await f.rpc(f.ids.adminA,'factory_storage_status',[instance])).warning,80);
   const pending=await broker.reserve(principal,{idempotencyKey:randomUUID(),bytes:2000000});assert.equal((await f.rpc(f.ids.adminA,'factory_storage_status',[instance])).warning,90);
   await broker.reserve(principal,{idempotencyKey:randomUUID(),bytes:2000000});assert.equal((await f.rpc(f.ids.adminA,'factory_storage_status',[instance])).warning,100);
   await assert.rejects(broker.reserve(principal,{idempotencyKey:randomUUID(),bytes:1}));assert.equal(pending.state,'OPEN');
   const bytes=Buffer.alloc(4000000,68),part=await broker.part(principal,{reservationId:second.reservationId,number:1,md5:digest(bytes)});assert.equal((await s.upload(part,bytes)).status,200);
   s.loseNextComplete();await assert.rejects(broker.complete(principal,{reservationId:second.reservationId}),e=>e.code==='MANUAL_RECOVERY');
   await assert.rejects(reconcileR2(f.db,s.r2,instance)); // Uncommitted remote object must not be double-counted.
   await f.db.query("update factory.multipart_uploads set lease_until=now()-interval '1 second' where reservation_id=$1",[second.reservationId]);
   assert.equal((await broker.complete(principal,{reservationId:second.reservationId})).state,'COMMITTED');assert.equal(s.counts().completeCalls,2);
  });
  await t.test('full paginated inventory does not double count; stale inventories and foreign objects denied',async()=>{
   const result=await reconcileR2(f.db,s.r2,instance);assert.equal(result.objects,2);assert.equal(result.bytes,16000000);
   const status=await f.rpc(f.ids.adminA,'factory_storage_status',[instance]);assert.equal(Number(status.used_bytes),16000000);assert.equal(Number(status.reserved_bytes),4000000);
   await assert.rejects(f.db.query('select public.factory_worker_r2_inventory($1,$2,$3)',[instance,0,'[]']));
   const revision=(await f.db.query('select storage_revision from factory.instances where id=$1',[instance])).rows[0].storage_revision;
   await assert.rejects(f.db.query('select public.factory_worker_r2_inventory($1,$2,$3)',[instance,revision,JSON.stringify([{key:randomUUID()+'/'+randomUUID(),bytes:1}])]));
  });
 }finally{await s.close();await f.db.close();}
});
