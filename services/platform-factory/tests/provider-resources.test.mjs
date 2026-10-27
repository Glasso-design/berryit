import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {CloudflareApiClient} from '../providers/cloudflare-api.mjs';
import {CloudflareProvider} from '../providers/cloudflare-provider.mjs';
import {ResourceRegistry} from '../providers/resource-registry.mjs';
import {TlsVerifier} from '../providers/tls-email.mjs';
import {assertIsolatedPgliteEnvironment} from '../../../supabase/tests/isolated-environment.mjs';
assertIsolatedPgliteEnvironment(process.argv.slice(2),process.env);

test('concrete Cloudflare providers use durable SQL registry and actual API response shapes',async t=>{
 const f=await fixture();try{
  const account='a'.repeat(32),zone='b'.repeat(32),token='c'.repeat(32),dnsId='d'.repeat(32),emailId='e'.repeat(32),registry=new ResourceRegistry(f.db);
  const refs=Object.fromEntries(['tenant','account','user','r2','dns','email'].map(x=>[x,'synthetic/'+x]));let accountCreates=0,bucketCreates=0,dnsCreates=0,emailCreates=0,verifiedDestination=false,denyDns=false;
  let bucket=null,dns=null,email=null,loseDns=true,loseBucket=false;
  const api=new CloudflareApiClient({synthetic:true,authorize:async()=>true,sleep:async()=>{},secretStore:{get:async ref=>ref===refs.tenant?{kind:'tenant-global-key',email:'synthetic@example.test',key:'synthetic-only'}:{kind:'api-token',token:'synthetic-only'}},transport:async(url,options)=>{
   const u=new URL(url),p=u.pathname.replace('/client/v4',''),body=options.body?JSON.parse(options.body):null;let result={id:account};
   if(p.endsWith('/tokens/verify'))result={id:token,status:'active'};
   else if(p==='/user/tenants')result=[{units:[{unit_tag:'synthetic-unit'}]}];
   else if(p==='/user')result={id:account,email_verified:true,created_on:'2020-01-01'};
   else if(p==='/memberships')result=[{id:account,status:'accepted',roles:['Super Administrator']}];
   else if(p==='/accounts'&&options.method==='POST'){assert(body.unit||body.standalone);assert(options.headers['Idempotency-Key']);accountCreates++;result={id:account};}
   else if(p==='/zones/'+zone)result={id:zone,account:{id:account},name:'example.test',status:'active'};
   else if(p.includes('/r2/buckets')){
    if(options.method==='POST'){bucketCreates++;bucket={...body,jurisdiction:options.headers['cf-r2-jurisdiction']};if(loseBucket)throw Error('synthetic timeout after bucket create');result=bucket;}
    else if(p.endsWith('/buckets'))result={buckets:bucket?[bucket]:[]};
    else if(!bucket)return Response.json({success:false},{status:404});else result=bucket;
   }else if(p.includes('/dns_records')){
    if(denyDns)return Response.json({success:false},{status:403});
    if(options.method==='POST'){dnsCreates++;dns={id:dnsId,...body};if(loseDns){loseDns=false;throw Error('synthetic timeout after DNS create');}result=dns;}
    else result=p.endsWith('/'+dnsId)?dns:dns?[dns]:[];
   }else if(p.endsWith('/email/routing/addresses'))result=[{email:'owner@example.test',verified:verifiedDestination?'2026-01-01T00:00:00Z':null}];
   else if(p.includes('/email/routing/rules')){
    if(options.method==='POST'){emailCreates++;email={tag:emailId,...body};result=email;}else result=p.endsWith('/'+emailId)?email:email?[email]:[];
   }
   return Response.json({success:true,result,result_info:{page:Number(u.searchParams.get('page')??1),total_pages:1}});
  }});
  const provider=new CloudflareProvider({api,registry,secretRefs:refs});
  const job=await f.store.claim(await f.create(f.request({domain:'tenant.example.test'})));
  let cap=await provider.discover({accountId:account,zoneId:zone,tenantUnitId:'synthetic-unit'});
  await t.test('Tenant uses explicit partner auth/entitlement and stable account intent',async()=>{
   await assert.rejects(provider.account({job,mode:'DEDICATED_MANAGED',capabilities:cap}),e=>e.code==='BLOCKED_TENANT_ENTITLEMENT');
   const request={job,mode:'DEDICATED_MANAGED',capabilities:cap,tenantEntitlement:{unitId:'synthetic-unit',operatorVerified:true,verifiedAt:Date.now()}};
   assert.equal((await provider.account(request)).id,account);await provider.account(request);assert.equal(accountCreates,1);
   await assert.rejects(provider.account({...request,mode:'MANAGED_RESOURCE_ISOLATION',managedAccountId:account}),e=>e.code==='ACCOUNT_MODE_APPROVAL_REQUIRED');
  });
  await t.test('R2 bucket is isolated, EU jurisdiction, stable and not recreated on retry',async()=>{
   const result=await provider.bucket({job,accountId:account,capabilities:cap});assert.equal(result.jurisdiction,'eu');assert.equal(result.namespace,job.instance_id+'/');
   await provider.bucket({job,accountId:account,capabilities:cap});assert.equal(bucketCreates,1);
  });
  await t.test('DNS timeout reconciles ownership tag; foreign collisions and scopes denied',async()=>{
   const input={job,zoneId:zone,target:'runtime.example.test',capabilities:cap};await assert.rejects(provider.dns(input),e=>e.code==='MANUAL_RECOVERY');
   assert.equal((await provider.dns(input)).id,dnsId);assert.equal(dnsCreates,1);
   await assert.rejects(provider.dns({...input,zoneId:'f'.repeat(32)}));
   const foreign=await f.store.claim(await f.create(f.request({domain:'other.example.test'})));await assert.rejects(provider.dns({...input,job:foreign}),e=>e.code==='RESOURCE_COLLISION');
  });
  await t.test('routing requires verified recipient and exact instance email domain',async()=>{
   const input={job,accountId:account,zoneId:zone,address:'support@tenant.example.test',destination:'owner@example.test',capabilities:cap};
   await assert.rejects(provider.routing(input),e=>e.code==='WAITING_EMAIL_VERIFICATION');verifiedDestination=true;
   await assert.rejects(provider.routing({...input,address:'support@other.example.test'}),e=>e.code==='BLOCKED_EMAIL_SCOPE');
   assert.equal((await provider.routing(input)).mailbox,false);await provider.routing(input);assert.equal(emailCreates,1);
  });
  await t.test('read inspection publishes truthful synthetic DNS/email/TLS status and missing permissions',async()=>{
   const tlsVerifier=new TlsVerifier({approvedDomains:[job.input.domain],resolve:async()=>[{address:'1.1.1.1'}],probe:async()=>({verified:true})});
   const status=await provider.inspect({job,accountId:account,zoneId:zone,tlsVerifier});assert.equal(status.dns,'SYNTHETIC');assert.equal(status.email,'SYNTHETIC');assert.equal(status.tls,'SYNTHETIC');
   const data=await f.rpc(f.ids.adminA,'factory_provider_status',[job.instance_id]);assert.equal(data.verification,'SYNTHETIC_HTTP');assert.equal(data.resources.length,4);
   denyDns=true;cap=await provider.discover({accountId:account,zoneId:zone});assert(cap.missingPermissions.includes('dns.read'));
  });
  await t.test('ambiguous bucket creation cannot claim an untagged resource or create another',async()=>{
   const other=await f.store.claim(await f.create());bucket=null;loseBucket=true;denyDns=false;
   const input={job:other,accountId:account,capabilities:cap};await assert.rejects(provider.bucket(input),e=>e.code==='MANUAL_RECOVERY');const before=bucketCreates;
   await assert.rejects(provider.bucket(input),e=>e.code==='MANUAL_RECOVERY');assert.equal(bucketCreates,before);
  });
 }finally{await f.db.close();}
});
