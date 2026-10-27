import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {connectCluster} from './postgres/cluster.mjs';
import {loadQabgoSource} from '../adapters/qabgo-source.mjs';
import {localQabgoSteps} from './postgres/local-qabgo.mjs';
import {fixture} from './fixture.mjs';
import {FactoryEngine} from '../engine.mjs';
import {MockProvider} from '../providers/mock.mjs';
import {QuotaBroker,qabgoStorageRoutes} from '../providers/quota-broker.mjs';
import {syntheticR2} from './synthetic-r2.mjs';

const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--environment=isolated-factory-postgres'||!args[1].startsWith('--metadata='))throw Error('Explicit isolated test cluster required');
const sourceRoot='C:/projects/ONARLY-DRIVE-worktrees/qabgo-driver-ui-v2-feature';
test('PostgreSQL parallel sessions + unchanged QABGO HTTP authority + R2 broker',async t=>{
 const cluster=await connectCluster(args[1].slice(11),sourceRoot),synthetic=await syntheticR2();let f,local;const brokerClients=[];
 try{
  const template=JSON.parse(await readFile(new URL('../adapters/qabgo.template.json',import.meta.url),'utf8')),source=await loadQabgoSource(sourceRoot,template);
  const control=await cluster.createSpace(randomUUID(),randomUUID()),admin=await cluster.client({database:control.database});
  f=await fixture({query:(...a)=>admin.query(...a),exec:sql=>admin.query(sql),close:()=>admin.end()});
  for(let n=0;n<6;n++){const client=await cluster.client({database:control.database});await client.query('set role factory_broker');brokerClients.push(client);}
  let next=0;const db={query:(...a)=>brokerClients[(next++)%brokerClients.length].query(...a)},brokers=new Map();
  local=localQabgoSteps(cluster,source,{storageRoutes:async({services,space,job})=>{
   const binding=randomUUID(),secret=randomBytes(32).toString('hex');
   await f.db.query('insert into factory.storage_bindings(id,instance_id,secret_hash,product_tenant_id,account_id,bucket,jurisdiction) values($1,$2,$3,$4,$5,$6,$7)',[binding,job.instance_id,createHash('sha256').update(secret).digest('hex'),space.tenant,'a'.repeat(32),'synthetic-bucket','eu']);
   const broker=new QuotaBroker({db,binding,secret,tenantId:space.tenant,r2:synthetic.r2,authorize:async p=>p?.permissions.has('sites.manage')});brokers.set(job.instance_id,broker);
   const {errors}=await source.load('http/errors.ts');return qabgoStorageRoutes(broker,{errors,rateLimiter:services.rateLimiter});
  }});
  const engine=new FactoryEngine({store:f.store,registry:f.registry,provider:new MockProvider({db:f.db,localSteps:local.steps})});
  const ja=await f.create(f.request({storageQuotaBytes:10000000})),jb=await f.create(f.request({organizationId:f.ids.orgB,projectId:f.ids.projectB,ownerId:f.ids.customerB,storageQuotaBytes:10000000}),f.ids.adminB);
  for(const j of [ja,jb])await engine.run(j);
  const ia=(await f.rpc(f.ids.adminA,'factory_snapshot',[ja])).instance.id,ib=(await f.rpc(f.ids.adminB,'factory_snapshot',[jb])).instance.id;
  const a=await local.activateSyntheticOwner(ia),b=await local.activateSyntheticOwner(ib);
  const request=(session,path,body,token=session.accessToken)=>fetch(session.origin+'/v1/dispatch/storage/'+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
  let reservation;
  await t.test('six independent DB connections atomically reserve at most 10,000,000 bytes',async()=>{
   const p={kind:'user',userId:a.userId,tenantId:a.tenantId,permissions:new Set(['sites.manage'])};
   const result=await Promise.allSettled(Array.from({length:6},()=>brokers.get(ia).reserve(p,{idempotencyKey:randomUUID(),bytes:6000000})));
   assert.equal(result.filter(x=>x.status==='fulfilled').length,1);reservation=result.find(x=>x.status==='fulfilled').value;
   const status=await f.rpc(f.ids.adminA,'factory_storage_status',[ia]);assert.equal(Number(status.reserved_bytes),6000000);assert.equal(synthetic.counts().initiateCalls,1);
  });
  await t.test('real product HTTP accepts owner; rejects forged tenant, missing auth, other runtime token',async()=>{
   const body={idempotencyKey:randomUUID(),bytes:1};
   assert.equal((await request(a,'reservations',{...body,tenantId:b.tenantId})).status,400);
   assert.equal((await request(a,'reservations',body,'synthetic-forged-token')).status,401);
   assert.equal((await request(a,'reservations',body,b.accessToken)).status,401);
   const foreign=await request(b,'parts',{reservationId:reservation.reservationId,number:1,md5:createHash('md5').update('synthetic').digest('base64')});assert.equal(foreign.status,400);
   const own=await request(a,'reservations',body);assert.equal(own.status,200);
  });
  await t.test('complete upload via actual QABGO route and current membership re-check',async()=>{
   const bytes=Buffer.alloc(6000000,71);const response=await request(a,'parts',{reservationId:reservation.reservationId,number:1,md5:createHash('md5').update(bytes).digest('base64')});assert.equal(response.status,200);const signed=await response.json();assert.equal((await synthetic.upload(signed,bytes)).status,200);
   const complete=await request(a,'complete',{reservationId:reservation.reservationId});assert.equal(complete.status,200);assert.equal((await complete.json()).state,'COMMITTED');
   const owner=await cluster.client(cluster.spaces.get(ia).owner);try{await owner.query("select set_config('drive.platform','on',false)");await owner.query("update drive.users set status='disabled' where id=$1",[a.userId]);}finally{await owner.end();}
   const revoked=await request(a,'reservations',{idempotencyKey:randomUUID(),bytes:1});assert([401,403].includes(revoked.status));
  });
 }finally{
  if(local)await local.close();for(const c of brokerClients)await c.end();if(f)await f.db.close();await synthetic.close();await cluster.close();
 }
});
