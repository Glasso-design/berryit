import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {DEFAULT_STORAGE_QUOTA,requestSchema} from '../contract.mjs';
import {factoryRequestSchema} from '../../../shared/factory/schema.mjs';
import {executeFactoryAction} from '../../../shared/factory.ts';
import {assertIsolatedPgliteEnvironment} from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);

test('1 GB defaults affect new platforms only; stored quotas and atomic broker remain intact',async t=>{
 const f=await fixture();
 try{
  // A pre-existing synthetic 10 GB row, with a live reservation, represents
  // the old default. No UPDATE/backfill of this instance is performed.
  const legacyInput=f.request({storageQuotaBytes:10_000_000_000});
  const legacyJob=await f.create(legacyInput);
  const legacyInstance=(await f.rpc(f.ids.adminA,'factory_snapshot',[legacyJob])).instance.id;
  await f.rpc(f.ids.adminA,'factory_reserve',[legacyInstance,randomUUID(),2_000_000_000]);
  const legacyBefore=await f.rpc(f.ids.adminA,'factory_snapshot',[legacyJob]);

  await t.test('shared server default, adapter, template and checklist agree on decimal 1 GB',async()=>{
   assert.equal(DEFAULT_STORAGE_QUOTA,1_000_000_000);
   assert.equal(requestSchema,factoryRequestSchema);
   assert.equal(f.adapter.defaultQuotaBytes,1_000_000_000);
   assert.equal(f.adapter.template.objectStorageQuotaBytes,1_000_000_000);
   assert.match(f.adapter.checklist().find(c=>c.id==='quota').description,/1 GB \(1000000000 byte\)/);
  });
  let newJob,newInstance;
  await t.test('protected API fills omitted quota and actual SQL persists exactly 1000000000',async()=>{
   const input=f.request();delete input.storageQuotaBytes;
   const actor={rpc:async(name,args)=>{
    assert.equal(name,'factory_create');assert.equal(args.p_input.storageQuotaBytes,1_000_000_000);
    return {data:await f.rpc(f.ids.adminA,name,[JSON.stringify(args.p_input)]),error:null};
   }};
   newJob=await executeFactoryAction(actor,{action:'create',input});
   const snapshot=await f.rpc(f.ids.adminA,'factory_snapshot',[newJob]);newInstance=snapshot.instance.id;
   assert.equal(Number(snapshot.instance.quota_bytes),1_000_000_000);
   assert.equal(snapshot.job.input.storageQuotaBytes,1_000_000_000);
   assert.equal(snapshot.instance.product_id,'qabgo');
   assert.equal(await executeFactoryAction(actor,{action:'create',input}),newJob);
  });
  await t.test('explicit larger quotas remain supported; 1 GB is not a hard storage ceiling',async()=>{
   const input=f.request({storageQuotaBytes:5_000_000_000});
   assert.equal(factoryRequestSchema.parse(input).storageQuotaBytes,5_000_000_000);
   const id=await f.create(input),snapshot=await f.rpc(f.ids.adminA,'factory_snapshot',[id]);
   assert.equal(Number(snapshot.instance.quota_bytes),5_000_000_000);
  });
  await t.test('80/90/100 percent and one-byte overflow use the new stored quota',async()=>{
   const reserve=bytes=>f.rpc(f.ids.adminA,'factory_reserve',[newInstance,randomUUID(),bytes]);
   const status=()=>f.rpc(f.ids.adminA,'factory_storage_status',[newInstance]);
   await reserve(800_000_000);assert.equal((await status()).warning,80);
   await reserve(100_000_000);assert.equal((await status()).warning,90);
   await reserve(100_000_000);assert.equal((await status()).warning,100);
   await assert.rejects(reserve(1));
   assert.equal(Number((await status()).reserved_bytes),1_000_000_000);
  });
  await t.test('older 10 GB instance, input, audit and reservations remain byte-for-byte equivalent',async()=>{
   assert.equal(await f.create(legacyInput),legacyJob);
   assert.deepEqual(await f.rpc(f.ids.adminA,'factory_snapshot',[legacyJob]),legacyBefore);
   const status=await f.rpc(f.ids.adminA,'factory_storage_status',[legacyInstance]);
   assert.equal(Number(status.quota_bytes),10_000_000_000);
   assert.equal(Number(status.reserved_bytes),2_000_000_000);
  });
 }finally{await f.db.close();}
});
