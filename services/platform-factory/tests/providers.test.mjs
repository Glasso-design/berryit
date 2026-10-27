import test from 'node:test';
import {ProviderRegistry} from '../providers/registry.mjs';
import assert from 'node:assert/strict';
import { CloudflareContractClient,estimateR2 } from '../providers/cloudflare.mjs';
const cap=()=>({source:'server-provider-discovery',observedAt:Date.now(),tenantEnabled:true,unitId:'a'.repeat(32),userActive:true,userAgeDays:8,isSuperAdministrator:true,userOwnedToken:true,additionalAccountsRemaining:1});

test('operator provider registry denies unknown/live entries and arbitrary paths',()=>{
 const registry=new ProviderRegistry(),provider={mode:'MOCK',ensure(){},verify(){}};
 registry.register('isolated-mock',provider);assert.equal(registry.forJob('isolated-mock'),provider);
 assert.throws(()=>registry.forJob('unknown'));assert.throws(()=>registry.register('../module',provider));assert.throws(()=>registry.register('live-provider',{mode:'LIVE'}));
 registry.register('cloudflare-contract',{mode:'HTTP_CONTRACT'});assert.throws(()=>registry.forJob('cloudflare-contract'));
 assert(registry.list().every(p=>p.liveEnabled===false));
});
test('Cloudflare HTTP contracts are MOCK only; account modes never silently downgrade',async t=>{
 const calls=[];const client=new CloudflareContractClient({transportMode:'mock',secretStore:{get:async()=>({token:'synthetic-provider-test-only'})},transport:async(url,options)=>{calls.push({url,options});return Response.json({success:true,result:{id:'b'.repeat(32)}});}});
 await t.test('Tenant API uses explicit unit and stable idempotency header',async()=>{
  const plan=client.accountPlan({mode:'DEDICATED_MANAGED',name:'Synthetic A',key:'factory-account-key-0001',capabilities:cap()});
  assert.equal(plan.body.unit.id,'a'.repeat(32));assert.equal(plan.body.standalone,undefined);await client.send(plan);
  assert.equal(calls[0].options.headers['Idempotency-Key'],'factory-account-key-0001');assert.equal(calls[0].url,'https://api.cloudflare.com/client/v4/accounts');
 });
 await t.test('Standalone requires eligibility and never uses unit',()=>{
  const plan=client.accountPlan({mode:'LIMITED_STANDALONE',name:'Synthetic B',key:'factory-account-key-0002',capabilities:cap()});assert.equal(plan.body.standalone,true);assert.equal(plan.body.unit,undefined);
  for(const change of [{additionalAccountsRemaining:0},{userAgeDays:6},{userOwnedToken:false},{isSuperAdministrator:false}])assert.throws(()=>client.accountPlan({mode:'LIMITED_STANDALONE',name:'Synthetic B',key:'factory-account-key-0002',capabilities:{...cap(),...change}}));
 });
 await t.test('Managed resources explicitly are not a dedicated account',()=>{
  const plan=client.accountPlan({mode:'MANAGED_RESOURCE_ISOLATION',name:'Synthetic C',key:'factory-account-key-0003',managedAccountId:'c'.repeat(32),capabilities:{...cap(),managedResourceIsolationApproved:true,allowedAccountIds:['c'.repeat(32)]}});assert.equal(plan.createsAccount,false);assert.equal(plan.dedicatedAccount,false);
  assert.throws(()=>client.accountPlan({mode:'DEDICATED_MANAGED',name:'Synthetic A',key:'factory-account-key-0004',capabilities:{...cap(),tenantEnabled:false}}));
 });
 await t.test('expired discovery blocks; default client never sends real requests',async()=>{
  assert.throws(()=>client.accountPlan({mode:'DEDICATED_MANAGED',name:'Synthetic A',key:'factory-account-key-0005',capabilities:{...cap(),observedAt:0}}));
  await assert.rejects(new CloudflareContractClient({}).send({path:'/accounts',method:'POST'}),e=>e.code==='BLOCKED_LIVE_PROVIDER');
 });
 await t.test('R2 uses guaranteed EU jurisdiction, not a location hint or free-quota claim',()=>{
  const plan=client.bucketPlan({accountId:'a'.repeat(32),instanceId:'synthetic-instance',region:'eea',ownedIntent:{instanceId:'synthetic-instance',verifiedNewResource:true}});
  assert.equal(plan.headers['cf-r2-jurisdiction'],'eu');assert.equal(plan.body.locationHint,undefined);assert.equal(plan.retrySafe,false);
  assert.equal(estimateR2({objectBytes:10000000000}).sharedFreeTierDeducted,false);
 });
 await t.test('DNS requires ownership; routing requires a verified destination and is not a mailbox',()=>{
  assert.throws(()=>client.dnsPlan({zoneId:'a'.repeat(32),domain:'tenant.example.invalid',target:'runtime.example.invalid',instanceId:'synthetic',domainVerified:false}));
  assert.throws(()=>client.emailPlan({zoneId:'a'.repeat(32),address:'support@example.invalid',destination:'owner@example.test',mode:'routing',destinationVerified:false}));
  assert.throws(()=>client.emailPlan({zoneId:'a'.repeat(32),address:'support@example.invalid',destination:'owner@example.test',mode:'mailbox',destinationVerified:true}));
  const plan=client.emailPlan({zoneId:'a'.repeat(32),address:'support@example.invalid',destination:'owner@example.test',mode:'routing',destinationVerified:true});assert.equal(plan.body.actions[0].type,'forward');
 });
 await t.test('ambiguous non-idempotent provider timeout requires manual recovery',async()=>{
  const failed=new CloudflareContractClient({transportMode:'mock',secretStore:{get:async()=>({token:'synthetic-test-only'})},transport:async()=>{throw Error('timeout after commit');}});
  await assert.rejects(failed.send({method:'POST',path:'/accounts/'+('a'.repeat(32))+'/r2/buckets',headers:{},secretRef:'factory/r2',body:{name:'synthetic-test'},retrySafe:false}),e=>e.code==='MANUAL_RECOVERY'&&!e.retryable);
 });
});
