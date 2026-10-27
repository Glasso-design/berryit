import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.mjs';
import { LocalObjectStorage } from '../providers/local-storage.mjs';
import { assertIsolatedPgliteEnvironment } from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
test('LOCAL storage: isolated objects, complete inventories and conservative reservations',async t=>{
 const f=await fixture();try{
  const a=await f.create(f.request({storageQuotaBytes:100})),b=await f.create(f.request({organizationId:f.ids.orgB,projectId:f.ids.projectB,ownerId:f.ids.customerB}),f.ids.adminB);
  const ia=(await f.rpc(f.ids.adminA,'factory_snapshot',[a])).instance.id,ib=(await f.rpc(f.ids.adminB,'factory_snapshot',[b])).instance.id;
  const actor=(name,args)=>f.rpc(f.ids.adminA,name,args),storage=new LocalObjectStorage({store:f.store,actor});
  let object;
  await t.test('real object bytes can be read only in their permitted instance',async()=>{
   object=await storage.put(ia,randomUUID(),Buffer.alloc(80,65));assert.equal(Buffer.from(await storage.get(ia,object),'base64').length,80);
   assert.equal(await f.rpc(f.ids.adminB,'factory_local_object',[ia,object]),null);assert.equal(await f.rpc(f.ids.adminA,'factory_local_object',[ib,object]),null);
   await assert.rejects(storage.put(ib,randomUUID(),'foreign'));
  });
  await t.test('80/90/100 warnings are based on used plus reserved bytes',async()=>{
   assert.equal((await actor('factory_storage_status',[ia])).warning,80);
   const r=await actor('factory_reserve',[ia,randomUUID(),10]);assert.equal((await actor('factory_storage_status',[ia])).warning,90);
   await actor('factory_reserve',[ia,randomUUID(),10]);assert.equal((await actor('factory_storage_status',[ia])).warning,100);
   await assert.rejects(actor('factory_reserve',[ia,randomUUID(),1]));
   await assert.rejects(f.store.scalar('factory_worker_cancel_upload',[r,false]));
   await f.store.scalar('factory_worker_cancel_upload',[r,true]);assert.equal((await actor('factory_storage_status',[ia])).warning,90);
  });
  await t.test('complete provider inventory preserves ambiguous reservations; client cannot reconcile',async()=>{
   await assert.rejects(actor('factory_worker_reconcile_storage',[ia,randomUUID(),'a'.repeat(64),0,true]));
   await assert.rejects(f.store.scalar('factory_worker_reconcile_storage',[ia,randomUUID(),'a'.repeat(64),0,false]));
   const result=await storage.reconcile(ia);assert.equal(result.observed,80);
   const state=await actor('factory_storage_status',[ia]);assert.equal(Number(state.reserved_bytes),10);assert.equal(Number(state.used_bytes),80);
   const audit=(await actor('factory_snapshot',[a])).audit;assert(audit.some(x=>x.action==='factory.storage_reconciled'));
  });
 }finally{await f.db.close();}
});
