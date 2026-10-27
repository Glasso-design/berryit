import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { randomUUID } from 'node:crypto';
import { assertIsolatedPgliteEnvironment } from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
test('atomic object quota is independent of database/runtime/backup storage',async t=>{
 const f=await fixture();const {db,ids,rpc,request,create}=f;
 try{
  const job=await create(request({storageQuotaBytes:100}));const instance=(await rpc(ids.adminA,'factory_snapshot',[job])).instance.id;
  let first;
  await t.test('reservation is charged before upload and idempotent',async()=>{
   const key=randomUUID();first=await rpc(ids.adminA,'factory_reserve',[instance,key,80]);assert.equal(await rpc(ids.adminA,'factory_reserve',[instance,key,80]),first);
   await assert.rejects(rpc(ids.adminA,'factory_reserve',[instance,key,81]));
   assert.equal(Number((await db.query('select reserved_bytes from factory.instances where id=$1',[instance])).rows[0].reserved_bytes),80);
  });
  await t.test('parallel excess upload cannot oversubscribe; other tenant is denied',async()=>{
   await assert.rejects(rpc(ids.adminA,'factory_reserve',[instance,randomUUID(),21]));
   await assert.rejects(rpc(ids.adminB,'factory_reserve',[instance,randomUUID(),1]));
   await assert.rejects(rpc(ids.adminA,'factory_worker_complete_upload',[first,80]));
  });
  await t.test('provider-observed size releases only unused reservation',async()=>{
   assert.equal(await f.store.scalar('factory_worker_complete_upload',[first,70]),'COMMITTED');
   const data=(await db.query('select used_bytes,reserved_bytes from factory.instances where id=$1',[instance])).rows[0];
   assert.equal(Number(data.used_bytes),70);assert.equal(Number(data.reserved_bytes),0);
   assert.equal(await f.store.scalar('factory_worker_complete_upload',[first,70]),'COMMITTED');
  });
  await t.test('oversized actual object is quarantined; no false release or cleanup',async()=>{
   const second=await rpc(ids.adminA,'factory_reserve',[instance,randomUUID(),20]);
   assert.equal(await f.store.scalar('factory_worker_complete_upload',[second,40]),'QUARANTINED');
   const data=(await db.query('select used_bytes,reserved_bytes,storage_blocked from factory.instances where id=$1',[instance])).rows[0];
   assert.equal(Number(data.reserved_bytes),20);assert.equal(data.storage_blocked,true);
   await assert.rejects(rpc(ids.adminA,'factory_reserve',[instance,randomUUID(),1]));
  });
 }finally{await db.close();}
});
