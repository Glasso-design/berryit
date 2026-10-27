// Explicit operator-only rehearsal in the existing approved synthetic stack.
// No production origin, cleanup, deployment, provider call or secret output.
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {isolatedResultSummary} from './isolated-results.mjs';
const argv=process.argv.slice(2);
if(argv.length!==2||argv[0]!=='--environment=existing-isolated-pcc'||!argv[1].startsWith('--manifest='))throw Error('EXPLICIT_ISOLATED_MANIFEST_REQUIRED');
const safePath=p=>{const r=path.resolve(p),base=path.resolve('test-results')+path.sep;if(!r.startsWith(base))throw Error('TEST_RESULTS_PATH_REQUIRED');return r;};
const manifest=JSON.parse(fs.readFileSync(safePath(argv[1].slice(11)),'utf8'));
const origin='http://127.0.0.1:18750';
if(manifest.classification!=='isolated-synthetic-pcc'||manifest.productionData!==false||manifest.origin!==origin||manifest.approval!=='PCC_ISOLATED_MIGRATION_AND_HTTP_APPROVED'
 ||manifest.target!=='core-node-01/berryit-iso-83a2f62f-db/postgres'||manifest.containerId!=='1ea52edd800810ecb1e48aa743a99ceaf95a09b3a3da45a4ae4fcd490722988b'||! /^[a-f0-9-]{36}$/.test(manifest.runId))throw Error('ISOLATED_IDENTITY_REQUIRED');
