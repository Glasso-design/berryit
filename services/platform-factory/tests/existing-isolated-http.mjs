// Operator-gated tests for the ALREADY APPROVED isolated BerryIT stack.
// No stack creation, external providers, mail delivery or account deletion.
import fs from 'node:fs';
import path from 'node:path';
import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {DEFAULT_STORAGE_QUOTA} from '../contract.mjs';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--environment=existing-isolated-berryit'||!args[1].startsWith('--manifest='))throw Error('EXPLICIT_ISOLATED_MANIFEST_REQUIRED');
const workspace=path.resolve('test-results')+path.sep;
const manifestPath=path.resolve(args[1].slice(11));
if(!manifestPath.toLowerCase().startsWith(workspace.toLowerCase()))throw Error('WORKSPACE_MANIFEST_REQUIRED');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8').replace(/^\uFEFF/,''));
const origin='http://127.0.0.1:18750';
if(manifest.classification!=='isolated-synthetic-factory'||manifest.productionData!==false||manifest.origin!==origin
 ||manifest.approval!=='FACTORY_SCHEMA_AND_SYNTHETIC_HTTP_APPROVED'
 ||manifest.target!=='core-node-01/berryit-iso-83a2f62f-db/postgres'
 ||manifest.containerId!=='1ea52edd800810ecb1e48aa743a99ceaf95a09b3a3da45a4ae4fcd490722988b'
 ||! /^[a-f0-9-]{36}$/.test(manifest.runId))throw Error('UNVERIFIED_ISOLATED_TARGET');
