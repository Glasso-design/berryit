import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture} from './fixture.mjs';
import {MockProvider} from '../providers/mock.mjs';
import {startLocalWorker} from '../worker.mjs';
import {assertIsolatedPgliteEnvironment} from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);
test('standalone worker refuses unknown environment and runs durable SQL queue without a browser',async()=>{
 const f=await fixture(),abort=new AbortController();let worker;
 try{
  const job=await f.create(),options={store:f.store,registry:f.registry,provider:new MockProvider({db:f.db}),signal:abort.signal,intervalMs:100};
  await f.db.exec("set factory.install_environment='production'");await assert.rejects(startLocalWorker(options));
  await f.db.exec("set factory.install_environment='isolated-test'");worker=startLocalWorker(options);
  let state;for(let i=0;i<100;i++){state=(await f.db.query('select state from factory.jobs where id=$1',[job])).rows[0].state;if(state==='WAITING_FOR_EXTERNAL')break;await delay(50);}
  assert.equal(state,'WAITING_FOR_EXTERNAL');assert.equal(Number((await f.db.query('select count(*) n from factory.resources where job_id=$1',[job])).rows[0].n),13);
 }finally{abort.abort();await worker;await f.db.close();}
});
