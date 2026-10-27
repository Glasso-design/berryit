import { FactoryError, hash } from '../contract.mjs';

const id=value=>{if(!/^[a-f0-9]{32}$/.test(value))throw new FactoryError('INVALID_PROVIDER_ID','Ogiltig providerreferens.');return value;};
function fresh(cap,now) {
 if(cap?.source!=='server-provider-discovery'||!Number.isFinite(cap.observedAt)||now-cap.observedAt>60000||cap.observedAt>now)
  throw new FactoryError('BLOCKED_PROVIDER_DISCOVERY','Aktuell serververifierad providerbehörighet saknas.');
}
/** Reviewed HTTP contracts, exercised only against injected mock transports.
 * No global fetch fallback and no live activation switch in this local V1. */
export class CloudflareContractClient {
  mode='HTTP_CONTRACT';
  constructor({transport,secretStore,transportMode='disabled',now=()=>Date.now()}) {Object.assign(this,{transport,secretStore,transportMode,now});}
  async send(plan) {
   if(this.transportMode!=='mock'||typeof this.transport!=='function')throw new FactoryError('BLOCKED_LIVE_PROVIDER','Verklig Cloudflare-trafik är inte aktiverad eller godkänd.');
   if(!plan.path.startsWith('/')||plan.path.includes('..')||!['GET','POST'].includes(plan.method))throw new FactoryError('INVALID_PROVIDER_REQUEST','Otillåten provideroperation.');
   const credentials=await this.secretStore.get(plan.secretRef);
   if(!credentials?.token)throw new FactoryError('MISSING_PROVIDER_CREDENTIAL','Servercredential saknas.');
   let response;
   try { response=await this.transport('https://api.cloudflare.com/client/v4'+plan.path,{method:plan.method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+credentials.token,...plan.headers},body:plan.body?JSON.stringify(plan.body):undefined}); }
   catch {throw new FactoryError(plan.retrySafe?'PROVIDER_TIMEOUT':'MANUAL_RECOVERY','Providerresultatet är okänt; återanvänd samma intent och granska ägarskap före nytt försök.',Boolean(plan.retrySafe));}
   if(response.status===429)throw new FactoryError('PROVIDER_RATE_LIMIT','Provider rate limit; inga nya identiteter eller konton skapas som kringgång.',true);
   if([401,403].includes(response.status))throw new FactoryError('BLOCKED_PROVIDER_PERMISSION','Providerbehörighet saknas.');
   const length=Number(response.headers.get('content-length')??0);if(length>1000000)throw new FactoryError('BAD_PROVIDER_RESPONSE','För stort providersvar.');
   const raw=await response.text();if(Buffer.byteLength(raw)>1000000)throw new FactoryError('BAD_PROVIDER_RESPONSE','För stort providersvar.');
   let value;try{value=JSON.parse(raw);}catch{throw new FactoryError('BAD_PROVIDER_RESPONSE','Providersvaret kan inte verifieras.');}
   if(!response.ok||value.success!==true)throw new FactoryError('PROVIDER_REFUSED','Providern nekade operationen; råfel/credentials publiceras inte.');
   return value.result;
  }
  accountPlan({mode,name,key,capabilities,managedAccountId,secretRef='factory/cloudflare-account'}) {
   fresh(capabilities,this.now());
   if(!/^[A-Za-z0-9_-]{16,128}$/.test(key)||typeof name!=='string'||name.length<2||name.length>100)throw new FactoryError('INVALID_PROVIDER_REQUEST','Ogiltigt konto-intent (kontonamn högst 100 tecken).');
   if(mode==='MANAGED_RESOURCE_ISOLATION') {
    if(!capabilities.managedResourceIsolationApproved||!capabilities.allowedAccountIds?.includes(managedAccountId))throw new FactoryError('BLOCKED_CLOUDFLARE_ACCOUNT','Godkänt hanterat konto saknas.');
    return {mode,accountId:id(managedAccountId),createsAccount:false,dedicatedAccount:false};
   }
   const body={name,type:'standard'};
   if(mode==='DEDICATED_MANAGED') {
    if(!capabilities.tenantEnabled||!capabilities.unitId)throw new FactoryError('BLOCKED_CLOUDFLARE_ACCOUNT','Partner-/Tenant API-behörighet eller tenant unit saknas.');
    if(typeof capabilities.unitId!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(capabilities.unitId))throw new FactoryError('INVALID_TENANT_UNIT','Ogiltig Tenant unit.');
    body.unit={id:capabilities.unitId};
   } else if(mode==='LIMITED_STANDALONE') {
    if(!capabilities.userActive||capabilities.userAgeDays<7||!capabilities.isSuperAdministrator||!capabilities.userOwnedToken||!Number.isInteger(capabilities.additionalAccountsRemaining)||capabilities.additionalAccountsRemaining<1)
     throw new FactoryError('BLOCKED_CLOUDFLARE_ACCOUNT','Standalone-behörighet och återstående kontogräns är inte verifierade.');
    body.standalone=true;
   } else throw new FactoryError('INVALID_ACCOUNT_MODE','Okänd kontomodell.');
   return {mode,method:'POST',path:'/accounts',headers:{'Idempotency-Key':key},body,secretRef,retrySafe:true,createsAccount:true,dedicatedAccount:true};
  }
  bucketPlan({accountId,instanceId,region,ownedIntent}) {
   if(ownedIntent?.instanceId!==instanceId||!ownedIntent?.verifiedNewResource)throw new FactoryError('MANUAL_RECOVERY','Nytt resursintent/ägarskap kan inte verifieras.');
   if(!['eu','eea','us'].includes(region))throw new FactoryError('BLOCKED_DATA_RESIDENCY','Ingen godkänd R2-jurisdiktion.');
   const name='onarly-'+hash(instanceId).slice(0,40);
   return {method:'POST',path:`/accounts/${id(accountId)}/r2/buckets`,headers:{'cf-r2-jurisdiction':region==='us'?'us':'eu'},body:{name,storageClass:'Standard'},secretRef:'factory/cloudflare-r2',retrySafe:false,name};
  }
  dnsPlan({zoneId,domain,target,instanceId,domainVerified}) {
   if(!domainVerified||!/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(domain)||!/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(target))throw new FactoryError('WAITING_DOMAIN_OWNERSHIP','Godkänt domänägarskap eller runtimemål saknas.');
   return {method:'POST',path:`/zones/${id(zoneId)}/dns_records`,headers:{},body:{type:'CNAME',name:domain,content:target,ttl:1,proxied:true,comment:'ONARLY Factory instance '+instanceId,tags:['factory:'+hash(instanceId).slice(0,32)]},secretRef:'factory/cloudflare-dns',retrySafe:false};
  }
  emailPlan({zoneId,address,destination,destinationVerified,mode}) {
   if(mode!=='routing')throw new FactoryError('BLOCKED_EMAIL_PROVIDER','Mailbox och transaktionsmejl kräver separat godkänd leverantör.');
   if(!destinationVerified||![address,destination].every(s=>typeof s==='string'&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)))throw new FactoryError('WAITING_EMAIL_VERIFICATION','Mottagare måste verifieras innan routing.');
   return {method:'POST',path:`/zones/${id(zoneId)}/email/routing/rules`,headers:{},body:{enabled:true,name:'ONARLY Factory '+address,matchers:[{type:'literal',field:'to',value:address}],actions:[{type:'forward',value:[destination]}]},secretRef:'factory/cloudflare-email',retrySafe:false};
  }
}

export function estimateR2({objectBytes,classA=0,classB=0}) {
 if(![objectBytes,classA,classB].every(x=>Number.isFinite(x)&&x>=0))throw new FactoryError('INVALID_COST_INPUT','Ogiltigt kostnadsunderlag.');
 return {currency:'USD',monthlyEstimate:objectBytes/1e9*0.015+classA/1e6*4.5+classB/1e6*0.36,sharedFreeTierDeducted:false,exclusiveOf:['database','runtime','backup','logs','tax','other providers'],uncertainty:'Granska aktuell prislista, avrundning och faktiskt delad användning före kostnadsgodkännande.'};
}
