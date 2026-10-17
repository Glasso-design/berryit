import test from 'node:test';
import assert from 'node:assert/strict';
import { readProjectRepository } from './repository-access.mjs';
const project='10000000-0000-4000-8000-000000000001';
const context={repository:'synthetic/project',provider_id:'42',secret_ref:'fixture'};
const actor={rpc:async()=>({data:context,error:null})};
const connections={fixture:{token:'synthetic-only-token',repositories:{'synthetic/project':'42'}}};
const response=data=>Response.json(data);
test('backend denial prevents any GitHub call',async()=>{
 let called=false;await assert.rejects(readProjectRepository({actor:{rpc:async()=>({error:{code:'42501'}})},input:{project,kind:'files'},connections,fetchImpl:async()=>{called=true;}}),e=>e.code==='FORBIDDEN');assert.equal(called,false);
});
test('server allowlist is independent of a client/integration repository choice',async()=>{
 await assert.rejects(readProjectRepository({actor,input:{project,kind:'commits'},connections:{},fetchImpl:async()=>{throw Error('must not fetch');}}),e=>e.code==='NOT_CONFIGURED');
});
test('read only fixed GitHub origin, identity pin, sanitized output, no token exposure',async()=>{
 const calls=[];const result=await readProjectRepository({actor,input:{project,kind:'commits',ref:'main'},connections,fetchImpl:async(url,init)=>{calls.push({url,init});return calls.length===1?response({id:42,full_name:'synthetic/project'}):response([{sha:'abc',commit:{message:'Synthetic commit'},token:'synthetic-only-token'}]);}});
 assert.ok(calls.every(c=>c.url.startsWith('https://api.github.com/repos/synthetic/project')&&c.init.method==='GET'&&c.init.redirect==='manual'));
 assert.equal(JSON.stringify(result).includes('synthetic-only-token'),false);assert.equal(result.readOnly,true);
});
for(const kind of ['write','POST','deploy','exec','delete'])test('refuses '+kind,async()=>{await assert.rejects(readProjectRepository({actor,input:{project,kind},connections}),e=>e.code==='BAD_CONFIG');});
test('identity drift or redirect cannot leak credential to another host',async()=>{
 await assert.rejects(readProjectRepository({actor,input:{project,kind:'files'},connections,fetchImpl:async()=>response({id:99,full_name:'synthetic/project'})}),e=>e.code==='FORBIDDEN');
 await assert.rejects(readProjectRepository({actor,input:{project,kind:'files'},connections,fetchImpl:async()=>new Response(null,{status:302,headers:{Location:'https://attacker.invalid'}})}),e=>e.code==='BAD_RESPONSE');
});
test('traversal and malformed refs are rejected',async()=>{
 for(const path of ['../other','a/../other','a\\other'])await assert.rejects(readProjectRepository({actor,input:{project,kind:'files',path},connections,fetchImpl:async()=>response({id:42,full_name:'synthetic/project'})}),e=>e.code==='BAD_CONFIG');
});
test('provider response size is bounded without Content-Length',async()=>{
 let calls=0;await assert.rejects(readProjectRepository({actor,input:{project,kind:'files'},connections,fetchImpl:async()=>++calls===1?response({id:42,full_name:'synthetic/project'}):new Response('x'.repeat(2000001))}),e=>e.code==='BAD_RESPONSE');
});
test('file contents are decoded for review without following download URLs',async()=>{
 let calls=0;const result=await readProjectRepository({actor,input:{project,kind:'files',path:'app.ts'},connections,fetchImpl:async()=>++calls===1?response({id:42,full_name:'synthetic/project'}):response({path:'app.ts',encoding:'base64',content:btoa('export const synthetic = true;'),download_url:'https://attacker.invalid'})});
 assert.equal(result.entries[0].content,'export const synthetic = true;');assert.equal(calls,2);assert.equal(JSON.stringify(result).includes('attacker.invalid'),false);
});