const output=path.resolve(manifest.output);
if(!output.toLowerCase().startsWith(workspace.toLowerCase())||fs.existsSync(output))throw Error('NEW_WORKSPACE_OUTPUT_REQUIRED');
const envFile=file=>Object.fromEntries(fs.readFileSync(file,'utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{
 const at=l.indexOf('=');return [l.slice(0,at),l.slice(at+1).replace(/^['"]|['"]$/g,'')];
}));
const identity=envFile(manifest.credentials.identity),keys=envFile(manifest.credentials.keys);
const claims=token=>JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
if(claims(keys.ANON_KEY).role!=='anon'||claims(keys.SERVICE_ROLE_KEY).role!=='service_role')throw Error('INVALID_TEST_KEY_ROLES');
const safeFetch=async(url,options)=>{
 if(new URL(url).origin!==origin)throw Error('NON_ISOLATED_ORIGIN_REFUSED');
 return fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});
};
const make=(key=keys.ANON_KEY)=>createClient(origin,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:safeFetch}});
const admin=make(keys.SERVICE_ROLE_KEY),owner=make(),clients=[owner];
const results=[],created={runId:manifest.runId,users:[],organizations:[],projects:[],roles:[],grants:[],jobs:[],instances:[]};
const must=(ok,code)=>{if(!ok)throw Error(code);};
const record=(name,status,detail={})=>{const result={name,status,...detail};results.push(result);console.log(JSON.stringify(result));};
const check=async(name,fn)=>{try{const detail=await fn();record(name,'PASS',detail??{});}catch(error){record(name,'FAIL',{code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'SANITIZED_ASSERTION_FAILURE'});throw Error('TEST_STOPPED');}};
const rpc=async(client,name,parameters={})=>{
 const result=await client.rpc(name,parameters);
 if(result.error)throw Error('RPC_'+name.toUpperCase()+'_'+result.error.code);
 return result.data;
};
function totp(secret){
 let bits='';for(const ch of secret.toUpperCase().replace(/[=\s]/g,'')){
  const n='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch);must(n>=0,'INVALID_SYNTHETIC_FACTOR');bits+=n.toString(2).padStart(5,'0');
 }
 const key=Buffer.from((bits.match(/.{8}/g)??[]).map(x=>parseInt(x,2))),counter=Buffer.alloc(8);
 counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));
 const h=createHmac('sha1',key).update(counter).digest(),offset=h[19]&15;
 return String((h.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');
}
async function aal2(client,secret,factorId){
 const verified=await client.auth.mfa.challengeAndVerify({factorId,code:totp(secret)});
 must(!verified.error&&verified.data?.access_token,'REAL_TOTP_FAILED');
 const level=await client.auth.mfa.getAuthenticatorAssuranceLevel();
 must(!level.error&&level.data.currentLevel==='aal2','AAL2_REQUIRED');
}
const prefix='Factory PASS3A '+manifest.runId.slice(0,8);
let userA,userB,orgA,orgB,projectA,projectB,otherProject,roleA,grantA,jobA,jobB,instanceA,instanceB,inputA;
try{
 await check('http.existing_isolated_gateway_health',async()=>{
  for(const endpoint of ['/auth/v1/health','/storage/v1/status']){
   const response=await safeFetch(origin+endpoint,{method:'GET',headers:{apikey:keys.ANON_KEY}});
   must(response.status===200,'ISOLATED_HEALTH_FAILED');await response.body?.cancel();
  }
 });
 await check('auth.real_owner_login_aal1',async()=>{
  const r=await owner.auth.signInWithPassword({email:identity.ISO_DESKTOP_USER,password:identity.ISO_DESKTOP_PASS});
  must(!r.error&&r.data.session&&claims(r.data.session.access_token).aal==='aal1','OWNER_LOGIN_FAILED');
 });
 await check('auth.invalid_password_denied',async()=>{
  const r=await make().auth.signInWithPassword({email:identity.ISO_DESKTOP_USER,password:'synthetic-deliberately-invalid-pass3a'});
  must(Boolean(r.error),'INVALID_PASSWORD_ACCEPTED');
 });
 await check('mfa.owner_aal1_cannot_administrate',async()=>{
  must(await rpc(owner,'has_resource_permission',{p_permission:'roles.manage',p_organization_id:null,p_project_id:null})===false,'AAL1_PRIVILEGE_ACCEPTED');
  const catalog=await rpc(owner,'factory_catalog');must(catalog.projects.length===0,'AAL1_PROJECT_EXPOSED');
 });
 await check('mfa.real_owner_totp_and_server_identity',async()=>{
  const factors=await owner.auth.mfa.listFactors();const factor=factors.data?.totp.find(f=>f.status==='verified');must(!factors.error&&factor,'EXISTING_FACTOR_MISSING');
  await aal2(owner,identity.ISO_DESKTOP_TOTP,factor.id);
  const current=await owner.auth.getUser();must(!current.error&&current.data.user,'CURRENT_IDENTITY_FAILED');
  const access=await rpc(owner,'support_access_context');must(access.accountActive&&access.isSuperAdmin,'SERVER_OWNER_AUTHORITY_FAILED');
  return {identitySource:'BERRYIT_GOTRUE',centralOnarlySsoVerified:false};
 });
 await check('fixture.scoped_synthetic_users_projects_and_roles',async()=>{
  orgA=await rpc(owner,'create_support_organization',{p_name:prefix+' A'});created.organizations.push(orgA);
  orgB=await rpc(owner,'create_support_organization',{p_name:prefix+' B'});created.organizations.push(orgB);
  const project=async(org,suffix)=>{const id=await rpc(owner,'save_support_project',{p_id:null,p_organization_id:org,p_values:{name:prefix+' '+suffix,source:'berryit'},p_reason:'Approved isolated synthetic Factory verification'});created.projects.push(id);return id;};
  projectA=await project(orgA,'project A');projectB=await project(orgB,'project B');otherProject=await project(orgA,'unassigned');
  const user=async(alias)=>{
   const password=randomBytes(36).toString('base64url'),email='factory-pass3a-'+manifest.runId+'-'+alias+'@example.invalid';
   const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:prefix+' synthetic '+alias}});
   must(!r.error&&r.data.user,'SYNTHETIC_ACCOUNT_CREATION_FAILED');created.users.push(r.data.user.id);
   const client=make();clients.push(client);const login=await client.auth.signInWithPassword({email,password});must(!login.error,'SYNTHETIC_LOGIN_FAILED');
   return {id:r.data.user.id,client};
  };
  userA=await user('a');userB=await user('b');
  const role=async(org)=>{const key=await rpc(owner,'save_support_role',{p_key:null,p_label:prefix+' scoped operator',p_description:'Synthetic Factory-only scope; no role administration',p_permissions:['factory.read','factory.create','factory.manage','factory.storage.write'],p_org:org,p_active:true,p_reason:'Approved isolated Factory test'});created.roles.push(key);return key;};
  roleA=await role(orgA);const roleB=await role(orgB);
  const grant=async(user,role,org,project)=>{const id=await rpc(owner,'grant_support_role',{p_user:user.id,p_role:role,p_org:org,p_project:project,p_expires:new Date(Date.now()+3600000).toISOString(),p_reason:'Approved isolated scoped synthetic test grant'});created.grants.push(id);return id;};
  grantA=await grant(userA,roleA,orgA,projectA);await grant(userB,roleB,orgB,projectB);
 });
 const request=(org,project,ownerId,alias)=>({productId:'qabgo',version:'01d27b5ccd9e669d8dfb8e3fe9f785332a35d397',organizationId:org,projectId:project,ownerId,name:prefix+' instance '+alias,customerName:prefix+' synthetic customer '+alias,domain:'factory-'+manifest.runId+'-'+alias+'.example.invalid',region:'eu',accountMode:'DEDICATED_MANAGED',emailMode:'none',storageQuotaBytes:DEFAULT_STORAGE_QUOTA,monthlyBudgetCents:0,addons:[],idempotencyKey:randomUUID()});
 inputA=request(orgA,projectA,userA.id,'a');
 await check('mfa.aal1_factory_create_denied',async()=>{
  const r=await userA.client.rpc('factory_create',{p_input:inputA});must(r.error?.code==='42501','FACTORY_AAL1_NOT_DENIED');
 });
 await check('mfa.two_real_totp_users_aal2',async()=>{
  for(const user of [userA,userB]){
   const enrolled=await user.client.auth.mfa.enroll({factorType:'totp',friendlyName:'Isolated Factory PASS3A'});
   must(!enrolled.error&&enrolled.data?.totp?.secret,'TEST_FACTOR_ENROLL_FAILED');
   await aal2(user.client,enrolled.data.totp.secret,enrolled.data.id);
   const current=await user.client.auth.getUser();must(!current.error&&current.data.user?.id===user.id,'SYNTHETIC_IDENTITY_MISMATCH');
  }
 });
 await check('postgrest.factory_create_owner_and_idempotency',async()=>{
  jobA=await rpc(userA.client,'factory_create',{p_input:inputA});created.jobs.push(jobA);
  must(await rpc(userA.client,'factory_create',{p_input:inputA})===jobA,'DUPLICATE_FACTORY_JOB');
  jobB=await rpc(userB.client,'factory_create',{p_input:request(orgB,projectB,userB.id,'b')});created.jobs.push(jobB);
  const a=await rpc(userA.client,'factory_snapshot',{p_job:jobA}),b=await rpc(userB.client,'factory_snapshot',{p_job:jobB});
  instanceA=a.instance.id;instanceB=b.instance.id;created.instances.push(instanceA,instanceB);
  must(a.instance.owner_id===userA.id&&a.instance.project_id===projectA&&a.instance.execution_mode==='MOCK','FACTORY_OWNER_SCOPE_MISMATCH');
  must(a.instance.quota_bytes===DEFAULT_STORAGE_QUOTA&&a.resources.length===0,'UNEXPECTED_LIVE_RESOURCE_OR_QUOTA');
 });
 await check('rls.other_organization_and_instance_denied_over_http',async()=>{
  must(await rpc(userA.client,'factory_snapshot',{p_job:jobB})===null,'FOREIGN_JOB_EXPOSED');
  must(await rpc(userB.client,'factory_snapshot',{p_job:jobA})===null,'FOREIGN_JOB_EXPOSED');
  must(await rpc(userA.client,'factory_provider_status',{p_instance:instanceB})===null,'FOREIGN_PROVIDER_EXPOSED');
  const list=await rpc(userA.client,'factory_list');must(list.items.length===1&&list.items[0].instance_id===instanceA,'FACTORY_LIST_SCOPE_LEAK');
 });
 await check('rls.forged_project_organization_and_owner_denied',async()=>{
  for(const overrides of [{projectId:otherProject},{projectId:projectB},{organizationId:orgB},{ownerId:userB.id}]){
   const r=await userA.client.rpc('factory_create',{p_input:{...inputA,...overrides,idempotencyKey:randomUUID(),domain:'denied-'+randomUUID()+'.example.invalid'}});
   must(r.error?.code==='42501','MANIPULATED_SCOPE_ACCEPTED');
  }
 });
 await check('authorization.role_admin_and_service_helpers_denied',async()=>{
  const result=await userA.client.rpc('grant_support_role',{p_user:userA.id,p_role:'BERRYIT_SUPPORT_ADMIN',p_org:orgA,p_project:null,p_expires:null,p_reason:'Synthetic escalation must be denied'});
  must(result.error?.code==='42501','SELF_ADMIN_ESCALATION_ACCEPTED');
  const worker=await userA.client.rpc('factory_worker_claim',{p_job:jobA,p_token:randomUUID()});must(worker.error?.code==='42501','WORKER_CLIENT_CALL_ACCEPTED');
  const anon=await make().rpc('factory_list');must(anon.error?.code==='42501','ANON_FACTORY_LIST_ACCEPTED');
 });
 await check('postgrest.technical_checklist_cannot_be_forged',async()=>{
  const r=await userA.client.rpc('factory_manual',{p_job:jobA,p_step:'storage',p_note:'Synthetic client must not forge verified infrastructure'});
  must(r.error?.code==='42501','TECHNICAL_EVIDENCE_FORGED');
 });
 await check('audit.factory_request_is_server_recorded',async()=>{
  const s=await rpc(userA.client,'factory_snapshot',{p_job:jobA});
  must(s.audit.some(e=>e.action==='factory.requested'&&e.metadata.execution_mode==='MOCK'),'FACTORY_AUDIT_MISSING');
 });
 // Optional operator hook remains in-process. It receives scoped user clients,
 // never the service-role client, and is not browser code or an authorization boundary.
 if(manifest.operatorHook){
  const hook=path.resolve(manifest.operatorHook);must(hook.toLowerCase().startsWith(workspace.toLowerCase()),'LOCAL_OPERATOR_HOOK_REQUIRED');
  const {verify}=await import((await import('node:url')).pathToFileURL(hook).href);
  await verify({owner,userA,userB,orgA,orgB,projectA,projectB,instanceA,instanceB,jobA,jobB,created,record,check,must,rpc,origin});
 }
 await check('http.forged_signed_identity_rejected',async()=>{
  const token=(await userA.client.auth.getSession()).data.session.access_token,parts=token.split('.');
  const changed={...claims(token),sub:userB.id};
  const forged=parts[0]+'.'+Buffer.from(JSON.stringify(changed)).toString('base64url')+'.'+parts[2];
  const r=await safeFetch(origin+'/rest/v1/rpc/factory_list',{method:'POST',headers:{apikey:keys.ANON_KEY,Authorization:'Bearer '+forged,'Content-Type':'application/json'},body:'{}'});
  must([401,403].includes(r.status),'FORGED_JWT_ACCEPTED');await r.body?.cancel();
 });
 await check('roles.revocation_invalidates_existing_factory_session',async()=>{
  await rpc(owner,'revoke_support_role',{p_id:grantA,p_reason:'End isolated scoped Factory revocation test'});
  must(await rpc(userA.client,'factory_snapshot',{p_job:jobA})===null,'REVOKED_ROLE_STILL_READS');
  const r=await userA.client.rpc('factory_create',{p_input:{...inputA,idempotencyKey:randomUUID(),domain:'revoked-'+randomUUID()+'.example.invalid'}});
  must(r.error?.code==='42501','REVOKED_ROLE_STILL_WRITES');
 });
 await check('mfa.logout_invalidates_old_privileged_token',async()=>{
  const old=(await userB.client.auth.getSession()).data.session.access_token;
  const signout=await userB.client.auth.signOut({scope:'local'});must(!signout.error,'TEST_SESSION_LOGOUT_FAILED');
  const response=await safeFetch(origin+'/rest/v1/rpc/factory_create',{method:'POST',headers:{apikey:keys.ANON_KEY,Authorization:'Bearer '+old,'Content-Type':'application/json'},body:JSON.stringify({p_input:request(orgB,projectB,userB.id,'stale')})});
  must([401,403].includes(response.status),'OLD_SESSION_FACTORY_WRITE_ACCEPTED');await response.body?.cancel();
 });
}catch(error){
 if(error.message!=='TEST_STOPPED')record('execution','FAIL',{code:/^[A-Z0-9_]+$/.test(error.message)?error.message:'SANITIZED_EXECUTION_FAILURE'});
 process.exitCode=1;
}finally{
 for(const client of clients){try{await client.auth.signOut({scope:'local'});}catch{/* Only new test sessions. No destructive cleanup. */}}
 for(const name of ['sso.onarly_to_factory','sso.onarly_to_qabgo','sso.cross_tenant','sso.replay','sso.revocation'])record(name,'BLOCKED',{code:'CENTRAL_ONARLY_PRODUCT_SSO_NOT_INTEGRATED'});
 const report={date:'2026-10-25',classification:'REAL_EXISTING_ISOLATED_HTTP',runId:manifest.runId,origin,results,created,productionChanged:false,providerRequests:0,destructiveCleanup:false,realProvisioning:false};
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,blocked:results.filter(r=>r.status==='BLOCKED').length,output}));
}
