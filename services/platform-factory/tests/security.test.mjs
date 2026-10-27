import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { assertIsolatedPgliteEnvironment } from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);

test('Factory uses existing SQL authority, RLS and MFA without a parallel admin model',async t=>{
 const f=await fixture();const {db,ids,rpc,request,create,as}=f;
 try{
  const input=request(),job=await create(input);
  await t.test('scoped admin creates one project-linked instance; duplicate click returns same job',async()=>{
   assert.equal(await create(input),job);assert.equal((await db.query('select count(*) n from factory.instances')).rows[0].n,1);
   assert.equal((await rpc(ids.adminA,'factory_snapshot',[job])).instance.owner_id,ids.customerA);
  });
  await t.test('changed idempotent input is refused',async()=>{await assert.rejects(create({...input,name:'Changed'}));});
  for(const user of ['support','developer','customerA'])await t.test(user+' cannot create by direct RPC or forged client role',async()=>{
   await assert.rejects(create(request(),ids[user]));await assert.rejects(create({...request(),role:'ADMIN'},ids[user]));
  });
  await t.test('anon cannot call privileged functions or read another caller context',async()=>{
   await assert.rejects(rpc(ids.adminA,'factory_create',[JSON.stringify(request())],'aal1','anon'));
   await assert.rejects(rpc(ids.adminA,'factory_catalog',[],'aal1','anon'));
  });
  await t.test('every Factory definer has an empty search_path and no anonymous EXECUTE',async()=>{
   const rows=(await db.query(`select p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anonymous
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='factory' or (n.nspname='public' and p.proname like 'factory_%')`)).rows;
   assert(rows.length>=15);for(const row of rows){assert.equal(row.anonymous,false,row.proname);assert.equal(row.prosecdef,true,row.proname);assert(row.proconfig.includes('search_path=""'),row.proname);}
  });
  await t.test('admin without MFA cannot provision',async()=>{await assert.rejects(rpc(ids.adminA,'factory_create',[JSON.stringify(request())],'aal1'));});
  await t.test('forged organization, project and owner cannot cross tenants',async()=>{
   for(const attack of [{organizationId:ids.orgB},{projectId:ids.projectB},{ownerId:ids.customerB}])await assert.rejects(create(request(attack)));
   assert.equal(await rpc(ids.adminB,'factory_snapshot',[job]),null);
   assert.equal((await as(ids.adminB,'select id from factory.jobs')).length,0);
  });
  await t.test('direct writes, worker RPC and automatic checklist checkbox are denied',async()=>{
   await assert.rejects(as(ids.adminA,"update factory.jobs set state='READY' where id=$1",[job]));
   await assert.rejects(rpc(ids.adminA,'factory_worker_claim',[job,ids.owner]));
   await assert.rejects(rpc(ids.adminA,'factory_manual',[job,'health','Make the technical test green']));
  });
  await t.test('unknown product/version, duplicate domain and malformed quota are refused',async()=>{
   await assert.rejects(create(request({productId:'unknown'})));await assert.rejects(create(request({version:'0'.repeat(40)})));
   await assert.rejects(create(request({domain:input.domain})));await assert.rejects(create(request({storageQuotaBytes:-1})));
  });
  await t.test('manual requirements are auditable; audit cannot be edited',async()=>{
   await rpc(ids.adminA,'factory_manual',[job,'company','Synthetic company details checked']);
   assert.equal((await rpc(ids.adminA,'factory_snapshot',[job])).job.checklist.find(x=>x.id==='company').status,'VERIFIED');
   await assert.rejects(as(ids.adminA,"delete from public.support_admin_audit where target_id=$1",[job]));
  });
  await t.test('custom roles reuse current scoped permissions; expiry and role disable apply immediately',async()=>{
   await db.exec("insert into public.support_roles(key,label,rank,is_active,is_system) values('FACTORY_TEST_CUSTOM','Synthetic Factory custom role',10,true,false)");
   await db.exec("insert into public.support_role_permissions(role_key,permission_key) values('FACTORY_TEST_CUSTOM','factory.read'),('FACTORY_TEST_CUSTOM','factory.create')");
   const grant=(await db.query("insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,project_id,expires_at,reason) values($1,'FACTORY_TEST_CUSTOM','organization',$2,$3,now()+interval '1 hour','Synthetic custom scope') returning id",[ids.developer,ids.orgA,ids.projectA])).rows[0].id;
   const created=await create(request(),ids.developer);assert((await rpc(ids.developer,'factory_snapshot',[created])).job.id===created);
   await assert.rejects(create(request({organizationId:ids.orgB,projectId:ids.projectB,ownerId:ids.customerB}),ids.developer));
   await db.exec("update public.support_roles set is_active=false where key='FACTORY_TEST_CUSTOM'");assert.equal(await rpc(ids.developer,'factory_snapshot',[created]),null);
   await db.exec("update public.support_roles set is_active=true where key='FACTORY_TEST_CUSTOM'");
   await db.query("update public.support_role_grants set granted_at=now()-interval '2 hours',expires_at=now()-interval '1 second' where id=$1",[grant]);assert.equal(await rpc(ids.developer,'factory_snapshot',[created]),null);
  });
  await t.test('revocation affects the next read even in an existing session',async()=>{
   await db.query('update public.support_role_grants set revoked_at=now(),revoked_by=$1,revoke_reason=$2 where grantee_id=$3',[ids.owner,'Synthetic revoke',ids.adminA]);
   assert.equal(await rpc(ids.adminA,'factory_snapshot',[job]),null);await assert.rejects(create());
  });
 }finally{await db.close();}
});