const output=safePath(manifest.output);if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');
const env=file=>Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).filter(s=>/^[A-Z_]+=/.test(s)).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const identity=env(manifest.credentials.identity),keys=env(manifest.credentials.keys),claims=t=>JSON.parse(Buffer.from(t.split('.')[1],'base64url'));
if(claims(keys.ANON_KEY).role!=='anon'||claims(keys.SERVICE_ROLE_KEY).role!=='service_role')throw Error('WRONG_TEST_KEYS');
const safeFetch=(url,options)=>{if(new URL(url).origin!==origin)throw Error('FOREIGN_ORIGIN_REFUSED');return fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});};
const make=(key=keys.ANON_KEY)=>createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:safeFetch}});
const owner=make(),admin=make(keys.SERVICE_ROLE_KEY),clients=[owner],results=[],created={runId:manifest.runId,users:[],organizations:[],projects:[],roles:[],grants:[],tasks:[],tickets:[],nodes:[],services:[],integrations:[],attachments:[],evidence:[]};
const must=(ok,code)=>{if(!ok)throw Error(code);};
const rpc=async(c,n,args={})=>{const r=await c.rpc(n,args);if(r.error)throw Error('RPC_'+n.toUpperCase()+'_'+r.error.code);return r.data;};
const check=async(name,fn)=>{try{const detail=await fn();const r={name,status:'PASS',...detail};results.push(r);console.log(JSON.stringify(r));}catch(e){const r={name,status:'FAIL',code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'SANITIZED_ASSERTION_FAILURE'};results.push(r);console.log(JSON.stringify(r));throw Error('TEST_STOPPED');}};
const deny=async promise=>{const r=await promise;must(Boolean(r.error)&&['42501','22023','23503','23514','40001','55000','PGRST301','PGRST302'].includes(r.error.code),'REQUEST_NOT_DENIED_'+(r.error?.code??'NO_ERROR'));};
const empty=async promise=>{const r=await promise;must(!r.error&&r.data?.length===0,'RLS_ROWS_EXPOSED');};
function totp(secret){let bits='';for(const c of secret.toUpperCase().replace(/[=\s]/g,'')){const n='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);must(n>=0,'BAD_TEST_FACTOR');bits+=n.toString(2).padStart(5,'0');}const key=Buffer.from((bits.match(/.{8}/g)??[]).map(b=>parseInt(b,2))),counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=createHmac('sha1',key).update(counter).digest(),at=h[19]&15;return String((h.readUInt32BE(at)&0x7fffffff)%1000000).padStart(6,'0');}
const mfa=async(c,secret,factorId)=>{const r=await c.auth.mfa.challengeAndVerify({factorId,code:totp(secret)});must(!r.error&&r.data.access_token,'REAL_TOTP_FAILED');must((await c.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel==='aal2','NOT_AAL2');};
const prefix='PCC HTTP '+manifest.runId.slice(0,8),reason='Approved isolated PCC synthetic verification',providerId=BigInt('0x'+manifest.runId.replaceAll('-','').slice(0,20)).toString();
let orgA,orgB,projectA,projectB,unassigned,A,B,reader,customer,grantA,task,publicTask,attachment,evidence,repo,ticket,foreignTicket,signed;
const value=(title='Synthetic fault')=>({title,description:'Synthetic fixture only, no production service examined',status:'todo',priority:'normal',visibility:'internal',assignee_id:null,due_at:null,checklist:[]});
const save=(c,id=null,project=projectA,values=value(),revision=null)=>rpc(c,'save_project_task',{p_id:id,p_project:project,p_values:values,p_revision:revision,p_reason:reason});
const details=(c,id=task)=>rpc(c,'project_task_details',{p_task:id});
try{
 await check('http.existing_gateway_auth_storage_and_pcc_schema',async()=>{
  for(const p of ['/auth/v1/health','/storage/v1/status']){const r=await safeFetch(origin+p,{headers:{apikey:keys.ANON_KEY}});must(r.status===200,'HTTP_HEALTH_FAILED');await r.body?.cancel();}
  const r=await admin.from('schema_migrations').select('version');must(!r.error&&r.data.length===17&&r.data.some(x=>x.version==='20261025112940_project_control_center.sql'),'PCC_SCHEMA_NOT_RELOADED');
 });
 await check('auth.real_owner_login_aal1',async()=>{const r=await owner.auth.signInWithPassword({email:identity.ISO_DESKTOP_USER,password:identity.ISO_DESKTOP_PASS});must(!r.error&&claims(r.data.session.access_token).aal==='aal1','OWNER_LOGIN_FAILED');});
 await check('mfa.aal1_cannot_use_privileged_project_api',async()=>{await deny(owner.rpc('save_support_project',{p_id:null,p_organization_id:randomUUID(),p_values:{name:prefix},p_reason:reason}));});
 await check('mfa.real_owner_totp_and_current_server_authority',async()=>{const f=await owner.auth.mfa.listFactors(),factor=f.data?.totp.find(x=>x.status==='verified');must(!f.error&&factor,'TEST_OWNER_FACTOR_MISSING');await mfa(owner,identity.ISO_DESKTOP_TOTP,factor.id);const a=await rpc(owner,'support_access_context');must(a.accountActive&&a.isSuperAdmin,'CURRENT_OWNER_AUTHORITY_MISSING');});
 await check('fixture.organizations_projects_and_synthetic_accounts',async()=>{
  orgA=await rpc(owner,'create_support_organization',{p_name:prefix+' A'});orgB=await rpc(owner,'create_support_organization',{p_name:prefix+' B'});created.organizations.push(orgA,orgB);
  const project=async(org,s)=>{const id=await rpc(owner,'save_support_project',{p_id:null,p_organization_id:org,p_values:{name:prefix+' '+s,source:'berryit'},p_reason:reason});created.projects.push(id);return id;};
  projectA=await project(orgA,'project A');projectB=await project(orgB,'project B');unassigned=await project(orgA,'unassigned');
  const user=async(s)=>{const password=randomBytes(36).toString('base64url'),email='pcc-'+manifest.runId+'-'+s+'@example.invalid',r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:prefix+' synthetic '+s}});must(!r.error&&r.data.user,'SYNTHETIC_USER_FAILED');created.users.push(r.data.user.id);const client=make();clients.push(client);must(!(await client.auth.signInWithPassword({email,password})).error,'SYNTHETIC_LOGIN_FAILED');return{id:r.data.user.id,client};};
  A=await user('a');B=await user('b');reader=await user('reader');customer=await user('customer');
  const r=await admin.from('profiles').update({organization_id:orgA}).eq('id',customer.id);must(!r.error,'CUSTOMER_FIXTURE_FAILED');
  const permissions=['projects.read','tasks.read','tasks.write','tasks.internal','tasks.sync','projects.activity.read','projects.activity.write','repositories.read','repositories.review'];
  const role=async(org,p,label)=>{const key=await rpc(owner,'save_support_role',{p_key:null,p_label:prefix+' '+label,p_description:'Synthetic isolated project scope',p_permissions:p,p_org:org,p_active:true,p_reason:reason});created.roles.push(key);return key;};
  const roleA=await role(orgA,permissions,'operator'),roleB=await role(orgB,permissions,'operator'),roleR=await role(orgA,['projects.read','tasks.read','projects.activity.read'],'reader');
  const grant=async(u,r,org,project)=>{const id=await rpc(owner,'grant_support_role',{p_user:u.id,p_role:r,p_org:org,p_project:project,p_expires:new Date(Date.now()+5400000).toISOString(),p_reason:reason});created.grants.push(id);return id;};
  grantA=await grant(A,roleA,orgA,projectA);await grant(B,roleB,orgB,projectB);await grant(reader,roleR,orgA,projectA);
 });
 await check('mfa.scoped_aal1_sensitive_sync_and_evidence_denied',async()=>{
  // Ordinary task permissions intentionally do not require MFA; tasks.sync and
  // evidence do. Test the registry policy rather than inventing a stricter rule.
  must(await rpc(A.client,'has_resource_permission',{p_permission:'tasks.sync',p_organization_id:orgA,p_project_id:projectA})===false,'AAL1_SYNC_PERMISSION_ACCEPTED');
  await deny(A.client.rpc('record_project_evidence',{p_project:projectA,p_values:{kind:'test',title:'Synthetic aal1 denial',source_kind:'manual',stage:'LOCAL'},p_reason:reason}));
 });
 await check('mfa.three_real_synthetic_totp_sessions',async()=>{for(const u of [A,B,reader]){const r=await u.client.auth.mfa.enroll({factorType:'totp',friendlyName:'Isolated PCC gate'});must(!r.error&&r.data?.totp?.secret,'ENROLLMENT_FAILED');await mfa(u.client,r.data.totp.secret,r.data.id);}});
 await check('tasks.real_rpc_create_assign_checklist_and_revision',async()=>{
  task=await save(A.client,null,projectA,{...value(),assignee_id:A.id,due_at:'2027-01-01T12:00:00Z',checklist:[{id:randomUUID(),text:'Inspect synthetic telemetry',done:false}]});created.tasks.push(task);
  let d=await details(A.client);must(d.task.assignee_id===A.id&&d.task.checklist.length===1,'TASK_FIELDS_LOST');await save(A.client,task,projectA,{...value(),status:'blocked',priority:'critical'},1);d=await details(A.client);must(d.task.revision===2&&d.task.status==='blocked','TASK_UPDATE_FAILED');
  // Already reproduced in this gate on PostgREST 14.12. Do not repeatedly send
  // a known retry-loop request; direct SQL separately proves the revision guard.
  const blocked={name:'http.stale_revision_error_delivery',status:'BLOCKED',code:'POSTGREST_14_SQLSTATE_40001_RETRY_LOOP',databaseRevisionPreserved:true};results.push(blocked);console.log(JSON.stringify(blocked));
  publicTask=await save(A.client,null,projectA,{...value('Synthetic visible task'),visibility:'project'});created.tasks.push(publicTask);
 });
 await check('tenant.direct_rls_and_manipulated_rpc_ids_denied',async()=>{
  for(const c of [B.client,customer.client]){await empty(c.from('project_tasks').select('id').eq('id',task));await deny(c.rpc('project_task_details',{p_task:task}));await deny(c.rpc('project_control_overview',{p_project:projectA}));}
  for(const project of [projectB,unassigned])await deny(A.client.rpc('save_project_task',{p_id:task,p_project:project,p_values:value(),p_revision:2,p_reason:reason}));
  await deny(A.client.rpc('save_project_task',{p_id:null,p_project:projectA,p_values:{...value(),organization_id:orgB},p_revision:null,p_reason:reason}));
  await deny(A.client.rpc('save_project_task',{p_id:null,p_project:projectA,p_values:{...value(),assignee_id:B.id},p_revision:null,p_reason:reason}));
 });
 await check('tasks.direct_write_anon_and_role_escalation_denied',async()=>{
  await deny(A.client.from('project_tasks').update({title:'Bypass'}).eq('id',task));await deny(make().rpc('project_control_overview',{p_project:projectA}));
  await deny(A.client.rpc('grant_support_role',{p_user:A.id,p_role:'BERRYIT_SUPPORT_ADMIN',p_org:orgA,p_project:null,p_expires:null,p_reason:reason}));
  const roleAttempt=await A.client.from('profiles').update({role:'admin',organization_id:orgB,is_org_admin:true}).eq('id',A.id);
  must(!roleAttempt.error,'PROFILE_GUARD_REQUEST_FAILED');const profile=await A.client.from('profiles').select('role,organization_id,is_org_admin').eq('id',A.id).single();
  must(!profile.error&&profile.data.role==='customer'&&profile.data.organization_id===null&&!profile.data.is_org_admin,'PROFILE_PRIVILEGES_ESCALATED');
 });
 await check('comments.reader_cannot_read_internal_notes_or_tasks',async()=>{
  await rpc(A.client,'project_task_comment',{p_task:publicTask,p_body:'Synthetic public comment',p_visibility:'project'});await rpc(A.client,'project_task_comment',{p_task:publicTask,p_body:'INTERNAL-PCC-CANARY',p_visibility:'internal'});
  const d=await details(reader.client,publicTask);must(d.comments.length===1&&!JSON.stringify(d).includes('INTERNAL-PCC-CANARY'),'INTERNAL_COMMENT_EXPOSED');await empty(reader.client.from('project_tasks').select('id').eq('id',task));await deny(reader.client.rpc('project_task_details',{p_task:task}));
 });
 await check('profile.code.business_and_ai_scope_separation',async()=>{
  await rpc(owner,'save_project_control',{p_project:projectA,p_section:'profile',p_values:{project_type:'saas',development_status:'testing'},p_reason:reason});
  await rpc(owner,'save_project_control',{p_project:projectA,p_section:'code',p_values:{frontend:'React',backend:'Supabase',local_paths:['C:\\synthetic\\LOCAL-PATH-CANARY']},p_reason:reason});
  await rpc(owner,'save_project_control',{p_project:projectA,p_section:'business',p_values:{owner_kind:'external',owner_label:'Synthetic',agreement_reference:'BUSINESS-PCC-CANARY'},p_reason:reason});
  const d=await rpc(A.client,'project_control_overview',{p_project:projectA});must(d.code.frontend==='React'&&d.business===null,'BUSINESS_SCOPE_EXPOSED');
  const a=await rpc(A.client,'project_control_ai_context',{p_project:projectA});must(a.facts.some(x=>x.id==='task:'+task)&&!JSON.stringify(a).includes('BUSINESS-PCC-CANARY')&&!JSON.stringify(a).includes('LOCAL-PATH-CANARY'),'AI_CONTEXT_SCOPE_INCORRECT');await deny(B.client.rpc('project_control_ai_context',{p_project:projectA}));
 });
 await check('evidence.manual_claims_never_verified_and_audit_append_only',async()=>{
  evidence=await rpc(A.client,'record_project_evidence',{p_project:projectA,p_values:{kind:'development_pass',title:'Synthetic development pass',body:'Registered fixture, no real deployment',source_kind:'manual',stage:'LOCAL',version:'0.0.0-test',branch:'synthetic'},p_reason:reason});created.evidence.push(evidence);
  await deny(A.client.rpc('record_project_evidence',{p_project:projectA,p_values:{kind:'deployment',title:'Fake production proof',source_kind:'connector',stage:'PRODUCTION'},p_reason:reason}));
  const d=await rpc(A.client,'project_control_overview',{p_project:projectA});must(d.latestVerifiedVersion===null&&d.backup.status==='UNVERIFIED','FALSE_PRODUCTION_PASS');await deny(A.client.from('project_activity').delete().eq('project_id',projectA));
  const history=await rpc(A.client,'project_activity_page',{p_project:projectA});must(history.items.some(x=>x.action==='task.created')&&history.items.some(x=>x.action==='project.evidence_recorded'),'AUDIT_MISSING');
 });
 await check('infrastructure.registered_unknown_paused_status_and_tenant_scope',async()=>{
  const node=randomUUID(),service=randomUUID();let r=await owner.from('infra_nodes').insert({id:node,organization_id:orgA,name:prefix+' synthetic node',hostname:'192.0.2.10'});must(!r.error,'NODE_FIXTURE_FAILED');created.nodes.push(node);
  r=await owner.from('infra_services').insert({id:service,organization_id:orgA,project_id:projectA,node_id:node,name:'Synthetic intentionally paused',environment:'development',is_active:false,url:'https://example.invalid/?token=SYNTHETIC-CANARY'});must(!r.error,'SERVICE_FIXTURE_FAILED');created.services.push(service);
  const d=await rpc(owner,'project_control_overview',{p_project:projectA});must(d.services.some(x=>x.id===service&&!x.is_active&&x.url===null)&&d.nodes.some(x=>x.id===node),'INFRA_PROJECTION_FAILED');must((await rpc(A.client,'project_control_overview',{p_project:projectA})).services.length===0,'UNGRANTED_INFRA_EXPOSED');
 });
 await check('git.registered_readonly_repository_scope_and_no_tokens',async()=>{
  repo=randomUUID();const r=await owner.from('connector_integrations').insert({id:repo,organization_id:orgA,project_id:projectA,scope_kind:'project',connector_key:'github',display_name:prefix+' synthetic repository',access_mode:'read_only',is_enabled:true,status:'not_configured',config:{repository:'Synthetic-PCC/example',provider_project_id:providerId},secret_ref:'PCC_SYNTHETIC_NOT_CONFIGURED'});must(!r.error,'REPOSITORY_FIXTURE_FAILED');created.integrations.push(repo);
  const list=await rpc(A.client,'project_repository_catalog',{p_project:projectA});must(list.length===1&&list[0].read_only&&!JSON.stringify(list).includes('PCC_SYNTHETIC_NOT_CONFIGURED'),'CATALOG_EXPOSURE');await deny(B.client.rpc('project_repository_context',{p_project:projectA,p_integration:repo}));
  const context=await rpc(A.client,'project_repository_context',{p_project:projectA,p_integration:repo});must(context.actor_id===A.id&&context.provider_id===providerId,'REPOSITORY_IDENTITY_MISMATCH');
 });
 await check('git.synthetic_upstream_real_atomic_import_idempotency_and_manual_protection',async()=>{
  const session=claims((await A.client.auth.getSession()).data.session.access_token).session_id;
  const input={p_project:projectA,p_integration:repo,p_actor:A.id,p_session:session,p_issues:[{id:providerId+'1',number:7,title:'Synthetic imported issue',body:'Synthetic upstream only',state:'open',updated_at:new Date().toISOString()}]};
  await deny(A.client.rpc('import_project_github_issues',input));const first=await rpc(admin,'import_project_github_issues',input),second=await rpc(admin,'import_project_github_issues',input);must(first.created===1&&second.created===0,'ISSUE_DUPLICATED');
  const list=await rpc(A.client,'list_project_tasks',{p_project:projectA}),imported=list.items.find(x=>x.title==='Synthetic imported issue');must(imported,'ISSUE_TASK_MISSING');created.tasks.push(imported.id);await save(A.client,imported.id,projectA,value('Manual issue title'),imported.revision);
  await rpc(admin,'import_project_github_issues',{...input,p_issues:[{...input.p_issues[0],title:'Changed remote title',updated_at:new Date(Date.now()+1000).toISOString()}]});const d=await details(A.client,imported.id);must(d.task.title==='Manual issue title'&&d.links.some(x=>x.proposal),'MANUAL_VALUE_OVERWRITTEN');
 });
 await check('support.same_ticket_core_link_details_messages_and_tenant_isolation',async()=>{
  const cat=await owner.from('ticket_categories').select('key').limit(1);must(!cat.error&&cat.data.length,'CATEGORY_MISSING');
  const create=async(org,project,s)=>{const id=randomUUID(),r=await owner.from('tickets').insert({id,organization_id:org,project_id:project,requester_id:claims((await owner.auth.getSession()).data.session.access_token).sub,source:'api',subject:prefix+' support '+s,description:'Synthetic ticket',category_key:cat.data[0].key}).select('id').single();must(!r.error&&r.data,'TICKET_CREATE_FAILED');created.tickets.push(id);return id;};
  ticket=await create(orgA,projectA,'A');foreignTicket=await create(orgB,projectB,'B');await rpc(owner,'link_project_task',{p_task:task,p_kind:'support_ticket',p_resource:ticket});await deny(owner.rpc('link_project_task',{p_task:task,p_kind:'support_ticket',p_resource:foreignTicket}));
  const d=await rpc(owner,'project_control_overview',{p_project:projectA});must(d.support.some(t=>t.id===ticket),'SUPPORT_LINK_MISSING');const read=await owner.from('tickets').select('id,subject').eq('id',ticket).single();must(!read.error&&read.data.id===ticket,'TICKET_DETAILS_FAILED');await empty(B.client.from('tickets').select('id').eq('id',ticket));
 });
 await check('storage.real_upload_exact_size_and_internal_attachment_isolation',async()=>{
  attachment=await rpc(A.client,'prepare_project_task_attachment',{p_task:task,p_filename:'synthetic.txt',p_type:'text/plain',p_bytes:3});created.attachments.push(attachment.id);
  await deny(A.client.rpc('complete_project_task_attachment',{p_id:attachment.id}));await deny(B.client.rpc('prepare_project_task_attachment',{p_task:task,p_filename:'foreign.txt',p_type:'text/plain',p_bytes:3}));
  const up=await A.client.storage.from(attachment.bucket).upload(attachment.path,Buffer.from('PCC'),{contentType:'text/plain',upsert:false});must(!up.error,'REAL_STORAGE_UPLOAD_FAILED');await rpc(A.client,'complete_project_task_attachment',{p_id:attachment.id});
  const p=await rpc(A.client,'project_task_attachment_path',{p_id:attachment.id});must(p===attachment.path,'ATTACHMENT_PATH_MISMATCH');await deny(reader.client.rpc('project_task_attachment_path',{p_id:attachment.id}));
  const denied=await reader.client.storage.from(attachment.bucket).download(attachment.path);must(Boolean(denied.error),'INTERNAL_STORAGE_EXPOSED');
 });
 await check('storage.signed_url_integrity_and_expiry',async()=>{
  const r=await A.client.storage.from(attachment.bucket).createSignedUrl(attachment.path,2);must(!r.error,'SIGN_URL_FAILED');signed=r.data.signedUrl;const good=await safeFetch(signed);must(good.status===200&&await good.text()==='PCC','SIGNED_CONTENT_FAILED');
  const url=new URL(signed),token=url.searchParams.get('token');url.searchParams.set('token',token.slice(0,-2)+'xx');const bad=await safeFetch(url);must(bad.status!==200,'FORGED_STORAGE_TOKEN_ACCEPTED');await bad.body?.cancel();
  await new Promise(r=>setTimeout(r,3200));const expired=await safeFetch(signed);must(expired.status!==200,'EXPIRED_SIGNED_URL_ACCEPTED');await expired.body?.cancel();
 });
 await check('storage.internal_snapshot_stays_private_after_task_visibility_change',async()=>{
  const d=await details(A.client);await save(A.client,task,projectA,{...value(),visibility:'project'},d.task.revision);must((await details(reader.client)).attachments.length===0,'OLD_INTERNAL_ATTACHMENT_EXPOSED');await deny(reader.client.rpc('project_task_attachment_path',{p_id:attachment.id}));
 });
 await check('tasks.complete_archive_and_reactivate_preserve_history',async()=>{
  let d=await details(A.client);await save(A.client,task,projectA,{...value(),status:'done'},d.task.revision);d=await details(A.client);await save(A.client,task,projectA,{...value(),status:'done',archived:true},d.task.revision);d=await details(A.client);must(d.task.archived_at,'ARCHIVE_NOT_SET');
  await save(A.client,task,projectA,{...value(),status:'todo',archived:false},d.task.revision);const h=await rpc(A.client,'project_task_history',{p_task:task});must(h.items.length>=5,'TASK_HISTORY_LOST');
 });
 if(manifest.operatorHook){must(manifest.operatorHook==='tests/project-control/existing-isolated-browser.mjs','UNKNOWN_OPERATOR_HOOK');const hook=await import('./existing-isolated-browser.mjs');await hook.verify({owner,admin,A,B,reader,customer,orgA,orgB,projectA,projectB,task,publicTask,created,check,must,rpc,origin});}
 await check('auth.forged_jwt_identity_denied',async()=>{const t=(await A.client.auth.getSession()).data.session.access_token,p=t.split('.');p[1]=Buffer.from(JSON.stringify({...claims(t),sub:B.id})).toString('base64url');const r=await safeFetch(origin+'/rest/v1/rpc/project_control_overview',{method:'POST',headers:{apikey:keys.ANON_KEY,Authorization:'Bearer '+p.join('.'),'Content-Type':'application/json'},body:JSON.stringify({p_project:projectA})});must([401,403].includes(r.status),'FORGED_JWT_ACCEPTED');await r.body?.cancel();});
 await check('roles.revocation_blocks_existing_session_read_write_and_signing',async()=>{await rpc(owner,'revoke_support_role',{p_id:grantA,p_reason:reason});await deny(A.client.rpc('project_task_details',{p_task:task}));await deny(A.client.rpc('save_project_task',{p_id:null,p_project:projectA,p_values:value(),p_revision:null,p_reason:reason}));await empty(A.client.from('project_tasks').select('id').eq('id',task));const s=await A.client.storage.from(attachment.bucket).createSignedUrl(attachment.path,60);must(Boolean(s.error),'REVOKED_SIGNING_ACCEPTED');});
 await check('roles.expiry_blocks_existing_aal2_session',async()=>{
  const g=await rpc(owner,'grant_support_role',{p_user:A.id,p_role:created.roles[0],p_org:orgA,p_project:projectA,p_expires:new Date(Date.now()+3000).toISOString(),p_reason:reason});created.grants.push(g);
  must((await details(A.client)).task.id===task,'TEMPORARY_GRANT_INACTIVE');await new Promise(r=>setTimeout(r,3500));await deny(A.client.rpc('project_task_details',{p_task:task}));
 });
 await check('auth.logout_blocks_old_privileged_session',async()=>{const old=(await B.client.auth.getSession()).data.session.access_token;must(!(await B.client.auth.signOut({scope:'local'})).error,'TEST_LOGOUT_FAILED');const r=await safeFetch(origin+'/rest/v1/rpc/save_project_task',{method:'POST',headers:{apikey:keys.ANON_KEY,Authorization:'Bearer '+old,'Content-Type':'application/json'},body:JSON.stringify({p_id:null,p_project:projectB,p_values:value(),p_revision:null,p_reason:reason})});must([401,403].includes(r.status),'OLD_SESSION_ACCEPTED');await r.body?.cancel();});
}catch(e){if(e.message!=='TEST_STOPPED'){results.push({name:'execution',status:'FAIL',code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'SANITIZED_FAILURE'});console.log(JSON.stringify(results.at(-1)));}process.exitCode=1;
}finally{
 for(const c of clients){try{await c.auth.signOut({scope:'local'});}catch{/* only sessions created by this run */}}
 fs.writeFileSync(output,JSON.stringify({classification:'REAL_EXISTING_ISOLATED_PCC_HTTP',runId:manifest.runId,created,results,providerCalls:0,productionChanged:false,destructiveCleanup:false},null,2)+'\n',{flag:'wx'});
 const summary=isolatedResultSummary(results);process.exitCode=summary.exitCode;console.log(JSON.stringify({...summary,output}));
}
