import test from 'node:test';
import assert from 'node:assert/strict';
import { executeFactoryAction,createFactoryHttpClient } from '../../../shared/factory.ts';
test('API allowlist rejects forged roles/IDs and only delegates to protected RPC',async()=>{
 const calls=[],actor={rpc:async(name,args)=>{calls.push({name,args});return {data:{products:[]},error:null};}};
 await executeFactoryAction(actor,{action:'catalog'});assert.equal(calls[0].name,'factory_catalog');
 await assert.rejects(executeFactoryAction(actor,{action:'catalog',role:'ADMIN'}));
 await assert.rejects(executeFactoryAction(actor,{action:'details',jobId:'manipulated'}));
 await assert.rejects(executeFactoryAction(actor,{action:'delete',instanceId:'x'}));assert.equal(calls.length,1);
 const denied={rpc:async()=>({data:null,error:{message:'SQL denied'}})};await assert.rejects(executeFactoryAction(denied,{action:'catalog'}));
 let sent;const client=createFactoryHttpClient(async(url,init)=>{sent=JSON.parse(init.body);return Response.json({data:{items:[],hasMore:false}});});
 assert.equal((await client.request({action:'list'})).items.length,0);assert.deepEqual(sent,{action:'list'});
});
