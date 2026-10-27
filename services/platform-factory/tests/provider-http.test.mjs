import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {CloudflareApiClient} from '../providers/cloudflare-api.mjs';
import {CloudflareProvider} from '../providers/cloudflare-provider.mjs';
import {TlsVerifier,CloudflareTransactionalEmail,ExternalMailboxProvider} from '../providers/tls-email.mjs';
import {signS3,parseS3Xml} from '../providers/r2-s3.mjs';

const id='a'.repeat(32),zone='b'.repeat(32),tokenId='c'.repeat(32);
const refs={account:'synthetic/account',r2:'synthetic/r2',dns:'synthetic/dns',email:'synthetic/email',tenant:'synthetic/tenant',user:'synthetic/user'};
const credentials={get:async ref=>ref===refs.tenant?{kind:'tenant-global-key',email:'synthetic@example.test',key:'synthetic-test-only'}:{kind:'api-token',token:'synthetic-test-only'}};

test('actual HTTP transport: fixed Cloudflare contracts, capabilities, retry and safe failures',async t=>{
 const calls=[];let fault=null,count=0;
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const url=new URL(req.url,'http://127.0.0.1');calls.push({method:req.method,path:url.pathname,headers:req.headers,body:raw?JSON.parse(raw):null});
  if(fault){const status=fault;if(status==='timeout'){req.socket.destroy();return;}if(status==='429-once'&&count++===0){res.writeHead(429,{'retry-after':'0'});res.end();return;}if(Number.isInteger(status)){res.writeHead(status);res.end(JSON.stringify({success:false,errors:[{message:'synthetic-secret-must-never-escape'}]}));return;}}
  let result={id};
  if(url.pathname.endsWith('/tokens/verify'))result={id:tokenId,status:'active'};
  else if(url.pathname==='/client/v4/user')result={id,email_verified:true,created_on:'2020-01-01T00:00:00Z'};
  else if(url.pathname==='/client/v4/user/tenants')result=[{units:[{unit_tag:'tenant-unit-test'}]}];
  else if(url.pathname==='/client/v4/memberships')result=[{id,status:'accepted',roles:['Super Administrator']}];
  else if(url.pathname==='/client/v4/zones/'+zone)result={id:zone,account:{id},name:'example.test',status:'active'};
  else if(url.pathname.endsWith('/email/routing/addresses'))result=[{id,email:'owner@example.test',verified:'2026-01-01T00:00:00Z'}];
  else if(url.pathname.endsWith('/email/sending/send'))result={delivered:[],queued:['owner@example.test'],permanent_bounces:[]};
  res.setHeader('content-type','application/json');res.end(JSON.stringify({success:true,result,result_info:{page:Number(url.searchParams.get('page')??1),total_pages:1}}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+server.address().port;
 const transport=(url,options)=>{assert.equal(new URL(url).origin,'https://api.cloudflare.com');return fetch(origin+new URL(url).pathname+new URL(url).search,options);};
 const api=new CloudflareApiClient({secretStore:credentials,transport,synthetic:true,authorize:async()=>true,sleep:async()=>{}});
 try{
  await t.test('default activation and wrong origins/headers are denied before transport',async()=>{
   await assert.rejects(new CloudflareApiClient({secretStore:credentials,transport}).request({path:'/accounts',secretRef:refs.account}),e=>e.code==='BLOCKED_PROVIDER_ACTIVATION');
   await assert.rejects(api.request({path:'//evil.test/token',secretRef:refs.account}));await assert.rejects(api.request({path:'/accounts',secretRef:refs.account,headers:{Authorization:'bad'}}));
  });
  await t.test('discovery differentiates read from unverified write; foreign zone denied',async()=>{
   const provider=new CloudflareProvider({api,registry:{},secretRefs:refs});
   const cap=await provider.discover({accountId:id,zoneId:zone,tenantUnitId:'tenant-unit-test',standaloneEligibility:{tokenId,userId:id,verifiedAt:Date.now(),operatorVerified:true,remaining:1},managedApproval:{accountId:id,explicit:true}});
   assert(cap.accountModes.includes('DEDICATED_MANAGED'));assert(cap.accountModes.includes('LIMITED_STANDALONE'));assert(cap.accountModes.includes('MANAGED_RESOURCE_ISOLATION'));
   assert.equal(cap.capabilities['r2.read'],'VERIFIED_READ');assert.equal(cap.capabilities['r2.write'],'UNVERIFIED');assert.equal(cap.verification,'SYNTHETIC_HTTP');assert(cap.blockers.includes('EXTERNAL_BACKUP_AND_RESTORE_REQUIRED'));
   assert(calls.some(c=>c.path.endsWith('/user/tenants')&&c.headers['x-auth-key']==='synthetic-test-only'&&!c.headers.authorization));
   await assert.rejects(provider.account({job:{input:{accountMode:'DEDICATED_MANAGED'}},mode:'DEDICATED_MANAGED',capabilities:{...cap}}),e=>e.code==='BLOCKED_PROVIDER_DISCOVERY');
  });
  await t.test('401,403 and expired/revoked local tokens fail closed without raw errors',async()=>{
   for(const status of [401,403]){fault=status;await assert.rejects(api.token({secretRef:refs.account,accountId:id}),e=>e.code==='BLOCKED_PROVIDER_PERMISSION'&&!e.message.includes('synthetic-secret'));}
   fault=null;for(const extra of [{revokedAt:new Date().toISOString()},{expiresAt:'2000-01-01T00:00:00Z'},{expiresAt:'invalid'},{notBefore:'2099-01-01T00:00:00Z'}]){
    const deny=new CloudflareApiClient({secretStore:{get:async()=>({kind:'api-token',token:'synthetic',...extra})},transport,authorize:async()=>true});await assert.rejects(deny.request({path:'/accounts',secretRef:'synthetic'}));
   }
   for(const state of [{status:'disabled'},{status:'expired'},{status:'active',expires_on:'2000-01-01'},{status:'active',expires_on:'invalid'}]){
    const remote=new CloudflareApiClient({secretStore:credentials,authorize:async()=>true,transport:async()=>Response.json({success:true,result:{id:tokenId,...state}})});await assert.rejects(remote.token({secretRef:refs.account}));
   }
  });
  await t.test('GET retries rate limits; mutation timeouts require reconciliation',async()=>{
   fault='429-once';count=0;await api.request({path:'/accounts',secretRef:refs.account});assert.equal(count,2);
   fault='timeout';await assert.rejects(api.request({method:'POST',path:'/accounts/'+id+'/r2/buckets',secretRef:refs.r2,body:{name:'synthetic'}}),e=>e.code==='MANUAL_RECOVERY');
   const before=calls.length;await assert.rejects(api.request({method:'POST',path:'/accounts',headers:{'Idempotency-Key':'synthetic-stable-account-intent'},idempotent:true,secretRef:refs.user,body:{standalone:true,name:'synthetic'}}),e=>e.code==='PROVIDER_TIMEOUT');assert.equal(calls.length-before,3);fault=null;
  });
  await t.test('routing is not mailbox; transactional send checks DNS/entitlement and consent',async()=>{
   assert.equal(new ExternalMailboxProvider().capabilities().mailbox,false);await assert.rejects(new ExternalMailboxProvider().provision({}));
   const options={api,secretRef:refs.email,accountId:id,domain:'example.test',verifyDomain:async()=>({spf:true,dkim:true,dmarc:true,sendingEntitled:true}),consent:async()=>false};
   const message={from:'noreply@example.test',to:'owner@example.test',subject:'Synthetic test',text:'Synthetic test only',approvalId:'synthetic-approved-intent'};
   await assert.rejects(new CloudflareTransactionalEmail(options).send(message),e=>e.code==='EMAIL_SEND_APPROVAL_REQUIRED');
   await assert.rejects(new CloudflareTransactionalEmail({...options,consent:async()=>true,verifyDomain:async()=>({spf:false})}).send(message));
   const result=await new CloudflareTransactionalEmail({...options,consent:async()=>true}).send(message);assert(result.queued);assert.equal(result.mailbox,false);
  });
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('TLS checks approved domain, pinned public address and certificate; no real TLS traffic',async()=>{
 let checked=false;
 const tls=new TlsVerifier({approvedDomains:['app.example.test'],resolve:async()=>[{address:'1.1.1.1'}],probe:async input=>{assert.equal(input.host,'app.example.test');assert.equal(input.address,'1.1.1.1');checked=true;return {verified:true,expiresAt:'2099-01-01'};}});
 await tls.verify('app.example.test');assert(checked);await assert.rejects(tls.verify('foreign.example.test'));
 for(const ip of ['127.0.0.1','169.254.169.254','10.0.0.1','::ffff:127.0.0.1','fc00::1','::1'])await assert.rejects(new TlsVerifier({approvedDomains:['app.example.test'],resolve:async()=>[{address:ip}],probe:async()=>{throw Error('must not connect');}}).verify('app.example.test'));
 await assert.rejects(new TlsVerifier({approvedDomains:['app.example.test'],resolve:async()=>[{address:'1.1.1.1'}],probe:async()=>({verified:false})}).verify('app.example.test'));
});

test('SigV4 matches the AWS published example; strict XML rejects XXE and malformed responses',()=>{
 const signed=signS3({url:'https://examplebucket.s3.amazonaws.com/test.txt',method:'GET',now:new Date('2013-05-24T00:00:00Z'),region:'us-east-1',expires:86400,credentials:{accessKeyId:'AKIAIOSFODNN7EXAMPLE',secretAccessKey:'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'}});
 assert.equal(new URL(signed.url).searchParams.get('X-Amz-Signature'),'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
 assert.equal(parseS3Xml('<Root><Part>1</Part></Root>').name,'Root');
 for(const xml of ['<!DOCTYPE x SYSTEM "file:///secret"><Root/>','<Root>&xxe;</Root>','<Root><Part></Root>','<Root/><Extra/>'])assert.throws(()=>parseS3Xml(xml));
});
