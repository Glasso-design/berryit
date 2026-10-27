import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {DEPLOYED_BASELINE,PENDING_MIGRATIONS,ADDITIONAL_MIGRATIONS} from '../upgrade-plan.mjs';
import {assertIsolatedPgliteEnvironment} from './isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
const sql=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const hotfix=sql('../../deploy/berryit-support/hotfixes/active-support-grants/apply.sql');
const containment=sql('../../deploy/berryit-support/hotfixes/active-support-grants/containment.sql');

test('six-migration helper hotfix and forward-upgrade compatibility; synthetic memory DB only',async t=>{
 const db=await PGlite.create({extensions:{pgcrypto}});
 const ids=Object.fromEntries(['owner','tech','other','inactive','expired','revoked','customer','orgA','orgB'].map(k=>[k,randomUUID()]));
 const as=async(user,query,args=[],role='authenticated',claims)=>{
  assert.ok(['anon','authenticated','service_role'].includes(role));
  await db.exec('begin');
  try{
   await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims??{sub:user,role,aal:'aal2',session_id:user})]);
   await db.exec('set local role '+role);
   const rows=(await db.query(query,args)).rows;await db.exec('commit');return rows;
  }catch(error){await db.exec('rollback');throw error;}
 };
 const apply=async source=>{try{await db.exec(source);}catch(e){await db.exec('rollback');throw e;}};
 const deny=op=>assert.rejects(op,e=>e.code==='42501');
 try{
  await db.exec(sql('local_bootstrap.sql'));
  for(const [n,file]of DEPLOYED_BASELINE.entries()){
   await db.exec(sql('../migrations/'+file));if(n===0)await db.exec(sql('local_storage_bootstrap.sql'));
  }
  await db.exec('create table public.schema_migrations(version text primary key,applied_at timestamptz default now()); alter table public.schema_migrations enable row level security;');
  for(const version of DEPLOYED_BASELINE)await db.query('insert into public.schema_migrations(version)values($1)',[version]);
  for(const k of ['owner','tech','other','inactive','expired','revoked','customer'])await db.query('insert into auth.users(id,email)values($1,$2)',[ids[k],k+'@example.test']);
  await db.query("insert into public.organizations(id,name)values($1,'Synthetic A'),($2,'Synthetic B')",[ids.orgA,ids.orgB]);
  await db.query('update public.profiles set organization_id=$1 where id=$2',[ids.orgA,ids.customer]);
  await db.query("insert into public.support_role_grants(grantee_id,role_key,scope,reason)values($1,'BERRYIT_SUPPORT_SUPER_ADMIN','global','Synthetic protected owner')",[ids.owner]);
  for(const key of ['tech','other','inactive','expired','revoked'])await db.query("insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,reason,granted_at,expires_at,revoked_at,revoke_reason)values($1,'BERRYIT_SUPPORT_TECHNICIAN','organization',$2,'Synthetic scope fixture','2019-01-01T00:00:00Z',$3,$4,$5)",
   [ids[key],key==='other'?ids.orgB:ids.orgA,key==='expired'?'2020-01-01T00:00:00Z':null,key==='revoked'?'2020-01-01T00:00:00Z':null,key==='revoked'?'Synthetic revocation':null]);
  await db.query('update public.profiles set is_active=false where id=$1',[ids.inactive]);
  const ticket=(await db.query("insert into public.tickets(organization_id,requester_id,subject,description,category_key)values($1,$2,'Synthetic helper dependency','Synthetic data only','ovrigt')returning id",[ids.orgA,ids.customer])).rows[0].id;
  const before=(await db.query('select to_jsonb(g) value from public.support_role_grants g order by id')).rows;
  await t.test('reproduces anonymous three-column grant disclosure on the exact baseline',async()=>{
   const rows=await as(null,'select * from public.active_support_grants($1)',[ids.owner],'anon');
   assert.equal(rows.length,1);assert.deepEqual(Object.keys(rows[0]),['role_key','scope','organization_id']);
   assert.equal((await as(null,'select public.max_support_rank($1) rank',[ids.owner],'anon'))[0].rank,100);
  });
  await t.test('baseline fingerprint matches the read-only production observation',async()=>{
   assert.equal((await db.query("select md5(prosrc) hash from pg_proc where oid='public.active_support_grants(uuid)'::regprocedure")).rows[0].hash,'7046b3ef55adcf0b7ec7a454d43c106c');
  });
  await t.test('unexpected migration ledger fails closed before any helper change',async()=>{
   await db.query("insert into public.schema_migrations(version)values('synthetic-unexpected')");
   try{await assert.rejects(apply(hotfix),/baseline differs/);}
   finally{await db.query("delete from public.schema_migrations where version='synthetic-unexpected'");}
   assert.equal((await as(null,'select * from public.active_support_grants($1)',[ids.owner],'anon')).length,1);
  });
  await t.test('unexpected helper body fails closed before changing ACL or audit',async()=>{
   const original=(await db.query("select pg_get_functiondef('public.active_support_grants(uuid)'::regprocedure) definition")).rows[0].definition;
   await db.exec(original.replace('g.grantee_id = p_user','g.grantee_id = p_user /* synthetic drift */'));
   try{await assert.rejects(apply(hotfix),/definition differs/);}
   finally{await db.exec(original);}
   assert.equal((await as(null,'select * from public.active_support_grants($1)',[ids.owner],'anon')).length,1);
  });
  await t.test('hotfix applies atomically without changing ledger or grants',async()=>{
   await apply(hotfix);
   assert.deepEqual((await db.query('select to_jsonb(g) value from public.support_role_grants g order by id')).rows,before);
   assert.equal((await db.query('select count(*) n from public.schema_migrations')).rows[0].n,6);
  });
  await t.test('anonymous helper and rank wrapper EXECUTE are both denied',async()=>{
   await deny(as(null,'select * from public.active_support_grants($1)',[ids.owner],'anon'));
   await deny(as(null,'select public.max_support_rank($1)',[ids.owner],'anon'));
  });
  await t.test('authenticated caller can read only their own organization scope',async()=>{
   const rows=await as(ids.tech,'select * from public.active_support_grants($1)',[ids.tech]);
   assert.equal(rows.length,1);assert.equal(rows[0].organization_id,ids.orgA);
   assert.equal((await as(ids.tech,'select * from public.active_support_grants($1)',[ids.other])).length,0);
   assert.equal((await as(ids.tech,'select * from public.active_support_grants(null)')).length,0);
  });
  await t.test('customer and privileged owner cannot query another user through direct RPC',async()=>{
   assert.equal((await as(ids.customer,'select * from public.active_support_grants($1)',[ids.owner])).length,0);
   assert.equal((await as(ids.owner,'select * from public.active_support_grants($1)',[ids.tech])).length,0);
   assert.equal((await as(ids.customer,'select public.max_support_rank($1) rank',[ids.owner]))[0].rank,0);
  });
  await t.test('inactive, revoked and expired own grants are absent',async()=>{
   for(const user of ['inactive','expired','revoked'])assert.equal((await as(ids[user],'select * from public.active_support_grants($1)',[ids[user]])).length,0);
  });
  await t.test('missing identity cannot become trusted maintenance via SET ROLE',async()=>{
   assert.equal((await as(null,'select * from public.active_support_grants($1)',[ids.owner],'authenticated',{})).length,0);
  });
  await t.test('server service role and direct trusted SQL retain required lookup',async()=>{
   assert.equal((await as(null,'select * from public.active_support_grants($1)',[ids.tech],'service_role')).length,1);
   assert.equal((await db.query('select * from public.active_support_grants($1)',[ids.tech])).rows.length,1);
  });
  await t.test('existing permission, owner, rank and ticket helpers keep caller scope',async()=>{
   assert.equal((await as(ids.owner,'select public.is_support_super_admin() ok'))[0].ok,true);
   assert.equal((await as(ids.owner,'select public.max_support_rank($1) rank',[ids.owner]))[0].rank,100);
   assert.equal((await as(ids.tech,"select public.has_support_permission('tickets.write',$1) ok",[ids.orgA]))[0].ok,true);
   assert.equal((await as(ids.tech,"select public.has_support_permission('tickets.write',$1) ok",[ids.orgB]))[0].ok,false);
   assert.equal((await as(ids.tech,'select public.can_work_ticket($1) ok',[ticket]))[0].ok,true);
   assert.equal((await as(ids.other,'select public.can_work_ticket($1) ok',[ticket]))[0].ok,false);
  });
  await t.test('owner grant/revoke remains audited and a technician cannot escalate',async()=>{
   const grant=(await as(ids.owner,"insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,reason,granted_by)values($1,'BERRYIT_SUPPORT_TECHNICIAN','organization',$2,'Synthetic owner delegation',$3)returning id",[ids.customer,ids.orgA,ids.owner]))[0].id;
   assert.equal((await as(ids.customer,"select public.has_support_permission('tickets.write',$1) ok",[ids.orgA]))[0].ok,true);
   await deny(as(ids.tech,"insert into public.support_role_grants(grantee_id,role_key,scope,reason,granted_by)values($1,'BERRYIT_SUPPORT_SUPER_ADMIN','global','Synthetic forbidden escalation',$1)",[ids.tech]));
   await as(ids.owner,"update public.support_role_grants set revoked_at=now(),revoked_by=$1,revoke_reason='Synthetic delegation ended'where id=$2",[ids.owner,grant]);
   assert.equal((await as(ids.customer,"select public.has_support_permission('tickets.write',$1) ok",[ids.orgA]))[0].ok,false);
   assert.equal((await db.query("select count(*) n from public.support_admin_audit where metadata->>'grant_id'=$1 and action in('role.granted','role.revoked')",[grant])).rows[0].n,2);
  });
  await t.test('current-session revocation applies immediately',async()=>{
   await db.query("update public.support_role_grants set revoked_at=now(),revoke_reason='Synthetic test ended' where grantee_id=$1",[ids.tech]);
   assert.equal((await as(ids.tech,'select * from public.active_support_grants($1)',[ids.tech])).length,0);
   assert.equal((await as(ids.tech,'select public.can_work_ticket($1) ok',[ticket]))[0].ok,false);
  });
  await t.test('fixed search_path, security definer and minimum ACL are explicit',async()=>{
   const row=(await db.query("select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon,has_function_privilege('authenticated',oid,'execute') signed from pg_proc where oid='public.active_support_grants(uuid)'::regprocedure")).rows[0];
   assert.equal(row.prosecdef,true);assert.deepEqual(row.proconfig,['search_path=""']);assert.equal(row.anon,false);assert.equal(row.signed,true);
  });
  await t.test('audit records the maintenance action without grant or credential payloads',async()=>{
   const events=(await db.query("select metadata from public.support_admin_audit where action='security.hotfix.prepared_helper_applied'")).rows;
   assert.equal(events.length,1);assert.deepEqual(events[0].metadata,{change_id:'PASS3B-active-support-grants',baseline_migrations:6});
  });
  await t.test('reapplication is allowed only for the identical reviewed hotfix',async()=>{await apply(hotfix);});
  await t.test('all eleven later migrations still apply over the hotfix',async()=>{
   await db.exec("insert into auth.sessions(id,user_id,aal)select id,id,'aal2'from auth.users");
   for(const file of [...PENDING_MIGRATIONS,...ADDITIONAL_MIGRATIONS]){
    await db.exec('begin');try{await db.exec(sql('../migrations/'+file));await db.query('insert into public.schema_migrations(version)values($1)',[file]);await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}
   }
   assert.equal((await db.query('select count(*) n from public.schema_migrations')).rows[0].n,DEPLOYED_BASELINE.length+PENDING_MIGRATIONS.length+ADDITIONAL_MIGRATIONS.length);
   assert.equal((await as(ids.owner,'select public.is_support_super_admin() ok'))[0].ok,true);
   await deny(as(null,'select * from public.active_support_grants($1)',[ids.owner],'anon'));
  });
  await t.test('hotfix refuses newer schemas and does not downgrade the project-aware helper',async()=>{
   const before=(await db.query("select prosrc from pg_proc where oid='public.active_support_grants(uuid)'::regprocedure")).rows[0].prosrc;
   await assert.rejects(apply(hotfix),/baseline differs/);
   assert.equal((await db.query("select prosrc from pg_proc where oid='public.active_support_grants(uuid)'::regprocedure")).rows[0].prosrc,before);
  });
  await t.test('fail-closed fallback never restores anonymous or cross-user visibility',async()=>{
   await apply(containment);
   await deny(as(ids.owner,'select * from public.active_support_grants($1)',[ids.owner]));
   await deny(as(null,'select public.max_support_rank($1)',[ids.owner],'anon'));
   assert.equal((await as(ids.owner,'select public.is_support_super_admin() ok'))[0].ok,true);
  });
 }finally{await db.close();}
});
