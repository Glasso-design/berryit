import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.mjs';
import { ProductRegistry } from '../registry.mjs';
import { FactoryEngine } from '../engine.mjs';
import { MockProvider } from '../providers/mock.mjs';
import { validateAdapter } from '../contract.mjs';
import { assertIsolatedPgliteEnvironment } from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
test('same engine accepts a second synthetic adapter; DAG ordering and invalid contracts',async()=>{
 const f=await fixture();try{
  const adapter={...f.adapter,productId:'synthetic-sdk-product',checklist:()=>f.adapter.checklist().filter(c=>c.type==='AUTO').reverse()};
  const registry=new ProductRegistry([{id:'qabgo'},{id:adapter.productId}]).register(f.adapter).register(adapter);
  assert.throws(()=>registry.register(adapter));assert.throws(()=>validateAdapter({...adapter,backup:null}));
  assert.throws(()=>validateAdapter({...adapter,checklist:()=>[{id:'a',type:'AUTO',required:true,dependsOn:['b']},{id:'b',type:'AUTO',required:true,dependsOn:['a']}]}));
  await f.db.query("insert into factory.adapters(product_id,version,status,template,provenance) values($1,$2,'ADAPTER_IN_DEVELOPMENT',$3,'{\"mode\":\"SYNTHETIC_TEST_ONLY\"}')",[adapter.productId,adapter.versions[0],JSON.stringify(adapter.checklist())]);
  const job=await f.create(f.request({productId:adapter.productId}));
  const engine=new FactoryEngine({store:f.store,registry,provider:new MockProvider({db:f.db})});
  const result=await engine.run(job);assert.equal(result.state,'READY');assert.equal(result.liveProvisioning,false);
  assert.equal((await f.rpc(f.ids.adminA,'factory_snapshot',[job])).resources.length,13);
 }finally{await f.db.close();}
});
