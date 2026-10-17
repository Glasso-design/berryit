import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {ApiError,createAiHandler} from './server.mjs';
const id='33333333-3333-4333-8333-333333333333';
const context={version:1,organizationId:'org-a',projectId:'project-a',incidentId:null,
 facts:[{id:'M-1',text:'cpu_percent=99',at:'2026-10-16T12:00:00Z',origin:'agent'}],missingInformation:['Inga serverloggar har undersökts.']};
async function fixture(run,{enabled=true}={}){
 let revoked=false,changed=false,calls=0,audits=0;
 const boundary={identity:async token=>({userId:token,token}),conversation:async()=>{if(revoked)throw new ApiError(403,'FORBIDDEN');return {id,project_id:'project-a',organization_id:'org-a'};},
 diagnosticContext:async()=>{if(revoked)throw new ApiError(403,'FORBIDDEN');return changed?{...context,facts:[]}:context;},
 auditDiagnostic:async()=>audits++,addUserMessage:async()=>{},addAssistantMessage:async()=>({id:'answer'}),auditFailure:async()=>{}};
 const gateway={enabled,complete:async()=>{calls++;return {text:'{"summary":"Möjlig CPU-överlast","verifiedFacts":[],"hypotheses":[],"recommendedActions":[],"missingInformation":[],"sources":[]}',provider:'SYNTHETIC',model:'test'};}};
 const server=createServer(createAiHandler({boundary,gateway}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const request=async(body,token='synthetic-user-a')=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/ai/v1/conversations/${id}/diagnostics`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 try{await run({request,revoked:()=>revoked=true,changed:()=>changed=true,counts:()=>({calls,audits})});}
 finally{await new Promise(r=>server.close(r));}
}
test('preview and unapproved/forged direct requests never send data to Gateway',async()=>fixture(async({request,counts})=>{
 const p=await request({mode:'preview'});assert.equal(p.status,200);assert.deepEqual(counts(),{calls:0,audits:0});
 assert.equal((await request({mode:'analyze',previewId:p.body.previewId,approvedForAi:false})).body.error.code,'CONSENT_REQUIRED');
 assert.equal((await request({mode:'analyze',previewId:'invented',approvedForAi:true,role:'ADMIN',context:{projectId:'foreign'}})).status,409);
 assert.deepEqual(counts(),{calls:0,audits:0});
}));
test('a different user cannot use approval and a consumed approval cannot replay',async()=>fixture(async({request,counts})=>{
 const p=(await request({mode:'preview'})).body;
 assert.equal((await request({mode:'analyze',previewId:p.previewId,approvedForAi:true},'synthetic-user-b')).status,409);
 assert.equal((await request({mode:'analyze',previewId:p.previewId,approvedForAi:true})).status,201);
 assert.equal((await request({mode:'analyze',previewId:p.previewId,approvedForAi:true})).status,409);
 assert.deepEqual(counts(),{calls:1,audits:1});
}));
test('changed observations require new approval before any Gateway call',async()=>fixture(async({request,changed,counts})=>{
 const p=(await request({mode:'preview'})).body;changed();
 assert.equal((await request({mode:'analyze',previewId:p.previewId,approvedForAi:true})).status,409);assert.equal(counts().calls,0);
}));
test('revoked access blocks a previously approved scope before Gateway',async()=>fixture(async({request,revoked,counts})=>{
 const p=(await request({mode:'preview'})).body;revoked();
 assert.equal((await request({mode:'analyze',previewId:p.previewId,approvedForAi:true})).status,403);assert.equal(counts().calls,0);
}));
test('missing Gateway fails closed without simulated AI success',async()=>fixture(async({request,counts})=>{
 const p=(await request({mode:'preview'})).body;
 const r=await request({mode:'analyze',previewId:p.previewId,approvedForAi:true});assert.equal(r.status,503);assert.equal(r.body.error.code,'GATEWAY_DISABLED');assert.equal(counts().calls,0);
},{enabled:false}));
