// Real SQL and RLS, synthetic in-memory PGlite only. No Auth/Storage HTTP claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from '../../services/platform-factory/tests/fixture.mjs';
import {assertIsolatedPgliteEnvironment} from './isolated-environment.mjs';
import {requestedProjectNames} from '../../shared/project-candidates.ts';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
const deny=p=>assert.rejects(p,e=>['42501','22023','23503','23505','23514','PT409','55000'].includes(e.code));
test('Project Control Center: complete migration, protected workflow and isolation',async t=>{
 const f=await fixture(),{db,ids,rpc,as}=f;
 const save=(user,id=null,project=ids.projectA,values={},revision=null)=>rpc(user,'save_project_task',[id,project,JSON.stringify({title:'Synthetic task',description:'Synthetic troubleshooting',status:'todo',priority:'normal',visibility:'internal',assignee_id:null,due_at:null,checklist:[],...values}),revision,'Synthetic task change']);
 const reader=randomUUID();let task,publicTask,readerRole,attachment,link,githubTask,repoA,repoAlias,foreignRepo;
 try{
  await db.query('insert into auth.users(id,email) values($1,$2)',[reader,'reader@project-control.example.test']);await db.query("insert into auth.sessions(id,user_id,aal) values($1,$1,'aal2')",[reader]);
  readerRole=await rpc(ids.adminA,'save_support_role',[null,'Synthetic project reader','Scoped reader',['projects.read','tasks.read','projects.activity.read'],ids.orgA,true,'Synthetic reader role']);
  await rpc(ids.adminA,'grant_support_role',[reader,readerRole,ids.orgA,ids.projectA,null,'Explicit synthetic project assignment']);
  await t.test('task CRUD, assignee, deadline, checklist and optimistic revision',async()=>{
   task=await save(ids.adminA,null,ids.projectA,{assignee_id:ids.developer,due_at:'2027-01-01T12:00:00Z',checklist:[{id:randomUUID(),text:'Check approved telemetry',done:false}]});
   let d=await rpc(ids.developer,'project_task_details',[task]);assert.equal(d.task.assignee_id,ids.developer);assert.equal(d.task.checklist.length,1);
   await save(ids.developer,task,ids.projectA,{status:'blocked',priority:'critical'},1);d=await rpc(ids.adminA,'project_task_details',[task]);assert.equal(d.task.revision,2);assert.equal(d.task.status,'blocked');
   await deny(save(ids.developer,task,ids.projectA,{title:'Stale overwrite'},1));
   publicTask=await save(ids.adminA,null,ids.projectA,{title:'Visible project task',visibility:'project'});
  });
  await t.test('tenant, customer and manipulated IDs fail through RPC and actual RLS',async()=>{
   for(const user of [ids.adminB,ids.customerA,ids.customerB]){
    assert.equal((await as(user,'select id from public.project_tasks where id=$1',[task])).length,0);
    await deny(rpc(user,'project_task_details',[task]));await deny(save(user,null,ids.projectA));
   }
   await deny(save(ids.developer,task,ids.projectB,{},2));await deny(save(ids.adminA,null,ids.projectA,{organization_id:ids.orgB}));
   await deny(save(ids.adminA,null,ids.projectA,{assignee_id:ids.adminB}));
   assert.deepEqual((await as(reader,'select id from public.project_tasks')).map(x=>x.id),[publicTask]);
  });
  await t.test('comments and task history never leak internal work',async()=>{
   await rpc(ids.adminA,'project_task_comment',[publicTask,'Synthetic public comment','project']);
   await rpc(ids.adminA,'project_task_comment',[publicTask,'Synthetic internal comment','internal']);
   const d=await rpc(reader,'project_task_details',[publicTask]);assert.equal(d.comments.length,1);assert.equal(d.comments[0].body,'Synthetic public comment');
   const events=await rpc(reader,'project_activity_page',[ids.projectA]);assert.ok(!JSON.stringify(events).includes('Synthetic internal comment'));
   await deny(as(ids.adminA,"update public.project_task_comments set body='Tampered' where task_id=$1",[publicTask]));
   await deny(as(ids.adminA,'delete from public.project_activity where project_id=$1',[ids.projectA]));
  });
  await t.test('direct writes, anonymous RPCs and forged status/source are denied',async()=>{
   await deny(as(ids.adminA,"update public.project_tasks set title='Direct bypass' where id=$1",[task]));
   await deny(as(ids.adminA,"insert into public.project_tasks(project_id,organization_id,title,created_by) values($1,$2,'Forged',$3)",[ids.projectA,ids.orgB,ids.adminA]));
   await deny(as(ids.customerA,'select public.project_control_overview($1)',[ids.projectA],'aal1','anon'));
   await deny(rpc(ids.adminA,'record_project_evidence',[ids.projectA,JSON.stringify({kind:'release',title:'Forged verification',source_kind:'connector',stage:'PRODUCTION',body:''}),'Synthetic attack']));
   await deny(rpc(ids.adminA,'record_project_evidence',[ids.projectA,JSON.stringify({kind:'release',title:'Forged flag',system_verified:true}),'Synthetic attack']));
  });
  await t.test('business information is separate from operational/code access and AI',async()=>{
   await rpc(ids.adminA,'save_project_control',[ids.projectA,'business',JSON.stringify({owner_kind:'external',owner_label:'Synthetic contract owner',agreement_reference:'CONTRACT-CANARY-ONLY'}),'Synthetic business metadata']);
   await rpc(ids.adminA,'save_project_control',[ids.projectA,'code',JSON.stringify({frontend:'Synthetic UI',local_paths:['C:\\synthetic\\private-path-canary']}),'Synthetic code metadata']);
   const d=await rpc(ids.developer,'project_control_overview',[ids.projectA]);assert.equal(d.business,null);assert.equal(d.code.frontend,'Synthetic UI');
   assert.equal((await as(ids.developer,'select * from public.project_business_records')).length,0);
   await deny(rpc(ids.adminA,'save_project_control',[ids.projectA,'business','{}','Synthetic missing MFA'],'aal1'));
   const context=await rpc(ids.adminA,'project_control_ai_context',[ids.projectA]);assert.ok(context.facts.some(x=>x.kind==='task'));
   assert.ok(!JSON.stringify(context).includes('CONTRACT-CANARY-ONLY'));assert.ok(!JSON.stringify(context).includes('private-path-canary'));
  });
  await t.test('infrastructure projection is project-scoped and omits raw detail/credential URLs',async()=>{
   const node=randomUUID(),service=randomUUID(),foreign=randomUUID();
   await db.query("insert into public.infra_nodes(id,organization_id,name,hostname) values($1,$2,'Synthetic node','192.0.2.10')",[node,ids.orgA]);
   await db.query("insert into public.infra_services(id,organization_id,project_id,node_id,name,url,is_active) values($1,$2,$3,$4,'Intentionally paused','https://example.invalid/?token=SYNTHETIC-CANARY',false),($5,$6,$7,null,'Foreign service','https://example.invalid',true)",[service,ids.orgA,ids.projectA,node,foreign,ids.orgB,ids.projectB]);
   const source=(await db.query('select key from public.connector_kinds order by key limit 1')).rows[0].key;
   await db.query("insert into public.service_status_checks(organization_id,service_id,status_key,source,detail) values($1,$2,'unknown',$3,'{\"sensitive_canary\":\"NEVER-RETURN-RAW\"}')",[ids.orgA,service,source]);
   const d=await rpc(ids.adminA,'project_control_overview',[ids.projectA]);assert.equal(d.services.length,1);assert.equal(d.services[0].is_active,false);assert.equal(d.services[0].url,null);assert.equal(d.checks[0].status_key,'unknown');assert.ok(!JSON.stringify(d).includes('NEVER-RETURN-RAW'));
   assert.equal((await rpc(ids.developer,'project_control_overview',[ids.projectA])).services.length,0);
  });
  await t.test('manual/AI release claims are visibly unverified and append-only',async()=>{
   const evidence=await rpc(ids.adminA,'record_project_evidence',[ids.projectA,JSON.stringify({kind:'release',title:'Synthetic registered version',body:'Not a provider deployment',stage:'PRODUCTION',source_kind:'manual',version:'0.0.1',branch:'synthetic-reviewed-branch',occurred_at:new Date().toISOString()}),'Synthetic local evidence']);
   await rpc(ids.adminA,'record_project_evidence',[ids.projectA,JSON.stringify({kind:'summary',title:'AI-SUMMARY-CANARY',body:'Unverified AI claim',stage:'LOCAL',source_kind:'ai_summary'}),'Synthetic AI summary']);
   const d=await rpc(ids.adminA,'project_control_overview',[ids.projectA]);assert.equal(d.latestVerifiedVersion,null);assert.equal(d.releases[0].system_verified,false);assert.equal(d.backup.status,'UNVERIFIED');
   await rpc(ids.adminA,'link_project_task',[task,'evidence',evidence]);
   assert.ok(!JSON.stringify(await rpc(ids.adminA,'project_control_ai_context',[ids.projectA])).includes('AI-SUMMARY-CANARY'));
   assert.match(JSON.stringify(await rpc(ids.adminA,'project_control_ai_context',[ids.projectA])),/branch=synthetic-reviewed-branch/);
   await deny(as(ids.adminA,'update public.project_evidence set system_verified=true where id=$1',[evidence]));
  });
  await t.test('private attachments bind to exact task/uploader/object size',async()=>{
   await db.exec("alter table storage.objects add column metadata jsonb; grant update on storage.objects to authenticated");
   attachment=await rpc(ids.adminA,'prepare_project_task_attachment',[task,'synthetic.txt','text/plain',3]);
   await deny(rpc(ids.adminA,'complete_project_task_attachment',[attachment.id]));
   await deny(rpc(ids.adminB,'prepare_project_task_attachment',[task,'attack.txt','text/plain',3]));
   await deny(as(ids.adminB,'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['project-task-attachments',attachment.path,'{"size":3}']));
   await as(ids.adminA,'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['project-task-attachments',attachment.path,'{"size":4}']);
   await deny(rpc(ids.adminA,'complete_project_task_attachment',[attachment.id]));
   await db.query('update storage.objects set metadata=$1 where name=$2',['{"size":3}',attachment.path]);await rpc(ids.adminA,'complete_project_task_attachment',[attachment.id]);
   assert.equal(await rpc(ids.adminA,'project_task_attachment_path',[attachment.id]),attachment.path);
   await deny(rpc(reader,'project_task_attachment_path',[attachment.id]));
   await db.exec('create policy synthetic_permissive_all on storage.objects for all to authenticated using(true) with check(true)');
   assert.equal((await as(reader,'select name from storage.objects where name=$1',[attachment.path])).length,0);
   assert.equal((await as(ids.adminA,'delete from storage.objects where name=$1 returning name',[attachment.path])).length,0);
   assert.equal((await as(ids.adminA,"update storage.objects set metadata='{}' where name=$1 returning name",[attachment.path])).length,0);
   await deny(as(reader,'insert into storage.objects(bucket_id,name) values($1,$2)',['project-task-attachments','arbitrary-path']));
  });
  await t.test('Support Desk links bind to the existing tenant/project ticket IDs',async()=>{
   const category=(await db.query('select key from public.ticket_categories order by key limit 1')).rows[0].key;
   const own=randomUUID(),foreign=randomUUID();
   await db.query("insert into public.tickets(id,reference,organization_id,project_id,requester_id,subject,description,category_key) values($1,'PCC-A',$2,$3,$4,'Synthetic support A','Synthetic description A',$5),($6,'PCC-B',$7,$8,$9,'Synthetic support B','Synthetic description B',$5)",[own,ids.orgA,ids.projectA,ids.customerA,category,foreign,ids.orgB,ids.projectB,ids.customerB]);
   await rpc(ids.adminA,'link_project_task',[task,'support_ticket',own]);await deny(rpc(ids.adminA,'link_project_task',[task,'support_ticket',foreign]));
   assert.equal((await rpc(ids.adminA,'project_control_overview',[ids.projectA])).support[0].reference,'PCC-A');
   assert.equal((await rpc(ids.developer,'project_control_overview',[ids.projectA])).support.length,0);
  });
  await t.test('an internal attachment and old private history stay private when a task becomes public',async()=>{
   await save(ids.adminA,task,ids.projectA,{visibility:'project'},2);
   assert.equal((await rpc(reader,'project_task_details',[task])).attachments.length,0);await deny(rpc(reader,'project_task_attachment_path',[attachment.id]));
   assert.equal((await as(reader,'select name from storage.objects where name=$1',[attachment.path])).length,0);
   const h=await rpc(reader,'project_task_history',[task]);assert.equal(h.items.length,0);
   await save(ids.adminA,task,ids.projectA,{visibility:'internal'},3);
  });
  await t.test('GitHub import is server-only, pinned, idempotent across connection aliases',async()=>{
   [repoA,repoAlias,foreignRepo]=[randomUUID(),randomUUID(),randomUUID()];
   for(const [id,project,org]of [[repoA,ids.projectA,ids.orgA],[repoAlias,ids.projectA,ids.orgA],[foreignRepo,ids.projectB,ids.orgB]])await db.query("insert into public.connector_integrations(id,organization_id,project_id,scope_kind,connector_key,display_name,access_mode,is_enabled,config,secret_ref) values($1,$2,$3,'project','github',$5,'read_only',true,$4,'synthetic-reference')",[id,org,project,JSON.stringify({repository:'synthetic/project',provider_project_id:'42',private_canary:'NEVER-RETURN'}),'Synthetic read '+id]);
   const issue={id:'12345',number:7,title:'Synthetic issue',body:'Synthetic issue body',state:'open',updated_at:'2026-10-25T08:00:00Z'};
   const args=[ids.projectA,repoA,ids.adminA,ids.adminA,JSON.stringify(issue)];
   await deny(rpc(ids.adminA,'import_project_github_issue',args));
   const first=await rpc(ids.owner,'import_project_github_issue',args,'aal2','service_role');githubTask=first.taskId;assert.equal(first.created,true);
   const second=await rpc(ids.owner,'import_project_github_issue',[ids.projectA,repoAlias,ids.adminA,ids.adminA,JSON.stringify(issue)],'aal2','service_role');assert.equal(second.taskId,githubTask);assert.equal(second.created,false);
   await deny(rpc(ids.owner,'import_project_github_issue',[ids.projectB,foreignRepo,ids.adminB,ids.adminB,JSON.stringify(issue)],'aal2','service_role'));
   await deny(rpc(ids.adminA,'link_project_task',[task,'github_issue',repoAlias,7]));
   assert.equal(JSON.stringify(await rpc(ids.adminA,'project_control_overview',[ids.projectA])).includes('NEVER-RETURN'),false);
  });
  await t.test('sync proposals never overwrite manual edits without explicit revision approval',async()=>{
   await save(ids.adminA,githubTask,ids.projectA,{title:'Manually maintained issue task'},1);
   await rpc(ids.owner,'import_project_github_issue',[ids.projectA,repoA,ids.adminA,ids.adminA,JSON.stringify({id:'12345',number:7,title:'Remote updated issue',body:'Remote content',state:'closed',updated_at:'2026-10-25T09:00:00Z'})],'aal2','service_role');
   let d=await rpc(ids.adminA,'project_task_details',[githubTask]);assert.equal(d.task.title,'Manually maintained issue task');link=d.links.find(x=>x.kind==='github_issue');assert.equal(link.proposal.title,'Remote updated issue');
   await deny(rpc(ids.adminA,'accept_project_issue_proposal',[link.id,1,'Stale approval']));
   await rpc(ids.adminA,'accept_project_issue_proposal',[link.id,2,'Explicit synthetic approval']);d=await rpc(ids.adminA,'project_task_details',[githubTask]);assert.equal(d.task.title,'Remote updated issue');assert.equal(d.task.status,'done');
  });
  await t.test('atomic batch import rolls back earlier items on a later invalid issue',async()=>{
   const before=(await db.query('select count(*) n from public.project_tasks')).rows[0].n;
   await deny(rpc(ids.owner,'import_project_github_issues',[ids.projectA,repoA,ids.adminA,ids.adminA,JSON.stringify([{id:'99999',number:99,title:'Batch valid first',body:'Synthetic',state:'open',updated_at:new Date().toISOString()},{id:'invalid'}])],'aal2','service_role'));
   assert.equal((await db.query('select count(*) n from public.project_tasks')).rows[0].n,before);
  });
  await t.test('same-timestamp keyset pages retain all 251 tasks and 251 history entries',async()=>{
   await db.query("insert into public.project_tasks(project_id,organization_id,title,created_by,updated_at) select $1,$2,'Pagination task '||n,$3,'2026-01-01T00:00:00Z' from generate_series(1,251)n",[ids.projectA,ids.orgA,ids.adminA]);
   await db.query("insert into public.project_activity(project_id,organization_id,actor_id,action,category,source_kind,visibility,reason,occurred_at) select $1,$2,$3,'pagination.event','task','system','internal','Synthetic pagination','2026-01-01T00:00:00Z' from generate_series(1,251)",[ids.projectA,ids.orgA,ids.adminA]);
   for(const kind of ['tasks','history']){
    const found=[];let last=null,more=true,pages=0;
    while(more){const p=kind==='tasks'?await rpc(ids.adminA,'list_project_tasks',[ids.projectA,null,null,null,last?.updated_at??null,last?.id??null,false]):await rpc(ids.adminA,'project_activity_page',[ids.projectA,last?.occurred_at??null,last?.id??null]);assert.ok(++pages<10);found.push(...p.items);last=p.items.at(-1);more=p.hasMore;}
    assert.equal(new Set(found.map(x=>x.id)).size,found.length);assert.equal(found.filter(x=>kind==='tasks'?x.title.startsWith('Pagination task'):x.action==='pagination.event').length,251);
   }
  });
  await t.test('soft archive preserves comments, objects, history and external resources',async()=>{
   await save(ids.adminA,task,ids.projectA,{archived:true},4);assert.equal((await rpc(ids.adminA,'project_task_details',[task])).task.archived_at!==null,true);
   assert.ok((await rpc(ids.adminA,'list_project_tasks',[ids.projectA,null,null,null,null,null,true])).items.some(x=>x.id===task));
   assert.equal((await db.query('select count(*) n from storage.objects where name=$1',[attachment.path])).rows[0].n,1);
   const before=(await db.query('select count(*) n from public.project_tasks')).rows[0].n;
   await rpc(ids.adminA,'save_support_project',[ids.projectA,ids.orgA,'{"archived":true}','Synthetic archive',1]);await deny(save(ids.adminA));
   assert.equal((await db.query('select count(*) n from public.project_tasks')).rows[0].n,before);
   await rpc(ids.adminA,'save_support_project',[ids.projectA,ids.orgA,'{"archived":false}','Synthetic reactivate',2]);
  });
  await t.test('release evidence and task history paginate without dropping tied timestamps',async()=>{
   await db.query("insert into public.project_evidence(project_id,organization_id,kind,title,stage,source_kind,actor_id,occurred_at) select $1,$2,'test','Evidence page '||n,'LOCAL','manual',$3,'2026-01-02T00:00:00Z' from generate_series(1,151)n",[ids.projectA,ids.orgA,ids.adminA]);
   const all=[];let last=null,more=true;while(more){const page=await rpc(ids.adminA,'project_evidence_page',[ids.projectA,last?.occurred_at??null,last?.id??null]);all.push(...page.items);last=page.items.at(-1);more=page.hasMore;assert.ok(all.length<200);}
   assert.equal(new Set(all.map(x=>x.id)).size,all.length);assert.equal(all.filter(x=>x.title.startsWith('Evidence page')).length,151);
   const h=await rpc(ids.adminA,'project_task_history',[task]);assert.ok(h.items.some(e=>e.action==='task.archived'));assert.ok(h.items.some(e=>e.action==='task.created'));await deny(rpc(ids.adminB,'project_task_history',[task]));
  });
  await t.test('requested name registration uses the same register without fabricated details',async()=>{
   const one=await rpc(ids.adminA,'register_project_names',[ids.orgA,JSON.stringify(requestedProjectNames),'Synthetic requested names']);assert.equal(one.filter(x=>x.created).length,requestedProjectNames.length);
   const again=await rpc(ids.adminA,'register_project_names',[ids.orgA,JSON.stringify(requestedProjectNames.map(x=>x.toLowerCase())),'Synthetic duplicate retry']);assert.equal(again.filter(x=>x.created).length,0);assert.deepEqual(again.map(x=>x.id),one.map(x=>x.id));
   assert.equal((await db.query('select count(*) n from public.project_business_records where project_id=$1',[one[0].id])).rows[0].n,0);
   await deny(rpc(ids.developer,'register_project_names',[ids.orgA,'["Unauthorized"]','Synthetic attack']));await deny(rpc(ids.adminA,'register_project_names',[ids.orgB,'["Unauthorized"]','Cross tenant attack']));
  });
  await t.test('Factory stays MOCK, new QABGO quota is 1GB and previous explicit quota remains unchanged',async()=>{
   const old=(await rpc(ids.adminA,'factory_snapshot',[await f.create(f.request({storageQuotaBytes:10000000000}))])).instance;const recent=(await rpc(ids.adminA,'factory_snapshot',[await f.create()])).instance;
   const d=await rpc(ids.adminA,'project_control_overview',[ids.projectA]);assert.equal(d.factory.status,'MOCK');assert.equal(d.factory.items.find(i=>i.id===old.id).quota_bytes,10000000000);assert.equal(d.factory.items.find(i=>i.id===recent.id).quota_bytes,1000000000);
  });
  await t.test('revocation, expiration and logout apply to existing sessions on the next call',async()=>{
   const g=(await db.query("select id from public.support_role_grants where grantee_id=$1 and role_key='BERRYIT_DEVELOPER'",[ids.developer])).rows[0].id;
   await db.query("update public.support_role_grants set granted_at=now()-interval '2 days',expires_at=now()-interval '1 minute' where id=$1",[g]);assert.equal((await as(ids.developer,'select id from public.project_tasks')).length,0);
   await rpc(ids.adminA,'revoke_support_role',[g,'Synthetic immediate revocation']);await deny(rpc(ids.developer,'project_task_details',[task]));
   await db.query('delete from auth.sessions where user_id=$1',[reader]);assert.equal((await as(reader,'select id from public.project_tasks')).length,0);await deny(rpc(reader,'project_control_overview',[ids.projectA]));
   await deny(rpc(reader,'project_control_ai_context',[ids.projectA]));
  });
  await t.test('SECURITY DEFINER functions have empty search_path and no anonymous EXECUTE',async()=>{
   const names=[...readFileSync(new URL('../migrations/20261025112940_project_control_center.sql',import.meta.url),'utf8').matchAll(/create function public\.([a-z_]+)/g)].map(m=>m[1]);
   const rows=(await db.query("select p.proname,p.proconfig,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.proname=any($1::text[])",[names])).rows;
   assert.ok(rows.length>=10);for(const r of rows){assert.equal(r.anon,false,r.proname);assert.ok(r.proconfig.some(x=>x==='search_path=""'),r.proname);}
  });
 }finally{await db.close();}
});

test('forward upgrade retains existing rows; an unsafe pre-existing bucket aborts atomically',async t=>{
 const read=p=>readFileSync(new URL(p,import.meta.url),'utf8'),migration='20261025112940_project_control_center.sql',r1Migration='20261025160000_pcc_http_conflict_and_ai_context.sql';
 for(const unsafe of [false,true])await t.test(unsafe?'public/conflicting bucket fails closed without changing it':'existing Auth, projects, tickets, grants, audit and Storage rows remain intact',async()=>{
  const db=await PGlite.create({extensions:{pgcrypto}});
  try{
   await db.exec(read('./local_bootstrap.sql'));
   for(const [n,file]of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')&&x!==migration&&x!==r1Migration).sort().entries()){
    await db.exec(read('../migrations/'+file));if(n===0)await db.exec(read('./local_storage_bootstrap.sql'));
   }
   const user=randomUUID(),org=randomUUID(),project=randomUUID();
   await db.query('insert into auth.users(id,email) values($1,$2)',[user,'retained@project-control.example.test']);
   await db.query("insert into public.organizations(id,name) values($1,'Synthetic retained organization')",[org]);
   await db.query('update public.profiles set organization_id=$1 where id=$2',[org,user]);
   await db.query("insert into public.support_projects(id,organization_id,name,created_by) values($1,$2,'Synthetic retained project',$3)",[project,org,user]);
   await db.query("insert into public.tickets(reference,organization_id,project_id,requester_id,subject,description,category_key) select 'PCC-RETAINED',$1,$2,$3,'Retained synthetic issue','Retained synthetic description',key from public.ticket_categories order by key limit 1",[org,project,user]);
   if(unsafe)await db.exec("insert into storage.buckets(id,name,public) values('project-task-attachments','Unexpected pre-existing bucket',true)");
   const tables=(await db.query("select schemaname,tablename from pg_tables where schemaname in ('public','auth','storage')")).rows,snapshots=[];
   for(const {schemaname,tablename}of tables){const sql=`select to_jsonb(t) data from "${schemaname}"."${tablename}" t`;snapshots.push({sql,rows:(await db.query(sql)).rows.map(x=>JSON.stringify(x.data))});}
   if(unsafe){await assert.rejects(db.exec(read('../migrations/'+migration)),e=>e.code==='23514');await db.exec('rollback');assert.equal((await db.query("select to_regclass('public.project_tasks') object")).rows[0].object,null);}
   else {await db.exec(read('../migrations/'+migration));await db.exec(read('../migrations/'+r1Migration));}
   for(const snapshot of snapshots){const after=new Set((await db.query(snapshot.sql)).rows.map(x=>JSON.stringify(x.data)));for(const row of snapshot.rows)assert.ok(after.has(row),'Existing row changed: '+snapshot.sql);}
   if(!unsafe)assert.equal((await db.query("select public from storage.buckets where id='project-task-attachments'")).rows[0].public,false);
  }finally{await db.close();}
 });
});
