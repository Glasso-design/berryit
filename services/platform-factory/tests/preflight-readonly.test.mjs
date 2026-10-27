import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudflareReadonlyPreflight} from '../preflight/cloudflare-readonly.mjs';
const account='a'.repeat(32),zone='b'.repeat(32),token='c'.repeat(32);
test('read-only preflight cannot infer access from missing credentials or create resources',async()=>{
 const calls=[];const options={secretStore:{get:async()=>null},tokenRef:'approved-store/token',transport:async()=>{throw Error('Must not call network');}};
 const missing=await cloudflareReadonlyPreflight(options);assert.equal(missing.status,'BLOCKED_CREDENTIALS');assert.equal(missing.apiRequests,0);assert.equal(missing.verification,'NOT_RUN');
 const transport=async(url,init)=>{
  assert.equal(init.method,'GET');assert.equal(init.body,undefined);const p=new URL(url).pathname;calls.push(p);let result={id:account};
  if(p.endsWith('/verify'))result={id:token,status:'active'};
  else if(p.endsWith('/tokens/'+token))result={policies:[{effect:'allow',permission_groups:[{name:'Workers R2 Storage Read'}]}]};
  else if(p.endsWith('/r2/buckets'))result={buckets:[]};
  else if(p==='/client/v4/zones')result=[{id:zone,account:{id:account}}];
  else if(p.endsWith('/email/routing'))result={enabled:false};
  else if(p.endsWith('/addresses')||p.endsWith('/dns_records'))result=[];
  return Response.json({success:true,result,result_info:{page:1,total_pages:1}});
 };
 const result=await cloudflareReadonlyPreflight({...options,synthetic:true,accountId:account,secretStore:{get:async()=>({kind:'api-token',token:'synthetic-only'})},transport});
 assert.equal(result.status,'SYNTHETIC_HTTP_PASS');assert.equal(result.provisioningMode,'MOCK');assert.equal(result.realProvisioningApproved,false);assert.equal(result.writeCapabilities,'UNVERIFIED');assert.equal(result.accounts[0].zones[0].emailRoutingEnabled,false);assert(calls.length>=7);
 for(const status of [401,403]){
  const denied=await cloudflareReadonlyPreflight({...options,secretStore:{get:async()=>({kind:'api-token',token:'synthetic-only'})},transport:async()=>Response.json({success:false,errors:[{message:'do-not-log-synthetic-secret'}]},{status})});
  assert.equal(denied.status,'BLOCKED_TOKEN');assert(!JSON.stringify(denied).includes('do-not-log'));
 }
});
test('Tenant-only read access is partial; it never proves account creation entitlement',async()=>{
 const result=await cloudflareReadonlyPreflight({synthetic:true,tenantRef:'approved/tenant',secretStore:{get:async()=>({kind:'tenant-global-key',key:'synthetic-only',email:'synthetic@example.test'})},transport:async(url,options)=>{assert.equal(options.method,'GET');assert(new URL(url).pathname.endsWith('/user/tenants'));assert(!options.headers.Authorization);return Response.json({success:true,result:[{units:[{unit_tag:'synthetic'}]}]});}});
 assert.equal(result.status,'SYNTHETIC_HTTP_PARTIAL');assert.equal(result.apiRequests,1);assert.equal(result.tenant.accountCreationEntitlement,'UNVERIFIED');assert.equal(result.accounts.length,0);
});
test('unknown credential ownership fails before any network or secret read',async()=>{
 const result=await cloudflareReadonlyPreflight({tokenOwner:'untrusted-owner',tokenRef:'approved/token',secretStore:{get:async()=>{throw Error('Must not read');}},transport:async()=>{throw Error('Must not connect');}});
 assert.equal(result.status,'BLOCKED_CREDENTIAL_CONFIGURATION');assert.equal(result.apiRequests,0);
});
