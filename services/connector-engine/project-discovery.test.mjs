import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverRegisteredProject} from './project-discovery.mjs';
import {githubAdapter,vercelAdapter} from './adapters.mjs';
const integration={id:'synthetic-integration',is_enabled:true,access_mode:'read_only',connector_key:'github',secret_ref:'fixture',config:{discovery_enabled:true,repository:'synthetic/project',provider_project_id:'42'}};
const setup=(over={})=>({integration,secrets:{fixture:'synthetic-token'},store:{reconcileProject:async args=>args},fetchImpl:async()=>Response.json({id:42,name:'Synthetic',full_name:'synthetic/project'}),...over});
test('discovery uses provider ID and approved integration, never roles or manual update fields',async()=>{
 const args=await discoverRegisteredProject(setup());assert.deepEqual(Object.keys(args).sort(),['p_description','p_external_id','p_integration','p_name']);assert.equal(args.p_external_id,'42');
});
test('discovery requires explicit opt-in and enabled read-only mode',async()=>{
 for(const value of [{...integration,is_enabled:false},{...integration,access_mode:'read_write'},{...integration,config:{}}])await assert.rejects(discoverRegisteredProject(setup({integration:value})),e=>e.code==='NOT_CONFIGURED');
});
test('identity mismatch never writes to register',async()=>{
 let writes=0;await assert.rejects(discoverRegisteredProject(setup({store:{reconcileProject:async()=>{writes++;}},fetchImpl:async()=>Response.json({id:43})})),e=>e.code==='FORBIDDEN');assert.equal(writes,0);
});
test('Vercel pinned identity uses fixed origin and GET',async()=>{
 const calls=[];const args=await discoverRegisteredProject(setup({integration:{...integration,connector_key:'vercel',config:{discovery_enabled:true,project_id:'prj_fixture',provider_project_id:'prj_fixture'}},fetchImpl:async(url,init)=>{calls.push({url,init});return Response.json({id:'prj_fixture',name:'Synthetic Vercel'});}}));
 assert.equal(args.p_external_id,'prj_fixture');assert.equal(calls[0].url,'https://api.vercel.com/v9/projects/prj_fixture');assert.equal(calls[0].init.method,'GET');
});
test('existing authenticated adapters refuse untrusted token destinations',async()=>{
 let requests=0;for(const adapter of [githubAdapter,vercelAdapter])await assert.rejects(adapter.check({config:{repository:'synthetic/project',project_id:'prj_fixture',api_base:'https://attacker.invalid'},secretRef:'fixture',secrets:{fixture:'synthetic-token'},fetchImpl:async()=>{requests++;}}),e=>e.code==='BAD_CONFIG');assert.equal(requests,0);
});
