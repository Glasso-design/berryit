import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {identityGate,requiredIdentityCases} from './http-identity-gate.mjs';
test('identity gate refuses production, missing markers and incomplete evidence',async()=>{
 const manifest={classification:'isolated-synthetic-factory',productionData:false,runId:randomUUID(),origins:['http://127.0.0.1:19999']};
 assert.equal((await identityGate({manifest})).status,'BLOCKED');
 await assert.rejects(identityGate({manifest:{...manifest,classification:'production'}}));
 await assert.rejects(identityGate({manifest:{...manifest,origins:['https://production.example.test']}}));
 await assert.rejects(identityGate({manifest,readMarker:async()=>({...manifest,runId:randomUUID()}),runCase:async()=>({status:'PASS'})}));
 const options={manifest,readMarker:async()=>manifest,synthetic:true,runCase:async()=>({status:'PASS',runId:manifest.runId,transport:'REAL_HTTP'})};
 const result=await identityGate(options);assert.equal(result.status,'SYNTHETIC_HARNESS_PASS');assert.equal(result.results.length,requiredIdentityCases.length);
 assert.equal((await identityGate({...options,runCase:async()=>({status:'PASS',runId:manifest.runId,transport:'MOCK'})})).status,'BLOCKED');
});
