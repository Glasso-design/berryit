import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.mjs';
import { assertIsolatedPgliteEnvironment } from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
test('catalog, stable pagination and protected operational requests',async t=>{
 const f=await fixture();try{
  await t.test('canonical capability overlay never advertises untested live adapters',async()=>{
   const catalog=await f.rpc(f.ids.adminA,'factory_catalog');assert.equal(catalog.liveProvisioning,false);
   assert(catalog.products.length>=25);assert(catalog.products.every(p=>p.liveApproved===false));
   assert.equal(catalog.products.find(p=>p.id==='printbuddy').status,'NOT_PROVISIONABLE');
   assert(!catalog.projects.some(p=>p.organizationId===f.ids.orgB));assert(!catalog.owners.some(p=>p.id===f.ids.customerB));
  });
  const job=await f.create(),instance=(await f.rpc(f.ids.adminA,'factory_snapshot',[job])).instance.id;
  await t.test('operations only register scoped approval requests; no action is executed',async()=>{
   await assert.rejects(f.rpc(f.ids.support,'factory_operation',[instance,'backup','Synthetic scope test']));
   await assert.rejects(f.rpc(f.ids.adminB,'factory_operation',[instance,'backup','Synthetic foreign test']));
   await assert.rejects(f.rpc(f.ids.adminA,'factory_operation',[instance,'shell','Arbitrary command forbidden']));
   await assert.rejects(f.rpc(f.ids.adminA,'factory_operation',[instance,'backup','Synthetic MFA test'],'aal1'));
   const request=await f.rpc(f.ids.adminA,'factory_operation',[instance,'backup','Synthetic request only']);
   assert.equal((await f.db.query('select state from factory.operation_requests where id=$1',[request])).rows[0].state,'WAITING_FOR_APPROVAL');
  });
  await t.test('direct null/forged inputs cannot bypass SQL validation',async()=>{
   await assert.rejects(f.create(f.request({domain:null})));await assert.rejects(f.create(f.request({accountMode:'unknown'})));
   await assert.rejects(f.create(f.request({domain:'bad..example.invalid'})));await assert.rejects(f.create(f.request({name:{unexpected:'object'}})));
   await assert.rejects(f.rpc(f.ids.adminA,'factory_reserve',[instance,null,1]));
  });
  await t.test('requested product add-ons become mandatory external blockers, never automatic activation',async()=>{
   const id=await f.create(f.request({addons:['bankid']}));const data=await f.rpc(f.ids.adminA,'factory_snapshot',[id]);
   const check=data.job.checklist.find(c=>c.id==='bankid');assert.equal(check.required,true);assert.equal(check.status,'WAITING_FOR_PROVIDER');
   await assert.rejects(f.rpc(f.ids.adminA,'factory_manual',[id,'bankid','Synthetic cannot bypass contract']));
   await assert.rejects(f.create(f.request({addons:['shell-command']})));await assert.rejects(f.create(f.request({addons:['bankid','bankid']})));
  });
  await t.test('more than 50 jobs with identical timestamps paginate without losing IDs',async()=>{
   // Synthetic rows only; bypass rate limits to construct a large read fixture.
   for(let i=0;i<125;i++){
    const ii=randomUUID();await f.db.query(`insert into factory.instances(id,organization_id,project_id,owner_id,product_id,version,name,domain,region,quota_bytes)
     select $1,organization_id,project_id,owner_id,product_id,version,'Synthetic pagination',$2,region,quota_bytes from factory.instances where id=$3`,[ii,'page-'+ii+'.example.invalid',instance]);
    await f.db.query(`insert into factory.jobs(instance_id,organization_id,project_id,created_by,approved_session_id,idempotency_key,input_hash,input,checklist,created_at)
     select $1,organization_id,project_id,created_by,approved_session_id,$2,input_hash,input,checklist,'2020-01-01' from factory.jobs where id=$3`,[ii,randomUUID(),job]);
   }
   const seen=new Set();let last=null,pages=0,more=true;
   while(more){const p=await f.rpc(f.ids.adminA,'factory_list',[last?.created_at??null,last?.id??null]);for(const row of p.items){assert(!seen.has(row.id));seen.add(row.id);}last=p.items.at(-1);more=p.hasMore;pages++;assert(pages<10);}
   assert.equal(seen.size,127);assert.equal(pages,3);assert.equal((await f.rpc(f.ids.adminB,'factory_list')).items.length,0);
  });
 }finally{await f.db.close();}
});
