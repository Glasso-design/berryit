import test from 'node:test';
import assert from 'node:assert/strict';
import {syncProjectIssues} from './project-issues.mjs';
import {readProjectRepository} from './repository-access.mjs';
const project='10000000-0000-4000-8000-000000000001',integration='20000000-0000-4000-8000-000000000002';
const connections={synthetic:{token:'synthetic-no-provider-token',repositories:{'synthetic/project':'42'}}};
const ctx={repository:'synthetic/project',provider_id:'42',secret_ref:'synthetic',actor_id:'synthetic-actor',session_id:'synthetic-session'};
const actor={rpc:async()=>({data:ctx,error:null})};
const issue=n=>({id:1000+n,number:n,title:'Synthetic '+n,body:'Synthetic body',state:'open',updated_at:'2026-10-25T10:00:00Z'});
test('absent current scope/MFA prevents all external reads and imports',async()=>{
 let calls=0;await assert.rejects(syncProjectIssues({actor:{rpc:async()=>({error:{code:'42501'}})},server:{},input:{project,integration},connections,fetchImpl:async()=>calls++}),e=>e.code==='FORBIDDEN');assert.equal(calls,0);
});
test('PR-only first page continues, complete issues use one atomic import and GET-only requests',async()=>{
 const requests=[],writes=[];const result=await syncProjectIssues({actor,server:{rpc:async(name,args)=>{writes.push({name,args});return {data:{created:1,observed:1},error:null};}},input:{project,integration},connections,fetchImpl:async(url,init)=>{
  requests.push({url,init});if(!url.includes('/issues?'))return Response.json({id:42,full_name:'synthetic/project'});
  return new URL(url).searchParams.get('page')==='1'?Response.json([{...issue(1),pull_request:{url:'ignored'}}],{headers:{Link:'<https://api.github.com/repos/synthetic/project/issues?page=2>; rel="next"'}}):Response.json([issue(2)]);
 }});
 assert.equal(result.created,1);assert.equal(writes.length,1);assert.equal(writes[0].name,'import_project_github_issues');assert.equal(writes[0].args.p_issues[0].number,2);assert.equal(writes[0].args.p_actor,'synthetic-actor');assert.ok(requests.every(r=>r.init.method==='GET'&&r.init.redirect==='manual'));
});
for(const failure of ['duplicate-page','timeout','malformed-list','revoked-before-commit'])test(failure+' cannot create partial/unapproved tasks',async()=>{
 let writes=0;const server={rpc:async()=>{writes++;return {error:{code:'42501'}};}};
 await assert.rejects(syncProjectIssues({actor,server,input:{project,integration},connections,fetchImpl:async url=>{
  if(!url.includes('/issues?'))return Response.json({id:42,full_name:'synthetic/project'});
  if(failure==='malformed-list')return Response.json({unexpected:true});
  if(failure==='timeout')throw Error('Synthetic connection interrupted');
  if(failure==='duplicate-page')return Response.json([issue(1)],{headers:{Link:'<ignored>; rel="next"'}});
  return Response.json([issue(1)]);
 }}));
 assert.equal(writes,failure==='revoked-before-commit'?1:0);
});
test('release/test/deployment views never imply a verified healthy production; secret files stay blocked',async()=>{
 const metadata={id:42,full_name:'synthetic/project'};
 const r=await readProjectRepository({actor,input:{project,integration,kind:'deployments'},connections,fetchImpl:async url=>Response.json(url.endsWith('/synthetic/project')?metadata:[{id:1,environment:'production',sha:'a'.repeat(40),token:'excluded'}])});
 assert.equal(r.entries[0].verification,'REGISTERED_DEPLOYMENT_NOT_HEALTH_VERIFIED');assert.ok(!JSON.stringify(r).includes('excluded'));
 for(const path of ['.env.production','private.pem','id_ed25519','x/../secrets'])await assert.rejects(readProjectRepository({actor,input:{project,integration,kind:'files',path},connections,fetchImpl:async()=>Response.json(metadata)}),e=>e.code==='BAD_CONFIG');
});
