import { CloudflareContractClient,estimateR2 } from './cloudflare.mjs';
import { cloudflareId,providerError } from './cloudflare-api.mjs';
import { hash } from '../contract.mjs';
import {publishProviderStatus} from './status.mjs';
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

/** Concrete Cloudflare operations behind the existing provider registry. They
 * are NOT eligible for the MOCK worker. A separate signed activation/backup/
 * restore gate and server-held credentials are required by the transport. */
export class CloudflareProvider {
 mode='HTTP_PROVIDER';
 #discoveries=new WeakSet();
 constructor({api,registry,secretRefs,now=()=>Date.now()}){Object.assign(this,{api,registry,secretRefs,now});this.plans=new CloudflareContractClient({now});}
 async discover({accountId=null,zoneId=null,tenantUnitId=null,standaloneEligibility=null,managedApproval=null}){
  const cap={source:'server-provider-discovery',observedAt:this.now(),verification:this.api.synthetic?'SYNTHETIC_HTTP':'LIVE_READ_ONLY',accountModes:[],capabilities:{},missingPermissions:[],blockers:[],allowedAccountIds:[]};
  if(tenantUnitId){
   // Tenant provisioning uses the partner API's legacy explicit credentials.
   const {result}=await this.api.request({path:'/user/tenants',secretRef:this.secretRefs.tenant,auth:'tenant-key'});
   const tenants=Array.isArray(result)?result:[];
   const units=tenants.flatMap(t=>[...(t.units??[]),...(t.tenant_units??[])]);
   if(units.some(u=>(u.unit_tag??u.id)===tenantUnitId)){cap.tenantEnabled=true;cap.unitId=tenantUnitId;cap.accountModes.push('DEDICATED_MANAGED');}
   else cap.blockers.push('TENANT_UNIT_NOT_VERIFIED');
   // Finding a unit is not proof of a paid provisioning entitlement.
   cap.blockers.push('TENANT_ACCOUNT_CREATION_ENTITLEMENT_REQUIRES_OPERATOR_VERIFICATION');
  }
  if(this.secretRefs.user){
   try{
    const token=await this.api.token({secretRef:this.secretRefs.user});
    const {result:user}=await this.api.request({path:'/user',secretRef:this.secretRefs.user});
    const memberships=await this.api.list({path:'/memberships?status=accepted',secretRef:this.secretRefs.user});
    cap.userActive=Boolean(user?.id&&user.email_verified);cap.userAgeDays=Math.floor((this.now()-Date.parse(user.created_on))/86400000);cap.userOwnedToken=true;
    cap.isSuperAdministrator=memberships.some(m=>m.status==='accepted'&&m.roles?.some(r=>(typeof r==='string'?r:r.name)==='Super Administrator'));
    // Eligibility/remaining allowance cannot be inferred from the visible account count.
    const e=standaloneEligibility;
    if(e?.tokenId===token.id&&e.userId===user.id&&e.verifiedAt<=this.now()&&this.now()-e.verifiedAt<60000&&e.operatorVerified===true){cap.additionalAccountsRemaining=e.remaining;}
    if(cap.userActive&&cap.userAgeDays>=7&&cap.isSuperAdministrator&&cap.additionalAccountsRemaining>0)cap.accountModes.push('LIMITED_STANDALONE');
    else cap.blockers.push('STANDALONE_ELIGIBILITY_NOT_VERIFIED');
   }catch(error){cap.blockers.push(error.code??'USER_DISCOVERY_FAILED');}
  }
  if(accountId){
   cloudflareId(accountId);await this.api.token({secretRef:this.secretRefs.account,accountId});
   const {result:account}=await this.api.request({path:'/accounts/'+accountId,secretRef:this.secretRefs.account});
   if(account?.id!==accountId)throw providerError('ACCOUNT_ID_MISMATCH');
   cap.accountId=accountId;cap.allowedAccountIds=[accountId];
   // Provider discovery reports read capability. No read probe claims write access.
   const probes=[['r2.read','/accounts/'+accountId+'/r2/buckets',this.secretRefs.r2],['email.destinations.read','/accounts/'+accountId+'/email/routing/addresses',this.secretRefs.email]];
   if(zoneId){cloudflareId(zoneId);const {result:zone}=await this.api.request({path:'/zones/'+zoneId,secretRef:this.secretRefs.dns});if(zone?.account?.id!==accountId||zone.status!=='active')throw providerError('ZONE_ACCOUNT_MISMATCH');cap.zoneId=zoneId;cap.zoneName=zone.name;probes.push(['dns.read','/zones/'+zoneId+'/dns_records',this.secretRefs.dns]);}
   for(const [permission,path,secretRef]of probes){try{await this.api.request({path,secretRef});cap.capabilities[permission]='VERIFIED_READ';}catch(error){cap.capabilities[permission]='BLOCKED';cap.missingPermissions.push(permission);cap.blockers.push(error.code??'PROVIDER_DISCOVERY_FAILED');}}
   cap.managedResourceIsolationApproved=Boolean(managedApproval?.accountId===accountId&&managedApproval?.explicit===true);
   if(cap.managedResourceIsolationApproved)cap.accountModes.push('MANAGED_RESOURCE_ISOLATION');
  }
  for(const p of ['r2.write','dns.write','email.routing.write','email.sending'])cap.capabilities[p]='UNVERIFIED';
  cap.blockers.push('LIVE_WRITE_VERIFICATION_NOT_RUN','EXTERNAL_BACKUP_AND_RESTORE_REQUIRED','ISOLATED_HTTP_MFA_SSO_GATE_REQUIRED');
  this.#discoveries.add(cap);return freeze(cap);
 }
 #cap(cap){if(!this.#discoveries.has(cap)||this.now()-cap.observedAt>60000)throw providerError('BLOCKED_PROVIDER_DISCOVERY');}
 async account({job,mode,capabilities,managedAccountId=null,tenantEntitlement=null}){
  this.#cap(capabilities);
  await this.registry.assertAccountMode(job,mode);
  if(mode==='DEDICATED_MANAGED'&&!(tenantEntitlement?.unitId===capabilities.unitId&&tenantEntitlement.operatorVerified===true&&tenantEntitlement.verifiedAt<=this.now()&&this.now()-tenantEntitlement.verifiedAt<60000))throw providerError('BLOCKED_TENANT_ENTITLEMENT');
  const key='factory-account-'+hash(job.instance_id).slice(0,40);
  const plan=this.plans.accountPlan({mode,name:job.input.name,key,capabilities,managedAccountId,secretRef:mode==='DEDICATED_MANAGED'?this.secretRefs.tenant:this.secretRefs.user});
  plan.verification=this.api.synthetic?'SYNTHETIC_HTTP':'LIVE_HTTP';
  if(!plan.createsAccount){await this.registry.recordAccount(job,plan.accountId,mode);return {...plan,verification:'CONFIGURED_SHARED_ACCOUNT'};}
  if(mode==='DEDICATED_MANAGED')plan.body.external_metadata=JSON.stringify({factory_instance:job.instance_id,intent:key});
  return this.registry.ensure(job,'account',plan,async()=>{
   const {result}=await this.api.request({...plan,auth:mode==='DEDICATED_MANAGED'?'tenant-key':'token',idempotent:true,intent:key});
   const accountId=cloudflareId(result?.id);await this.registry.recordAccount(job,accountId,mode);return {id:accountId,kind:'account',mode};
  });
 }
 async bucket({job,accountId,capabilities}){
  this.#cap(capabilities);if(!capabilities.allowedAccountIds.includes(accountId))throw providerError('BLOCKED_ACCOUNT_SCOPE');
  const plan=this.plans.bucketPlan({accountId,instanceId:job.instance_id,region:job.input.region,ownedIntent:{instanceId:job.instance_id,verifiedNewResource:true}});
  plan.secretRef=this.secretRefs.r2;
  plan.verification=this.api.synthetic?'SYNTHETIC_HTTP':'LIVE_HTTP';
  return this.registry.ensure(job,'storage',plan,async(intent)=>{
   const path=plan.path+'/'+plan.name;
   const before=await this.api.request({path,headers:plan.headers,secretRef:plan.secretRef,allow404:true});
   if(before){
    // R2 buckets have no ownership tags. A same-name bucket after an ambiguous
    // create is NEVER adopted using its name alone.
    throw providerError(intent.previousAttempt?'MANUAL_RECOVERY':'RESOURCE_COLLISION');
   }
   if(intent.previousAttempt)throw providerError('MANUAL_RECOVERY');
   await this.api.request({...plan,intent:intent.id});
   const {result:bucket}=await this.api.request({path,headers:plan.headers,secretRef:plan.secretRef});
   if(bucket?.name!==plan.name||bucket.jurisdiction!==(job.input.region==='us'?'us':'eu'))throw providerError('R2_JURISDICTION_NOT_VERIFIED');
   return {id:accountId+'/'+plan.name,kind:'bucket',accountId,name:plan.name,jurisdiction:bucket.jurisdiction,namespace:job.instance_id+'/'};
  });
 }
 async dns({job,zoneId,target,capabilities}){
  this.#cap(capabilities);if(capabilities.zoneId!==zoneId)throw providerError('BLOCKED_ZONE_SCOPE');
  const domain=job.input.domain;if(domain===capabilities.zoneName||!domain.endsWith('.'+capabilities.zoneName))throw providerError('BLOCKED_DOMAIN_SCOPE');
  const plan=this.plans.dnsPlan({zoneId,domain,target,instanceId:job.instance_id,domainVerified:true});plan.secretRef=this.secretRefs.dns;
  plan.verification=this.api.synthetic?'SYNTHETIC_HTTP':'LIVE_HTTP';
  return this.registry.ensure(job,'domain',plan,async(intent)=>{
   const found=await this.api.list({path:'/zones/'+zoneId+'/dns_records?name='+encodeURIComponent(domain),secretRef:plan.secretRef});
   if(found.length){
    if(found.length!==1||!intent.previousAttempt||found[0].type!=='CNAME'||found[0].content!==target||found[0].comment!==plan.body.comment||!found[0].tags?.includes(plan.body.tags[0]))throw providerError('RESOURCE_COLLISION');
    return {id:cloudflareId(found[0].id),kind:'dns',name:domain,target};
   }
   const {result}=await this.api.request({...plan,intent:intent.id});return {id:cloudflareId(result.id),kind:'dns',name:domain,target};
  });
 }
 async routing({job,accountId,zoneId,address,destination,capabilities}){
  this.#cap(capabilities);if(capabilities.accountId!==accountId||capabilities.zoneId!==zoneId||typeof address!=='string'||address.split('@')[1]!==job.input.domain||!(job.input.domain===capabilities.zoneName||job.input.domain.endsWith('.'+capabilities.zoneName)))throw providerError('BLOCKED_EMAIL_SCOPE');
  const destinations=await this.api.list({path:'/accounts/'+cloudflareId(accountId)+'/email/routing/addresses',secretRef:this.secretRefs.email});
  if(!destinations.some(d=>d.email===destination&&d.verified&&Number.isFinite(Date.parse(d.verified))))throw providerError('WAITING_EMAIL_VERIFICATION');
  const plan=this.plans.emailPlan({zoneId,address,destination,destinationVerified:true,mode:'routing'});plan.secretRef=this.secretRefs.email;
  plan.verification=this.api.synthetic?'SYNTHETIC_HTTP':'LIVE_HTTP';
  plan.body.name='Factory '+job.instance_id+' '+hash(address).slice(0,16);
  return this.registry.ensure(job,'email',plan,async(intent)=>{
   const rules=await this.api.list({path:plan.path,secretRef:plan.secretRef});
   const found=rules.filter(r=>r.matchers?.some(m=>m.field==='to'&&m.value===address));
   if(found.length){const r=found[0];if(found.length!==1||!intent.previousAttempt||r.name!==plan.body.name||r.enabled!==true||JSON.stringify(r.actions)!==JSON.stringify(plan.body.actions))throw providerError('RESOURCE_COLLISION');return {id:cloudflareId(r.tag??r.id),kind:'email-routing',mailbox:false};}
   const {result}=await this.api.request({...plan,intent:intent.id});return {id:cloudflareId(result.tag??result.id),kind:'email-routing',mailbox:false};
  });
 }
 cost(input){return estimateR2(input);}
 async inspect({job,accountId,zoneId,tlsVerifier=null}){
  const db=this.registry.db;
  const allowed=await db.query('select 1 from factory.jobs where id=$1 and instance_id=$2 and factory.initiator_allowed(id)',[job.id,job.instance_id]);
  if(!allowed.rows.length)throw providerError('AUTHORIZATION_REVOKED');
  const cap=structuredClone(await this.discover({accountId,zoneId}));
  const rows=(await db.query("select step,result from factory.provider_intents where job_id=$1 and instance_id=$2 and state='VERIFIED'",[job.id,job.instance_id])).rows;
  let dns='UNVERIFIED',email='UNVERIFIED',tls='UNVERIFIED';
  const passed=this.api.synthetic?'SYNTHETIC':'VERIFIED';
  for(const row of rows){
   const r=row.result;
   if(row.step==='domain'){
    const {result}=await this.api.request({path:'/zones/'+cloudflareId(zoneId)+'/dns_records/'+cloudflareId(r.id),secretRef:this.secretRefs.dns});
    dns=result?.name===job.input.domain&&result.content===r.target&&result.type==='CNAME'&&result.comment==='ONARLY Factory instance '+job.instance_id?passed:'BLOCKED';
   }
   if(row.step==='email'){
    const {result}=await this.api.request({path:'/zones/'+cloudflareId(zoneId)+'/email/routing/rules/'+cloudflareId(r.id),secretRef:this.secretRefs.email});
    email=result?.enabled===true&&result.name?.startsWith('Factory '+job.instance_id+' ')?passed:'BLOCKED';
   }
   if(row.step==='storage'){
    const {result}=await this.api.request({path:'/accounts/'+cloudflareId(accountId)+'/r2/buckets/'+r.name,headers:{'cf-r2-jurisdiction':r.jurisdiction},secretRef:this.secretRefs.r2});
    if(result?.name!==r.name||result.jurisdiction!==r.jurisdiction)cap.blockers.push('R2_RESOURCE_OR_JURISDICTION_MISMATCH');
   }
  }
  if(tlsVerifier&&dns===passed){try{await tlsVerifier.verify(job.input.domain);tls=passed;}catch{tls='BLOCKED';cap.blockers.push('TLS_NOT_VERIFIED');}}
  const instance=(await db.query('select used_bytes from factory.instances where id=$1',[job.instance_id])).rows[0];
  await publishProviderStatus(db,job.instance_id,{capabilities:cap,accountMode:job.input.accountMode,dns,email,tls,cost:{objectBytes:Number(instance.used_bytes)}});
  return {verification:cap.verification,capabilities:cap.capabilities,blockers:cap.blockers,dns,email,tls};
 }
}
