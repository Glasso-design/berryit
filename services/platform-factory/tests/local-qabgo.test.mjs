import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { connectCluster } from './postgres/cluster.mjs';
import { localQabgoSteps } from './postgres/local-qabgo.mjs';
import { loadQabgoSource } from '../adapters/qabgo-source.mjs';
import { fixture } from './fixture.mjs';
import { FactoryEngine } from '../engine.mjs';
import { MockProvider } from '../providers/mock.mjs';
import { snapshotSyntheticDatabase,restoreSyntheticDatabase } from './postgres/backup.mjs';
import { LocalObjectStorage } from '../providers/local-storage.mjs';
import {verifyQabgoWeb} from './postgres/browser.mjs';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--environment=isolated-factory-postgres'||!args[1].startsWith('--metadata='))throw Error('Requires exact isolated-factory-postgres environment and protected metadata');
const sourceRoot='C:/projects/ONARLY-DRIVE-worktrees/qabgo-driver-ui-v2-feature';
const template=JSON.parse(await readFile(new URL('../adapters/qabgo.template.json',import.meta.url),'utf8'));

test('LOCAL: two genuinely clean QABGO databases/runtimes; cloud remains MOCK',async t=>{
 const cluster=await connectCluster(args[1].slice('--metadata='.length),sourceRoot);
 let f,local;
 try {
  const source=await loadQabgoSource(sourceRoot,template);
  const control=await cluster.createSpace(randomUUID(),randomUUID());
  const controlClient=await cluster.client({database:control.database});
  f=await fixture({query:(...a)=>controlClient.query(...a),exec:sql=>controlClient.query(sql),close:()=>controlClient.end()});
  local=localQabgoSteps(cluster,source);
  const provider=new MockProvider({db:f.db,localSteps:local.steps});const engine=new FactoryEngine({store:f.store,registry:f.registry,provider});
  const first=await f.create();
  const second=await f.create(f.request({organizationId:f.ids.orgB,projectId:f.ids.projectB,ownerId:f.ids.customerB,name:'Synthetic Platform B',customerName:'Synthetic Factory B'}),f.ids.adminB);
  let a,b,sessionA,sessionB;
  await t.test('Factory provisions the pinned full 19-migration schema into two new databases',async()=>{
   for(const id of [first,second]) {
    const result=await engine.run(id);
    const row=(await f.db.query('select checklist from factory.jobs where id=$1',[id])).rows[0];
    for(const step of ['database','migrations','identity','runtime','health']){
     const check=row.checklist.find(x=>x.id===step);assert.equal(check.status,'VERIFIED',step+': '+JSON.stringify(check));
     assert.equal(check.evidence.local.mode,'LOCAL');
    }
    assert.equal(result.state,'WAITING_FOR_EXTERNAL');
   }
   a=await f.rpc(f.ids.adminA,'factory_snapshot',[first]);b=await f.rpc(f.ids.adminB,'factory_snapshot',[second]);
   assert.notEqual(a.instance.id,b.instance.id);assert.notEqual(a.instance.owner_id,b.instance.owner_id);
   assert.notEqual(cluster.spaces.get(a.instance.id).database,cluster.spaces.get(b.instance.id).database);
   assert.notEqual(a.resources.find(x=>x.step==='storage').id,b.resources.find(x=>x.step==='storage').id);
  });
  await t.test('new product identities are disabled and have no copied sessions/customer data',async()=>{
   for(const snapshot of [a,b]) {
    const s=cluster.spaces.get(snapshot.instance.id),c=await cluster.client(s.owner);
    try {await c.query('begin');await c.query("select set_config('drive.platform','on',true)");
     assert.equal((await c.query("select status,password_hash from drive.users")).rows[0].status,'disabled');
     assert.equal((await c.query("select password_hash from drive.users")).rows[0].password_hash,null);
     for(const table of ['bookings','vehicles','auth_sessions'])assert.equal(Number((await c.query('select count(*) n from drive.'+table)).rows[0].n),0);
     const link=(await c.query('select * from public.factory_identity_link')).rows[0];assert.equal(link.onarly_profile_id,snapshot.instance.owner_id);
     await c.query('commit');
    } finally {await c.end();}
   }
  });
  await t.test('explicit synthetic activation logs into the REAL QABGO HTTP API as owner',async()=>{
   sessionA=await local.activateSyntheticOwner(a.instance.id);sessionB=await local.activateSyntheticOwner(b.instance.id);
   assert.notEqual(sessionA.accessToken,sessionB.accessToken);
   for(const session of [sessionA,sessionB]) {
    const response=await fetch(session.origin+'/v1/dispatch/session',{headers:{Authorization:'Bearer '+session.accessToken}});assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.tenant_id,session.tenantId);
    assert.equal((await fetch(session.origin+'/health/ready')).status,200);
   }
  });
  await t.test('a token or database credential from one instance cannot access the other',async()=>{
   assert.equal((await fetch(sessionB.origin+'/v1/dispatch/session',{headers:{Authorization:'Bearer '+sessionA.accessToken}})).status,401);
   const sa=cluster.spaces.get(a.instance.id),sb=cluster.spaces.get(b.instance.id);
   await assert.rejects(cluster.client({...sa.app,database:sb.database}),e=>e.code==='42501');
   assert.equal(await f.rpc(f.ids.adminA,'factory_snapshot',[second]),null);
  });
  await t.test('four production web bundles render and log into the actual isolated API',async()=>{
   const driver=await local.createSyntheticDriver(a.instance.id);
   const result=await verifyQabgoWeb(sessionA,sessionB,driver);assert.equal(result.length,4);console.log(JSON.stringify({webVerification:result}));
  });
  await t.test('quota locks are real PostgreSQL row locks under concurrent reservations',async()=>{
   const instance=a.instance.id;await f.db.query('update factory.instances set quota_bytes=100 where id=$1',[instance]);
   const actor=async()=>{const c=await cluster.client({database:control.database});try{
    await c.query('begin');await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:f.ids.adminA,role:'authenticated',aal:'aal2',session_id:f.ids.adminA})]);await c.query('set local role authenticated');
    const result=await c.query('select public.factory_reserve($1,$2,$3) result',[instance,randomUUID(),60]);await c.query('commit');return result.rows[0].result;
   }catch(e){await c.query('rollback');throw e;}finally{await c.end();}};
   const results=await Promise.allSettled([actor(),actor()]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
   assert.equal(Number((await f.db.query('select reserved_bytes from factory.instances where id=$1',[instance])).rows[0].reserved_bytes),60);
  });
  await t.test('encrypted database/object/config backup restores into a third new owned database',async()=>{
   const storage=new LocalObjectStorage({store:f.store,actor:(name,args)=>f.rpc(f.ids.adminA,name,args)});
   const object=await storage.put(a.instance.id,randomUUID(),'synthetic backup object');
   const objects=[{id:object,body:await storage.get(a.instance.id,object)}];
   const identity={instanceId:a.instance.id,version:template.version};
   const backup=await snapshotSyntheticDatabase(cluster,cluster.spaces.get(a.instance.id),identity,objects);
   assert(!backup.archive.includes(Buffer.from('synthetic backup object')));
   const before=cluster.spaces.size;
   await assert.rejects(restoreSyntheticDatabase(cluster,{...backup,archive:backup.archive.subarray(0,-10)},identity,randomUUID(),randomUUID()));assert.equal(cluster.spaces.size,before);
   await assert.rejects(restoreSyntheticDatabase(cluster,backup,identity,a.instance.id,randomUUID()));
   const restored=await restoreSyntheticDatabase(cluster,backup,identity,randomUUID(),randomUUID());
   assert.notEqual(restored.target.database,cluster.spaces.get(a.instance.id).database);assert.deepEqual(restored.objects,objects);
   const c=await cluster.client(restored.target.owner);try{
    await c.query('begin');await c.query("select set_config('drive.platform','on',true)");
    assert.equal(Number((await c.query('select count(*) n from drive.users')).rows[0].n),2);
    assert.equal(Number((await c.query('select count(*) n from drive.bookings')).rows[0].n),0);
    assert.equal((await c.query('select instance_id from public.factory_origin')).rows[0].instance_id,restored.target.instanceId);
    const restoredObject=(await c.query('select body,owner_instance_id from public.factory_restored_objects where id=$1',[object])).rows[0];
    assert.equal(restoredObject.body.toString(),'synthetic backup object');assert.equal(restoredObject.owner_instance_id,restored.target.instanceId);
    await c.query('commit');
   }finally{await c.end();}
   await local.steps.runtime({job:{instance_id:restored.target.instanceId}});
   assert.equal((await fetch(restored.target.origin+'/health/ready')).status,200);
   const login=await fetch(restored.target.origin+'/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audience:'dispatch',tenant_id:restored.target.tenant,email:sessionA.email,password:sessionA.password})});assert.equal(login.status,200);
  });
  console.log(JSON.stringify({mode:'LOCAL_POSTGRESQL_AND_QABGO_HTTP',cloud:'MOCK',instances:2,migrationsPerInstance:19,sourceVersion:template.version,productionChanged:false}));
 } finally {if(local)await local.close();if(f)await f.db.close();await cluster.close();}
});
