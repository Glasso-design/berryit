import {CloudflareApiClient,cloudflareId} from '../providers/cloudflare-api.mjs';

export const requiredReadCapabilities=Object.freeze(['account.read','token.verify','r2.buckets.read','zone.read','dns.read','email.routing.read','email.destinations.read']);
const denied=error=>({status:'BLOCKED',code:/^[A-Z0-9_]+$/.test(error?.code??'')?error.code:'SANITIZED_PROVIDER_FAILURE'});

/** Uses the existing concrete adapter. This wrapper has NO mutation path,
 * including when a supplied transport/plan attempts one. It never returns
 * credentials, raw provider errors, account names or recipient addresses.
 */
export async function cloudflareReadonlyPreflight({secretStore,tokenRef=null,tenantRef=null,accountId=null,tokenOwner='user',transport=fetch,synthetic=false}){
 const output={verification:synthetic?'SYNTHETIC_HTTP':'REAL_READ_ONLY',status:'BLOCKED_CREDENTIALS',provisioningMode:'MOCK',realProvisioningApproved:false,writeCapabilities:'UNVERIFIED',apiRequests:0,accounts:[],tenant:{status:'NOT_CONFIGURED'},missingCapabilities:[...requiredReadCapabilities],accountModes:{DEDICATED_MANAGED:'ENTITLEMENT_UNVERIFIED',LIMITED_STANDALONE:'ELIGIBILITY_UNVERIFIED',MANAGED_RESOURCE_ISOLATION:'EXPLICIT_APPROVAL_REQUIRED'}};
 if(!['user','account'].includes(tokenOwner)){output.status='BLOCKED_CREDENTIAL_CONFIGURATION';output.verification='NOT_RUN';return output;}
 const counted=async(url,options)=>{
  if(options.method!=='GET'||new URL(url).origin!=='https://api.cloudflare.com')throw Object.assign(Error('Mutation refused'),{code:'READ_ONLY_METHOD_REQUIRED'});
  output.apiRequests++;return transport(url,{...options,method:'GET',redirect:'error'});
 };
 const api=new CloudflareApiClient({secretStore,transport:counted,synthetic,authorize:async op=>op.method==='GET',sleep:async()=>{}});
 const probe=async options=>{try{return {status:'PASS',response:await api.request(options)};}catch(error){return denied(error);}};
 if(tenantRef){
  const credential=await secretStore.get(tenantRef);
  if(credential?.kind==='tenant-global-key'){
   const result=await probe({path:'/user/tenants',secretRef:tenantRef,auth:'tenant-key'});
   output.tenant=result.status==='PASS'?{status:'REAL_READ_ONLY_PASS',unitsListed:true,accountCreationEntitlement:'UNVERIFIED'}:result;
   if(synthetic&&output.tenant.status==='REAL_READ_ONLY_PASS')output.tenant.status='SYNTHETIC_HTTP_PASS';
  }else output.tenant={status:'BLOCKED_CREDENTIALS'};
 }
 const credential=tokenRef?await secretStore.get(tokenRef):null;
 if(!credential?.token||credential.kind!=='api-token'){
  if(output.apiRequests){output.status=synthetic?'SYNTHETIC_HTTP_PARTIAL':'REAL_READ_ONLY_PARTIAL';}
  else output.verification='NOT_RUN';
  return output;
 }
 let token;
 try{token=await api.token({secretRef:tokenRef,accountId:tokenOwner==='account'?cloudflareId(accountId):null});output.token={status:'PASS',expiresAt:token.expiresAt};}
 catch(error){output.token=denied(error);output.status='BLOCKED_TOKEN';return output;}
 const metadata=await probe({path:token.base+'/'+token.id,secretRef:tokenRef});
 output.permissionMetadata={status:metadata.status,permissions:[]};
 if(metadata.status==='PASS'){
  output.permissionMetadata.permissions=[...new Set((metadata.response.result?.policies??[]).filter(p=>p.effect==='allow').flatMap(p=>p.permission_groups??[]).map(p=>p.name).filter(n=>typeof n==='string'&&/^[A-Za-z0-9 .:()/&_-]{1,120}$/.test(n)))].sort();
 }else output.permissionMetadata.code=metadata.code;
 let accountIds=[];
 if(accountId){accountIds=[cloudflareId(accountId)];}
 else{try{accountIds=(await api.list({path:'/accounts',secretRef:tokenRef})).map(a=>cloudflareId(a.id));}catch(error){output.accountDiscovery=denied(error);}}
 for(const id of accountIds){
  const account={id,capabilities:{'token.verify':'PASS'}};
  const details=await probe({path:'/accounts/'+id,secretRef:tokenRef});account.capabilities['account.read']=details.status==='PASS'&&details.response.result?.id!==id?'BLOCKED_ACCOUNT_MISMATCH':details.status;
  const r2=await probe({path:'/accounts/'+id+'/r2/buckets',secretRef:tokenRef});account.capabilities['r2.buckets.read']=r2.status;
  if(r2.status==='PASS'){
   const result=r2.response.result;
   if(!Array.isArray(result)&&!Array.isArray(result?.buckets))account.capabilities['r2.buckets.read']='BLOCKED_UNRECOGNIZED_RESPONSE';
   else account.bucketCountOnObservedPage=(Array.isArray(result)?result:result.buckets).length;
  }
  const addresses=await probe({path:'/accounts/'+id+'/email/routing/addresses',secretRef:tokenRef});account.capabilities['email.destinations.read']=addresses.status;
  account.zones=[];
  try{
   const zones=await api.list({path:'/zones?account.id='+id,secretRef:tokenRef});account.capabilities['zone.read']='PASS';
   for(const zone of zones){
    if(zone.account?.id!==id)throw Object.assign(Error('Zone scope'),{code:'ZONE_ACCOUNT_MISMATCH'});
    const zoneId=cloudflareId(zone.id),dns=await probe({path:'/zones/'+zoneId+'/dns_records?per_page=1',secretRef:tokenRef}),email=await probe({path:'/zones/'+zoneId+'/email/routing',secretRef:tokenRef});
    account.zones.push({id:zoneId,dns:dns.status,emailRouting:email.status,emailRoutingEnabled:email.status==='PASS'?email.response.result?.enabled===true:null});
   }
   account.capabilities['dns.read']=account.zones.length&&account.zones.every(z=>z.dns==='PASS')?'PASS':'BLOCKED_NO_VERIFIED_ZONE';
   account.capabilities['email.routing.read']=account.zones.length&&account.zones.every(z=>z.emailRouting==='PASS')?'PASS':'BLOCKED_NO_VERIFIED_ROUTING';
  }catch(error){account.zoneDiscovery=denied(error);account.capabilities['zone.read']='BLOCKED';}
  output.accounts.push(account);
 }
 output.missingCapabilities=requiredReadCapabilities.filter(key=>!output.accounts.length||output.accounts.some(a=>a.capabilities[key]!=='PASS'));
 output.status=output.missingCapabilities.length?'REAL_READ_ONLY_PARTIAL':'REAL_READ_ONLY_PASS';
 if(synthetic)output.status=output.status.replace('REAL_READ_ONLY','SYNTHETIC_HTTP');
 // Read success does not prove write rights, tenant provisioning entitlement,
 // a standalone quota, or permission to fall back to shared resources.
 output.writeCapabilities='UNVERIFIED';return output;
}
