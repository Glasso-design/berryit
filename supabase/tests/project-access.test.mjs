// Real PostgreSQL/RLS in an isolated in-memory PGlite. No GoTrue/JWT HTTP claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync,readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { assertIsolatedPgliteEnvironment } from './isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');

test('project and dynamic role security on the full migration chain',async t=>{
 const db=await PGlite.create({extensions:{pgcrypto}});
 const ids=Object.fromEntries(['owner','admin','support','developer','outsider','customer','legacyTech','orgA','orgB'].map(k=>[k,randomUUID()]));
 const as=async(user,sql,args=[],aal='aal2',role='authenticated')=>{
  await db.exec('begin');try{
   await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role,aal,session_id:user})]);
   assert.ok(['authenticated','anon','service_role'].includes(role));await db.exec('set local role '+role);
   const result=await db.query(sql,args);await db.exec('commit');return result.rows;
  }catch(e){await db.exec('rollback');throw e;}
 };
 const rpc=async(user,name,args=[],aal='aal2')=>(await as(user,`select public.${name}(${args.map((_,n)=>'$'+(n+1))}) result`,args,aal))[0].result;
 const deny=operation=>assert.rejects(operation,e=>['42501','22023','40001','23503'].includes(e.code));
 let project,otherProject,custom,developerGrant;
 const retained=[];
 try{
  await db.exec(read('local_bootstrap.sql'));
  const files=readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort();
  for(const [n,file]of files.entries()){
   if(file==='20261016090000_project_access.sql'){
    for(const k of ['owner','admin','support','developer','outsider','customer','legacyTech'])await db.query('insert into auth.users(id,email) values($1,$2)',[ids[k],k+'@example.test']);
    await db.query("update public.profiles set role='admin' where id=$1",[ids.admin]);
    await db.query("update public.profiles set role='technician' where id=$1",[ids.legacyTech]);
    await db.query("insert into public.support_role_grants(grantee_id,role_key,scope,reason) values($1,'BERRYIT_SUPPORT_SUPER_ADMIN','global','Synthetic owner recovery fixture')",[ids.owner]);
    for(const table of ['auth.users','public.profiles','public.support_role_grants','public.support_admin_audit'])
      retained.push({table,rows:(await db.query('select to_jsonb(x) data from '+table+' x')).rows.map(r=>r.data)});
   }
   await db.exec('begin');try{await db.exec(read('../migrations/'+file));await db.exec('commit');}catch(e){await db.exec('rollback');throw new Error(file+': '+e.message);}
   if(n===0)await db.exec(read('local_storage_bootstrap.sql'));
  }
  await db.exec("insert into auth.sessions(id,user_id,aal) select id,id,'aal2' from auth.users");
  await db.query("insert into public.organizations(id,name,is_internal) values($1,'Synthetic internal',true),($2,'Synthetic customer',false)",[ids.orgA,ids.orgB]);
  await t.test('forward migration preserves existing profile, Auth, grant and audit columns',async()=>{
   for(const before of retained){
    const after=(await db.query('select to_jsonb(x) data from '+before.table+' x')).rows.map(r=>r.data);
    for(const row of before.rows){const found=after.find(r=>r.id===row.id);assert.ok(found);
      const keys=Object.keys(row);
      assert.deepEqual(Object.fromEntries(keys.map(k=>[k,found[k]])),Object.fromEntries(keys.map(k=>[k,row[k]])));
    }
   }
   assert.equal(await rpc(ids.admin,'is_support_super_admin'),false);
   assert.equal(await rpc(ids.owner,'is_support_super_admin'),true);
   assert.equal(await rpc(ids.legacyTech,'has_support_permission',['infrastructure.read',ids.orgA],'aal1'),true);
   assert.equal(await rpc(ids.legacyTech,'has_support_permission',['repositories.read',ids.orgA],'aal1'),false);
  });
  await db.query('update public.profiles set organization_id=$1 where id=$2',[ids.orgA,ids.customer]);
  await t.test('admin creates a project without integrations',async()=>{
   project=await rpc(ids.admin,'save_support_project',[null,ids.orgA,JSON.stringify({name:'Manual project',source:'berryit'}),'Synthetic creation']);
   assert.equal((await as(ids.admin,'select source from public.support_projects where id=$1',[project]))[0].source,'berryit');
   assert.equal((await db.query('select count(*) n from public.connector_integrations')).rows[0].n,0);
   otherProject=await rpc(ids.admin,'save_support_project',[null,ids.orgB,JSON.stringify({name:'Other tenant'}),'Synthetic creation']);
  });
  await t.test('scoped developer grant does not grant another role',async()=>{
   developerGrant=await rpc(ids.admin,'grant_support_role',[ids.developer,'BERRYIT_DEVELOPER',ids.orgA,project,null,'Synthetic assignment']);
   assert.equal((await db.query('select count(*) n from public.support_role_grants where grantee_id=$1',[ids.developer])).rows[0].n,1);
  });
  await t.test('developer sees assigned project only and no customer directory',async()=>{
   assert.deepEqual((await as(ids.developer,'select id from public.support_projects')).map(r=>r.id),[project]);
   assert.equal((await as(ids.developer,'select id from public.profiles where id=$1',[ids.customer])).length,0);
   assert.equal(await rpc(ids.developer,'has_support_permission',['projects.read',ids.orgA]),false);
   assert.equal(await rpc(ids.developer,'has_resource_permission',['repositories.read',ids.orgA,project]),true);
   assert.equal(await rpc(ids.developer,'has_resource_permission',['repositories.write',ids.orgA,project]),false);
   assert.equal(await rpc(ids.developer,'has_resource_permission',['repositories.read',ids.orgB,project]),false);
  });
  for(const user of ['support','developer','outsider'])await t.test(user+' cannot administer projects or roles by direct RPC',async()=>{
   await deny(rpc(ids[user],'save_support_project',[null,ids.orgA,'{"name":"Attack"}','Attempted escalation']));
   await deny(rpc(ids[user],'grant_support_role',[ids[user],'BERRYIT_SUPPORT_ADMIN',ids.orgA,null,null,'Attempted escalation']));
   await deny(rpc(ids[user],'grant_support_role',[ids.customer,'BERRYIT_SUPPORT_ADMIN',ids.orgA,null,null,'Attempted escalation']));
   await deny(rpc(ids[user],'save_support_role',[null,'Forged admin','',['roles.grant'],ids.orgA,true,'Attempted escalation']));
  });
  await t.test('assigned developer cannot edit assigned or unassigned projects or attach arbitrary integrations',async()=>{
   await deny(rpc(ids.developer,'save_support_project',[project,ids.orgA,'{"name":"Own project write"}','Developer edit attempt',1]));
   await deny(rpc(ids.developer,'save_support_project',[otherProject,ids.orgB,'{"name":"Foreign project write"}','Developer tenant attempt',1]));
   await deny(rpc(ids.developer,'link_project_resource',[project,'integration',randomUUID(),'Unapproved repository connection']));
  });
  await t.test('direct table writes and catalog permission creation are denied',async()=>{
   await deny(as(ids.admin,"insert into public.support_projects(organization_id,name,created_by) values($1,'Direct',$2)",[ids.orgA,ids.admin]));
   await deny(as(ids.admin,"insert into public.support_permissions(key,description) values('shell.anything','Attack')"));
   await deny(as(ids.admin,"update public.support_roles set rank=100 where key='BERRYIT_DEVELOPER'"));
  });
  await t.test('MFA cannot be bypassed by privileged UI state',async()=>{
   await deny(rpc(ids.admin,'grant_support_role',[ids.support,'BERRYIT_DEVELOPER',ids.orgA,project,null,'No MFA attempt'],'aal1'));
   await deny(rpc(ids.admin,'save_support_role',[null,'Bad role','',['projects.read'],ids.orgA,true,'No MFA attempt'],'aal1'));
  });
  await t.test('profile role and user metadata are not authority sources',async()=>{
   await as(ids.customer,"update public.profiles set role='admin' where id=$1",[ids.customer]);
   assert.equal(await rpc(ids.customer,'is_admin'),false);
   await db.query("update public.profiles set role='admin' where id=$1",[ids.outsider]);
   await db.query('update auth.users set raw_user_meta_data=$1 where id=$2',[JSON.stringify({role:'admin',permissions:['roles.grant']}),ids.outsider]);
   assert.equal(await rpc(ids.outsider,'is_admin'),false);
   assert.equal(await rpc(ids.outsider,'is_support_super_admin'),false);
   await as(ids.admin,"update public.profiles set role='admin',is_machine=true where id=$1",[ids.customer]);
   assert.equal((await db.query('select role,is_machine from public.profiles where id=$1',[ids.customer])).rows[0].role,'customer');
  });
  await t.test('unknown permissions and protected system roles cannot be edited or delegated',async()=>{
   await deny(rpc(ids.admin,'save_support_role',[null,'Bad role','',['shell.anything'],ids.orgA,true,'Unknown permission']));
   await deny(rpc(ids.admin,'save_support_role',['BERRYIT_DEVELOPER','Changed','',[],null,false,'System role attack',1,'x']));
   await deny(rpc(ids.admin,'grant_support_role',[ids.outsider,'BERRYIT_SUPPORT_SUPER_ADMIN',null,null,null,'Owner escalation']));
   await deny(rpc(ids.owner,'grant_support_role',[ids.outsider,'BERRYIT_SUPPORT_SUPER_ADMIN',null,null,null,'Owner delegation attack']));
  });
  await t.test('custom role, combined permissions and precise project scope',async()=>{
   custom=await rpc(ids.admin,'save_support_role',[null,'Custom project reader','Synthetic custom role',['projects.read'],ids.orgA,true,'Create custom role']);
   await rpc(ids.admin,'grant_support_role',[ids.support,custom,ids.orgA,project,null,'Assign custom role']);
   assert.equal(await rpc(ids.support,'has_resource_permission',['projects.read',ids.orgA,project]),true);
   assert.equal(await rpc(ids.support,'has_resource_permission',['tickets.read',ids.orgA,null]),false);
   assert.equal(await rpc(ids.support,'has_resource_permission',['roles.manage',ids.orgA,null]),false);
   await rpc(ids.admin,'grant_support_role',[ids.support,'BERRYIT_SUPPORT_TECHNICIAN',ids.orgA,null,new Date(Date.now()+86400000).toISOString(),'Scoped support']);
   assert.equal(await rpc(ids.support,'has_resource_permission',['tickets.write',ids.orgA,null]),true);
   assert.equal(await rpc(ids.support,'has_resource_permission',['tickets.write',ids.orgB,null]),false);
   assert.equal(await rpc(ids.support,'has_resource_permission',['repositories.read',ids.orgA,project]),false);
   await deny(rpc(ids.support,'grant_support_role',[ids.support,'BERRYIT_SUPPORT_ADMIN',ids.orgA,null,null,'Actual IT SUPPORT escalation']));
   await deny(rpc(ids.support,'grant_support_role',[ids.outsider,'BERRYIT_SUPPORT_ADMIN',ids.orgA,null,null,'Actual IT SUPPORT grants admin to colleague']));
   await deny(rpc(ids.support,'save_support_project',[null,ids.orgA,'{"name":"Unauthorized IT project"}','Actual IT SUPPORT project attempt']));
  });
  await t.test('impact preview and optimistic revision required before editing roles',async()=>{
   const only=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[only,'single-custom-role@example.test']);
   await db.query("insert into auth.sessions(id,user_id,aal) values($1,$1,'aal1')",[only]);
   await rpc(ids.admin,'grant_support_role',[only,custom,ids.orgA,project,null,'Custom-only assignment']);
   const impact=await rpc(ids.admin,'support_role_impact',[custom]);assert.equal(impact.assignments.length,2);
   await deny(rpc(ids.admin,'save_support_role',[custom,'Changed','',['projects.read'],ids.orgA,false,'Archive role',1,'stale']));
   await rpc(ids.admin,'save_support_role',[custom,'Archived role','',['projects.read'],ids.orgA,false,'Archive role',1,impact.fingerprint]);
   assert.equal(await rpc(only,'has_resource_permission',['projects.read',ids.orgA,project],'aal1'),false);
   assert.equal(await rpc(ids.support,'has_resource_permission',['projects.read',ids.orgA,project]),true,'Separate IT SUPPORT assignment retains its own explicit read permission');
   assert.equal(await rpc(ids.support,'has_resource_permission',['tickets.write',ids.orgA,null]),true);
  });
  await t.test('revocation is effective with the same old session',async()=>{
   await rpc(ids.admin,'revoke_support_role',[developerGrant,'Synthetic revocation']);
   assert.equal(await rpc(ids.developer,'has_resource_permission',['repositories.read',ids.orgA,project]),false);
   assert.equal((await as(ids.developer,'select id from public.support_projects')).length,0);
  });
  await t.test('tampered org and project IDs, contact and cross tenant grants are denied',async()=>{
   await deny(rpc(ids.admin,'grant_support_role',[ids.developer,'BERRYIT_DEVELOPER',ids.orgB,project,null,'Forged tenant']));
   await deny(rpc(ids.admin,'save_support_project',[project,ids.orgB,'{"name":"Hijacked"}','Forged tenant',1]));
   await deny(rpc(ids.admin,'save_support_project',[otherProject,ids.orgB,JSON.stringify({contact_id:ids.customer}),'Forged contact',1]));
  });
  await t.test('archive preserves project and all service data',async()=>{
   const service=randomUUID();await db.query("insert into public.infra_services(id,organization_id,project_id,name) values($1,$2,$3,'Retained service')",[service,ids.orgA,project]);
   await rpc(ids.admin,'save_support_project',[project,ids.orgA,'{"archived":true}','Archive project',1]);
   assert.ok((await db.query('select archived_at from public.support_projects where id=$1',[project])).rows[0].archived_at);
   assert.equal((await db.query('select id from public.infra_services where id=$1',[service])).rows.length,1);
   await rpc(ids.admin,'save_support_project',[project,ids.orgA,'{"archived":false}','Reactivate project',2]);
  });
  await t.test('discovery is server only, deduplicates and never overwrites manual data',async()=>{
   const integration=randomUUID();
   await db.query("insert into public.connector_integrations(id,organization_id,connector_key,display_name,scope_kind,project_id,config,is_enabled,created_by) values($1,$2,'github','Synthetic discovery','project',$3,$4,true,$5)",[integration,ids.orgA,project,JSON.stringify({provider_project_id:'123456',repository:'synthetic/project'}),ids.admin]);
   await deny(rpc(ids.admin,'reconcile_discovered_project',[integration,'123456','Overwrite','Overwrite']));
   for(let n=0;n<2;n++)assert.equal((await as(null,'select public.reconcile_discovered_project($1,$2,$3,$4) result',[integration,'123456','Overwrite','Overwrite'],'aal1','service_role'))[0].result,project);
   assert.equal((await db.query('select count(*) n from public.project_external_identities')).rows[0].n,1);
   assert.equal((await db.query('select name from public.support_projects where id=$1',[project])).rows[0].name,'Manual project');
   assert.equal((await db.query('select count(*) n from public.support_role_grants where grantee_id=$1',[ids.admin])).rows[0].n,1);
  });
  await t.test('audit is append only and project history is scoped',async()=>{
   assert.ok((await rpc(ids.admin,'project_access_details',[project])).activity.length>=3);
   await deny(rpc(ids.developer,'project_access_details',[project]));
   await deny(as(ids.admin,"delete from public.support_admin_audit"));
   await deny(as(ids.admin,"update public.support_admin_audit set reason='rewritten'"));
   assert.ok((await db.query("select count(*) n from public.support_admin_audit where action='role.definition_saved'")).rows[0].n>=2);
  });
  await t.test('anonymous EXECUTE and private helper access are denied',async()=>{
   await deny(as(null,'select public.support_access_context()',[],'aal1','anon'));
   await deny(as(ids.admin,"select berryit_private.can_delegate('BERRYIT_DEVELOPER',null,null)"));
   const unsafe=await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','berryit_private') and p.prosecdef and p.proconfig is null");assert.equal(unsafe.rows.length,0);
   assert.equal((await db.query("select has_schema_privilege('authenticated','public','CREATE') allowed")).rows[0].allowed,false);
   for(const signature of ['public.perform_access_request(text,jsonb)','public.save_support_role(text,text,text,text[],uuid,boolean,text,bigint,text)','public.repository_read_context(uuid)','public.save_repository_review(uuid,text,text)'])
     assert.equal((await db.query("select has_function_privilege('anon',$1,'EXECUTE') allowed",[signature])).rows[0].allowed,false);
  });
  await t.test('expired developer grant is denied without refreshing session',async()=>{
   await db.query("insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,project_id,reason,granted_at,expires_at) values($1,'BERRYIT_DEVELOPER','organization',$2,$3,'Expired isolated grant',now()-interval '2 days',now()-interval '1 day')",[ids.developer,ids.orgA,project]);
   assert.equal(await rpc(ids.developer,'has_resource_permission',['repositories.read',ids.orgA,project]),false);
  });
  await t.test('revoking an inactive role is possible but granting it is denied',async()=>{
   const grant=(await db.query('select id from public.support_role_grants where role_key=$1',[custom])).rows[0].id;
   await rpc(ids.admin,'revoke_support_role',[grant,'Inactive role revoked']);
   await deny(rpc(ids.admin,'grant_support_role',[ids.outsider,custom,ids.orgA,project,null,'Inactive role assignment']));
  });
  await t.test('custom role edits cannot add a permission the editor does not possess',async()=>{
   // Ordinary ADMIN deliberately lacks owner-only escalation configuration.
   await deny(rpc(ids.admin,'save_support_role',[null,'Owner clone','',['escalation.configure'],ids.orgA,true,'Escalation attempt']));
   await deny(as(ids.support,"insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,reason,granted_by) values($1,'BERRYIT_SUPPORT_ADMIN','organization',$2,'Direct escalation',$3)",[ids.outsider,ids.orgA,ids.support]));
  });
  await t.test('organization administrator cannot administer another organization or global scope',async()=>{
   const scoped=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[scoped,'scoped-admin@example.test']);
   await db.query("insert into auth.sessions(id,user_id,aal) values($1,$1,'aal2')",[scoped]);
   await db.query("insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,reason) values($1,'BERRYIT_SUPPORT_ADMIN','organization',$2,'Scoped administrator fixture')",[scoped,ids.orgA]);
   await deny(rpc(scoped,'save_support_project',[null,ids.orgB,'{"name":"Other org attack"}','Scope attack']));
   await deny(rpc(scoped,'save_support_role',[null,'Global role attack','',['projects.read'],null,true,'Scope attack']));
   await deny(rpc(scoped,'grant_support_role',[ids.outsider,'BERRYIT_DEVELOPER',ids.orgB,otherProject,null,'Scope attack']));
   const role=await rpc(scoped,'save_support_role',[null,'Tenant role','',['projects.read'],ids.orgA,true,'Scoped custom role']);
   await deny(rpc(ids.admin,'grant_support_role',[ids.outsider,role,ids.orgB,otherProject,null,'Tenant role mismatch']));
   await deny(rpc(scoped,'access_administration_directory',[ids.orgB]));
  });
  await t.test('external custom developer has project-only code rights and cannot gain administration',async()=>{
   const externalRole=await rpc(ids.admin,'save_support_role',[null,'External reviewer','',['projects.read','repositories.read'],ids.orgA,true,'External role fixture']);
   const externalGrant=await rpc(ids.admin,'grant_support_role',[ids.outsider,externalRole,ids.orgA,project,new Date(Date.now()+86400000).toISOString(),'External review',true,'Synthetic consulting',ids.orgA]);
   assert.equal(await rpc(ids.outsider,'has_resource_permission',['repositories.read',ids.orgA,project]),true);
   assert.equal(await rpc(ids.outsider,'has_support_permission',['tickets.read',ids.orgA]),false);
   await deny(rpc(ids.admin,'grant_support_role',[ids.outsider,'BERRYIT_SUPPORT_ADMIN',ids.orgA,null,new Date(Date.now()+86400000).toISOString(),'External admin attempt',true,'Synthetic consulting',ids.orgA]));
   const impact=await rpc(ids.admin,'support_role_impact',[externalRole]);
   await deny(rpc(ids.admin,'save_support_role',[externalRole,'External reviewer','',['projects.read','roles.manage'],ids.orgA,true,'Escalate external role',1,impact.fingerprint]));
   await rpc(ids.admin,'revoke_support_role',[externalGrant,'External review done']);
   assert.equal(await rpc(ids.outsider,'has_resource_permission',['repositories.read',ids.orgA,project]),false);
  });
  await t.test('impact fingerprint rejects recipients added after preview',async()=>{
   const r=await rpc(ids.admin,'save_support_role',[null,'Concurrent role','',['projects.read'],ids.orgA,true,'Concurrent fixture']);
   const preview=await rpc(ids.admin,'support_role_impact',[r]);
   await rpc(ids.admin,'grant_support_role',[ids.outsider,r,ids.orgA,project,null,'New recipient after preview']);
   await deny(rpc(ids.admin,'save_support_role',[r,'Concurrent role','',[],ids.orgA,false,'Stale preview',1,preview.fingerprint]));
  });
  await t.test('inactive account loses current permissions and owners cannot be disabled',async()=>{
   await rpc(ids.admin,'set_support_user_active',[ids.support,false,'Deactivate synthetic technician']);
   assert.equal(await rpc(ids.support,'has_support_permission',['tickets.write',ids.orgA]),false);
   await rpc(ids.admin,'set_support_user_active',[ids.support,true,'Reactivate synthetic technician']);
   assert.equal(await rpc(ids.support,'has_support_permission',['tickets.write',ids.orgA]),true);
   await deny(rpc(ids.admin,'set_support_user_active',[ids.owner,false,'Attempted owner lockout']));
   await deny(rpc(ids.admin,'set_support_user_active',[ids.admin,false,'Attempted self lockout']));
  });
  await t.test('live MFA session revocation immediately blocks role administration',async()=>{
   await db.query("update auth.sessions set not_after=now()-interval '1 second' where user_id=$1",[ids.admin]);
   await deny(rpc(ids.admin,'save_support_role',[null,'Stale session','',['projects.read'],ids.orgA,true,'Expired session attempt']));
   await db.query('update auth.sessions set not_after=null where user_id=$1',[ids.admin]);
  });
  await t.test('repository context requires explicit project assignment and a pinned integration',async()=>{
   await deny(rpc(ids.developer,'repository_read_context',[project]));
   for(const g of (await db.query('select id from public.support_role_grants where grantee_id=$1 and revoked_at is null',[ids.developer])).rows)
     await rpc(ids.admin,'revoke_support_role',[g.id,'Replace expired assignment explicitly']);
   await rpc(ids.admin,'grant_support_role',[ids.developer,'BERRYIT_DEVELOPER',ids.orgA,project,null,'New code review assignment']);
   await db.query("update public.connector_integrations set secret_ref='synthetic_read_only' where project_id=$1",[project]);
   const context=await rpc(ids.developer,'repository_read_context',[project]);
   assert.equal(context.repository,'synthetic/project');assert.equal(context.provider_id,'123456');
   await deny(rpc(ids.developer,'repository_read_context',[otherProject]));
  });
  await t.test('project services validate node tenant and do not touch external resources',async()=>{
   const node=randomUUID();await db.query("insert into public.infra_nodes(id,organization_id,name) values($1,$2,'Synthetic foreign server')",[node,ids.orgB]);
   await deny(rpc(ids.admin,'create_project_service',[project,'Forged server',node,'web','staging',null,'Tenant mismatch']));
   const service=await rpc(ids.admin,'create_project_service',[project,'Synthetic local register',null,'web','staging',null,'Register only']);
   assert.equal((await db.query('select project_id from public.infra_services where id=$1',[service])).rows[0].project_id,project);
   await deny(rpc(ids.developer,'create_project_service',[project,'Forbidden service',null,'web','staging',null,'Developer write attempt']));
  });
  await t.test('read-only custom support cannot inherit writes through old staff policies',async()=>{
   const user=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[user,'readonly@example.test']);
   await db.query("insert into auth.sessions(id,user_id,aal) values($1,$1,'aal1')",[user]);
   const role=await rpc(ids.admin,'save_support_role',[null,'Read-only support','',['tickets.read'],null,true,'Read-only security fixture']);
   await rpc(ids.admin,'grant_support_role',[user,role,null,null,null,'Read-only assignment']);
   const ticket=randomUUID();await db.query("insert into public.tickets(id,organization_id,requester_id,subject,description,category_key) values($1,$2,$3,'Read only ticket','Synthetic read-only regression','ovrigt')",[ticket,ids.orgA,ids.customer]);
   assert.equal((await as(user,'select id from public.tickets where id=$1',[ticket],'aal1')).length,1);
   assert.equal(await rpc(user,'can_work_ticket',[ticket],'aal1'),false);
   assert.equal((await as(user,"update public.tickets set status_key='pagar' where id=$1 returning id",[ticket],'aal1')).length,0);
   await deny(as(user,"insert into public.ticket_messages(ticket_id,author_id,body,is_from_staff) values($1,$2,'Forbidden write',true)",[ticket,user],'aal1'));
   await deny(as(user,"insert into public.ticket_internal_notes(ticket_id,author_id,body) values($1,$2,'Forbidden internal write')",[ticket,user],'aal1'));
   assert.equal((await as(user,'select id from public.infra_nodes',[],'aal1')).length,0);
  });
  await t.test('project-scoped IT SUPPORT can work its tickets and cannot cross the project boundary',async()=>{
   const user=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[user,'project-support@example.test']);
   await db.query("insert into auth.sessions(id,user_id,aal) values($1,$1,'aal1')",[user]);
   const grant=await rpc(ids.admin,'grant_support_role',[user,'BERRYIT_SUPPORT_TECHNICIAN',ids.orgA,project,null,'Project support assignment']);
   const another=await rpc(ids.admin,'save_support_project',[null,ids.orgA,'{"name":"Same tenant other project"}','Separate project fixture']);
   const ticket=(await as(user,"insert into public.tickets(organization_id,project_id,requester_id,subject,description,category_key) values($1,$2,$3,'Project support case','Synthetic scoped support case','ovrigt') returning id",[ids.orgA,project,ids.customer],'aal1'))[0].id;
   const hidden=randomUUID();await db.query("insert into public.tickets(id,organization_id,project_id,requester_id,subject,description,category_key) values($1,$2,$3,$4,'Other project case','Synthetic different project','ovrigt')",[hidden,ids.orgA,another,ids.customer]);
   assert.equal((await as(user,'select id from public.tickets',[],'aal1')).length,1);
   assert.equal((await as(user,'select id from public.organizations where id=$1',[ids.orgA],'aal1')).length,1);
   assert.equal(await rpc(user,'can_work_ticket',[ticket],'aal1'),true);
   assert.equal(await rpc(user,'can_work_ticket',[hidden],'aal1'),false);
   await as(user,"insert into public.ticket_messages(ticket_id,author_id,body,is_from_staff) values($1,$2,'Project scoped answer',true)",[ticket,user],'aal1');
   await as(user,"insert into public.ticket_internal_notes(ticket_id,author_id,body) values($1,$2,'Project scoped internal note')",[ticket,user],'aal1');
   await deny(as(user,"insert into public.ticket_internal_notes(ticket_id,author_id,body) values($1,$2,'Other project attack')",[hidden,user],'aal1'));
   await deny(as(user,"insert into public.tickets(organization_id,project_id,requester_id,subject,description,category_key) values($1,$2,$3,'Other project attack','Synthetic attack case','ovrigt')",[ids.orgA,another,ids.customer],'aal1'));
   await rpc(ids.admin,'revoke_support_role',[grant,'Project assignment ended']);
   assert.equal((await as(user,'select id from public.tickets',[],'aal1')).length,0);
   await deny(as(user,"insert into public.ticket_messages(ticket_id,author_id,body,is_from_staff) values($1,$2,'Revoked project write',true)",[ticket,user],'aal1'));
  });
  await t.test('application RPC logs denied privilege attempts without committing partial work',async()=>{
   const result=await rpc(ids.customer,'perform_access_request',['save_support_project',{p_id:null,p_organization_id:ids.orgA,p_values:{name:'Denied audited attempt'},p_reason:'Synthetic attack',p_revision:null}]);
   assert.equal(result.ok,false);assert.equal(result.code,'42501');
   assert.equal((await db.query("select id from public.support_projects where name='Denied audited attempt'")).rows.length,0);
   assert.equal((await db.query("select id from public.support_admin_audit where actor_id=$1 and action='access.denied'",[ids.customer])).rows.length,1);
   await deny(rpc(ids.customer,'perform_access_request',['arbitrary_sql',{sql:'select anything'}]));
  });
  await t.test('inactive account is denied even self-profile reads by restrictive RLS',async()=>{
   await rpc(ids.admin,'set_support_user_active',[ids.customer,false,'Disable synthetic customer']);
   assert.equal((await as(ids.customer,'select id from public.profiles')).length,0);
   assert.equal((await as(ids.customer,'select id from public.tickets')).length,0);
   assert.equal((await rpc(ids.customer,'support_access_context')).accountActive,false);
   await rpc(ids.admin,'set_support_user_active',[ids.customer,true,'Re-enable synthetic customer']);
  });
  await t.test('copying a system role creates only an ordinary custom permission template',async()=>{
   const copy=await rpc(ids.admin,'save_support_role',[null,'Developer copy','Synthetic copied role',['projects.read','repositories.read'],ids.orgA,true,'Copy developer template']);
   const row=(await db.query('select is_system,rank from public.support_roles where key=$1',[copy])).rows[0];
   assert.equal(row.is_system,false);assert.equal(row.rank,1);
   assert.equal((await db.query("select is_system from public.support_roles where key='BERRYIT_DEVELOPER'")).rows[0].is_system,true);
   assert.equal((await db.query('select id from public.support_role_grants where role_key=$1',[copy])).rows.length,0);
  });
  await t.test('another user session ID cannot satisfy MFA',async()=>{
   await db.exec('begin');try{
    await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.admin,role:'authenticated',aal:'aal2',session_id:ids.owner})]);await db.exec('set local role authenticated');
    assert.equal((await db.query('select public.session_is_live() live')).rows[0].live,false);
    assert.equal((await db.query("select public.has_support_permission('roles.grant') allowed")).rows[0].allowed,false);
   }finally{await db.exec('rollback');}
  });
  await t.test('developer can record a private code proposal without repository writes or raw code in audit',async()=>{
   const body='SYNTHETIC-PRIVATE-CODE: propose validating the response before rendering.';
   const note=await rpc(ids.developer,'save_repository_review',[project,body,'Synthetic code review'],'aal1');
   assert.equal((await as(ids.developer,'select body from public.repository_review_notes where id=$1',[note],'aal1'))[0].body,body);
   assert.equal((await as(ids.customer,'select id from public.repository_review_notes')).length,0);
   assert.equal((await rpc(ids.outsider,'project_access_details',[project])).reviews.length,0);
   await deny(as(ids.developer,"update public.repository_review_notes set body='rewritten' where id=$1",[note],'aal1'));
   const log=(await db.query("select metadata,reason from public.support_admin_audit where action='repository.review_recorded'")).rows;
   assert.equal(log.length,1);assert.equal(JSON.stringify(log).includes('SYNTHETIC-PRIVATE-CODE'),false);
   for(const grant of (await db.query('select id from public.support_role_grants where grantee_id=$1 and revoked_at is null',[ids.developer])).rows)
     await rpc(ids.admin,'revoke_support_role',[grant.id,'Review assignment complete']);
   await deny(rpc(ids.developer,'save_repository_review',[project,'Revoked proposal','Stale developer session'],'aal1'));
  });
  await t.test('editing a live custom role removes permissions for existing sessions immediately',async()=>{
   const user=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[user,'edited-role@example.test']);
   await db.query("insert into auth.sessions(id,user_id,aal) values($1,$1,'aal1')",[user]);
   const role=await rpc(ids.admin,'save_support_role',[null,'Editable review role','',['projects.read','repositories.read'],ids.orgA,true,'Live edit fixture']);
   await rpc(ids.admin,'grant_support_role',[user,role,ids.orgA,project,null,'Live edit assignment']);
   assert.equal(await rpc(user,'has_resource_permission',['repositories.read',ids.orgA,project],'aal1'),true);
   const impact=await rpc(ids.admin,'support_role_impact',[role]);
   await rpc(ids.admin,'save_support_role',[role,'Editable project reader','',['projects.read'],ids.orgA,true,'Remove code access',1,impact.fingerprint]);
   assert.equal(await rpc(user,'has_resource_permission',['repositories.read',ids.orgA,project],'aal1'),false);
   assert.equal(await rpc(user,'has_resource_permission',['projects.read',ids.orgA,project],'aal1'),true);
  });
  await t.test('project health keeps source and timestamp without exposing other projects or raw node detail',async()=>{
   const service=(await db.query('select id from public.infra_services where project_id=$1 limit 1',[project])).rows[0].id;
   const other=randomUUID();await db.query("insert into public.infra_services(id,organization_id,project_id,name) values($1,$2,$3,'Other tenant health')",[other,ids.orgB,otherProject]);
   for(const [id,org]of [[service,ids.orgA],[other,ids.orgB]])await db.query("insert into public.service_status_checks(organization_id,service_id,status_key,source,detail) values($1,$2,'degraded','http_health',$3)",[org,id,JSON.stringify({node_secret:'SYNTHETIC-NODE-DETAIL'})]);
   const health=await rpc(ids.outsider,'project_registry_status');
   assert.equal(health.length,1);assert.equal(health[0].service_id,service);assert.equal(health[0].status_key,'degraded');
   assert.equal(health[0].source,'http_health');assert.ok(health[0].checked_at);
   assert.equal(JSON.stringify(health).includes('SYNTHETIC-NODE-DETAIL'),false);
   assert.equal((await rpc(ids.customer,'project_registry_status')).length,0);
  });
 }finally{await db.close();}
});
