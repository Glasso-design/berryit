import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {ApiError,createAiHandler,createPostgrestBoundary,buildSupportPrompt} from './server.mjs';
const conversation={id:'33333333-3333-4333-8333-333333333333',organization_id:'22222222-2222-4222-8222-222222222222',project_id:'44444444-4444-4444-8444-444444444444'};
const project={facts:[{id:'T-synthetic',kind:'task',text:'Registered task: synthetic bug | status=blocked | priority=critical',at:'2026-10-25T12:00:00Z',origin:'project_tasks/server_scope',stale:false}],missingInformation:['No server logs or verified deployment available.']};
const config={authBaseUrl:'http://127.0.0.1:1/auth/v1',restBaseUrl:'http://127.0.0.1:1/rest/v1',anonKey:'synthetic-public-only',serviceRoleKey:'synthetic-server-only'};
test('the existing server adapter reads project context with the same actor, never service-role',async()=>{
 const calls=[];const boundary=createPostgrestBoundary({authBaseUrl:'http://127.0.0.1:1/auth/v1',restBaseUrl:'http://127.0.0.1:1/rest/v1',anonKey:'synthetic-public-only',serviceRoleKey:'synthetic-server-only',fetchImpl:async(url,init)=>{
  calls.push({url,init});return Response.json(String(url).endsWith('/project_control_ai_context')?project:[]);
 }});
 const context=await boundary.sourceContext({userId:'synthetic-user',token:'synthetic-actor'},conversation);
 assert.deepEqual(context.projectControl,project);assert.ok(calls.every(c=>c.init.headers.Authorization==='Bearer synthetic-actor'));
 const p=calls.find(c=>c.url.endsWith('/project_control_ai_context'));assert.deepEqual(JSON.parse(p.init.body),{p_project:conversation.project_id});
 const prompt=buildSupportPrompt('Vad blockerar produktion?',conversation,context);assert.match(prompt,/Registered task: synthetic bug/);assert.match(prompt,/ingen server-|ingen server|ingen server\/-|ingen server\/terminal|Du har ingen/);
});
test('a missing new RPC is explicit; a permission failure is never converted to missing/mock data',async()=>{
 for(const [status,code]of [[404,'PGRST202'],[403,'42501']]){
  const boundary=createPostgrestBoundary({...config,fetchImpl:async url=>String(url).endsWith('/project_control_ai_context')?Response.json({code},{status}):Response.json([])});
  if(status===403)await assert.rejects(boundary.sourceContext({token:'synthetic-actor'},conversation),e=>e.code==='FORBIDDEN');
  else{const c=await boundary.sourceContext({token:'synthetic-actor'},conversation);assert.equal(c.projectControl.facts.length,0);assert.match(c.projectControl.missingInformation.join(),/inte anslutet/);}
 }
});
for(const changed of [false,true])test('project answers retain exact registered facts; changed/revoked context '+(changed?'blocks persistence':'keeps hypotheses separate'),async()=>{
 let providerCalls=0,persisted=0;const boundary={identity:async token=>({userId:'synthetic-user',token}),conversation:async()=>conversation,
 sourceContext:async()=>({knowledge:[],tickets:[],projectControl:project}),projectControlContext:async()=>changed?{...project,facts:[]}:project,
 addUserMessage:async()=>{},addAssistantMessage:async()=>{persisted++;return {id:'synthetic-answer'};},auditFailure:async()=>{}};
 const gateway={enabled:true,complete:async prompt=>{providerCalls++;assert.match(prompt,/Registered task: synthetic bug/);return {text:JSON.stringify({summary:'Potential backlog',verifiedFacts:[{text:'Invented production health',sourceIds:['T-synthetic']}],hypotheses:[],recommendedActions:[],missingInformation:[],sources:[]}),provider:'SYNTHETIC',model:'synthetic-only'};}};
 const server=createServer(createAiHandler({boundary,gateway,logger:()=>{}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const ask=approved=>fetch(`http://127.0.0.1:${server.address().port}/ai/v1/conversations/${conversation.id}/messages`,{method:'POST',headers:{Authorization:'Bearer synthetic-actor','Content-Type':'application/json'},body:JSON.stringify({text:'Vad blockerar produktion?',approvedForAi:approved})});
 try{
  assert.equal((await ask(false)).status,400);assert.equal(providerCalls,0);
  const response=await ask(true),data=await response.json();assert.equal(response.status,changed?409:201);assert.equal(persisted,changed?0:1);
  if(!changed){assert.equal(data.response.verifiedFacts[0].text,`${project.facts[0].text} · ${project.facts[0].at} · ${project.facts[0].origin}`);assert.ok(!JSON.stringify(data.response.verifiedFacts).includes('Invented production health'));}
 }finally{await new Promise(r=>server.close(r));}
});
test('permission revoked after the outbound call prevents any project answer persistence',async()=>{
 const boundary=createPostgrestBoundary({...config,fetchImpl:async()=>Response.json({code:'42501'},{status:403})});
 await assert.rejects(boundary.projectControlContext({token:'old-synthetic-session'},conversation),e=>e instanceof ApiError&&e.code==='FORBIDDEN');
});
