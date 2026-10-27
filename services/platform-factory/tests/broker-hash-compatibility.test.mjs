import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {assertIsolatedPgliteEnvironment} from '../../../supabase/tests/isolated-environment.mjs';

assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
const patch=readFileSync(new URL('../preflight/broker-hash-compatibility.sql',import.meta.url),'utf8');
const source=readFileSync(new URL('../db/002_provider_broker.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');

test('isolated Supabase extension layout: forward broker compatibility and unchanged authority',async t=>{
 const f=await fixture();
 try{
  const job=await f.create(f.request({storageQuotaBytes:100}));
  const instance=(await f.rpc(f.ids.adminA,'factory_snapshot',[job])).instance.id;
  const binding=randomUUID(),subject=randomUUID(),tenant='synthetic-layout-test',secret='synthetic-\u00e5\u20ac-compatibility-only';
  await f.db.query('insert into factory.storage_bindings(id,instance_id,secret_hash,product_tenant_id,account_id,bucket,jurisdiction) values($1,$2,$3,$4,$5,$6,$7)',[binding,instance,createHash('sha256').update(secret).digest('hex'),tenant,'a'.repeat(32),'synthetic-only','eu']);
  const call=async(name,args)=>{
   await f.db.exec('set role factory_broker');
   try{return (await f.db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;}
   finally{await f.db.exec('reset role');}
  };
  const reserve=(overrides={})=>call('factory_broker_reserve',[overrides.binding??binding,overrides.secret??secret,overrides.tenant??tenant,subject,randomUUID(),overrides.bytes??80,8388608]);
  const acl=async()=>(await f.db.query("select oid::regprocedure::text signature,proowner,proacl::text,proconfig from pg_proc where proname in ('factory_broker_reserve','factory_broker_upload') order by proname")).rows;
  const originalAcl=await acl();

  await t.test('reproduces missing public.digest in extensions-only pgcrypto layout',async()=>{
   await f.db.exec('create schema if not exists extensions; alter extension pgcrypto set schema extensions');
   assert.equal((await f.db.query("select to_regprocedure('public.digest(text,text)') is null missing")).rows[0].missing,true);
   await assert.rejects(reserve(),e=>e.code==='42883');
   assert.equal((await f.db.query('select reserved_bytes from factory.instances where id=$1',[instance])).rows[0].reserved_bytes,0);
  });
  await t.test('unknown environment refuses patch and preserves function definitions',async()=>{
   await f.db.exec("set factory.install_environment='unknown'");
   await assert.rejects(f.db.exec(patch),/Existing isolated Factory broker required/);
   await f.db.exec('rollback');
   await f.db.exec("set factory.install_environment='isolated-test'");
   assert.deepEqual(await acl(),originalAcl);
  });
  await t.test('changes exactly two hash expressions; preserves owner, ACL and empty search_path',async()=>{
   for(const name of ['factory_broker_reserve','factory_broker_upload']){
    const start=source.indexOf('create function public.'+name+'(');
    const original=source.slice(start,source.indexOf('end $$;',start)+7);
    assert(patch.includes(original.replace('create function','create or replace function').replace("public.digest(p_secret,'sha256')","pg_catalog.sha256(pg_catalog.convert_to(p_secret,'UTF8'))")));
   }
   assert.equal((patch.match(/create or replace function/g)||[]).length,2);
   await f.db.exec(patch);
   assert.deepEqual(await acl(),originalAcl);
   await f.db.exec(patch);
   assert.deepEqual(await acl(),originalAcl);
  });
  await t.test('anon, authenticated and service_role still cannot invoke broker RPCs',async()=>{
   for(const role of ['anon','authenticated','service_role']){
    for(const name of ['factory_broker_reserve','factory_broker_upload']){
     const row=(await f.db.query('select has_function_privilege($1,oid,\'EXECUTE\') allowed from pg_proc where proname=$2',[role,name])).rows[0];
     assert.equal(row.allowed,false);
    }
   }
   await assert.rejects(f.rpc(f.ids.adminA,'factory_broker_reserve',[binding,secret,tenant,subject,randomUUID(),1,8388608]),e=>e.code==='42501');
  });
  await t.test('wrong secret, tenant and binding are rejected without reservations',async()=>{
   await assert.rejects(reserve({secret:'wrong'}));
   await assert.rejects(reserve({tenant:'foreign'}));
   await assert.rejects(reserve({binding:randomUUID()}));
   assert.equal((await f.db.query('select count(*)::integer n from factory.upload_reservations')).rows[0].n,0);
  });
  let reservation;
  await t.test('UTF-8 secret authenticates; upload read works without public.digest',async()=>{
   reservation=await reserve();
   assert.equal(reservation.bytes,80);
   const status=await call('factory_broker_upload',[binding,secret,tenant,subject,reservation.reservationId,'read','{}']);
   assert.equal(status.reservationId,reservation.reservationId);
   await assert.rejects(call('factory_broker_upload',[binding,'wrong',tenant,subject,reservation.reservationId,'read','{}']));
   await assert.rejects(call('factory_broker_upload',[binding,secret,tenant,randomUUID(),reservation.reservationId,'read','{}']));
   assert.equal(await f.rpc(f.ids.adminB,'factory_provider_status',[instance]),null);
  });
  await t.test('quota and revoked binding remain enforced after compatibility patch',async()=>{
   await assert.rejects(reserve({bytes:21}),e=>e.code==='53100');
   await f.db.query('update factory.storage_bindings set revoked_at=now() where id=$1',[binding]);
   await assert.rejects(reserve({bytes:1}));
   await assert.rejects(call('factory_broker_upload',[binding,secret,tenant,subject,reservation.reservationId,'read','{}']));
   const state=await f.rpc(f.ids.adminA,'factory_storage_status',[instance]);
   assert.equal(state.reserved_bytes,80);
   assert.equal(state.used_bytes,0);
  });
 }finally{await f.db.close();}
});
