import { FactoryError } from '../contract.mjs';
import { operationHash } from './activation-gate.mjs';

export const cloudflareId=value=>{
 if(typeof value!=='string'||! /^[a-f0-9]{32}$/.test(value))throw new FactoryError('INVALID_PROVIDER_ID','Ogiltig Cloudflare-referens.');
 return value;
};
export function providerError(code,retryable=false){return new FactoryError(code,'Provideroperationen kunde inte verifieras. Inga råsvar eller credentials publiceras.',retryable);}
function validCredential(c,now){
 return Boolean(c&&!c.revokedAt&&(!c.expiresAt||Number.isFinite(Date.parse(c.expiresAt))&&Date.parse(c.expiresAt)>now)&&(!c.notBefore||Number.isFinite(Date.parse(c.notBefore))&&Date.parse(c.notBefore)<=now));
}
export async function boundedText(response,limit=1048576){
 if(Number(response.headers.get('content-length'))>limit)throw providerError('BAD_PROVIDER_RESPONSE');
 if(!response.body)return '';
 const reader=response.body.getReader();let bytes=0;const chunks=[];
 try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit)throw providerError('BAD_PROVIDER_RESPONSE');chunks.push(Buffer.from(value));}}
 finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks).toString('utf8');
}

/** Server-only API transport. Importing/constructing it does not make a request.
 * Live reads AND writes require an operator-supplied authorization callback.
 * No environment variables, caller URLs, raw provider errors or automatic writes.
 */
export class CloudflareApiClient {
 mode='HTTP_PROVIDER';
 constructor({secretStore,transport=fetch,authorize=async()=>false,synthetic=false,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now(),timeoutMs=10000}){
  Object.assign(this,{secretStore,transport,authorize,synthetic,sleep,now,timeoutMs});
 }
 async request({method='GET',path,body,headers={},secretRef,auth='token',idempotent=false,allow404=false,intent=null}){
  if(!['GET','POST'].includes(method)||typeof path!=='string'||!/^\/[a-z]/.test(path)||/[\r\n\\#]/.test(path)||path.includes('..')||new URL(path,'https://api.cloudflare.com').origin!=='https://api.cloudflare.com')throw providerError('INVALID_PROVIDER_REQUEST');
  if(Object.keys(headers).some(k=>!['cf-r2-jurisdiction','Idempotency-Key'].includes(k)))throw providerError('INVALID_PROVIDER_HEADERS');
  const operation={provider:'cloudflare',method,path,intent,inputHash:operationHash({body,headers}),synthetic:this.synthetic};
  if(await this.authorize(operation)!==true)throw providerError('BLOCKED_PROVIDER_ACTIVATION');
  const c=await this.secretStore.get(secretRef);
  if(!validCredential(c,this.now()))throw providerError('BLOCKED_PROVIDER_CREDENTIAL');
  let authentication;
  if(auth==='tenant-key'){
   if(c.kind!=='tenant-global-key'||!c.email||!c.key)throw providerError('BLOCKED_TENANT_AUTH');
   authentication={'X-Auth-Email':c.email,'X-Auth-Key':c.key};
  }else{
   if(c.kind!=='api-token'||!c.token)throw providerError('BLOCKED_PROVIDER_CREDENTIAL');
   authentication={Authorization:'Bearer '+c.token};
  }
  const safe=method==='GET'||idempotent;
  // Retry only GET or an endpoint with a documented stable idempotency key.
  if(idempotent&&(path!=='/accounts'||!headers['Idempotency-Key']))throw providerError('INVALID_IDEMPOTENCY');
  for(let attempt=0;attempt<3;attempt++){
   // Approval, current scope and revocation must still hold for every retry.
   if(await this.authorize(operation)!==true)throw providerError('BLOCKED_PROVIDER_ACTIVATION');
   const current=await this.secretStore.get(secretRef);
   if(!validCredential(current,this.now())||current.token!==c.token||current.key!==c.key)throw providerError('BLOCKED_PROVIDER_CREDENTIAL');
   let response;
   try{response=await this.transport('https://api.cloudflare.com/client/v4'+path,{method,headers:{...authentication,'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(this.timeoutMs)});}
   catch{if(safe&&attempt<2){await this.sleep(100*2**attempt);continue;}throw providerError(safe?'PROVIDER_TIMEOUT':'MANUAL_RECOVERY',safe);}
   if([401,403].includes(response.status)){await response.body?.cancel();throw providerError('BLOCKED_PROVIDER_PERMISSION');}
   if(response.status===404&&allow404){await response.body?.cancel();return null;}
   if(response.status===429||response.status>=500){
    const retry=Math.min(5000,Math.max(100,Number(response.headers.get('retry-after')??0)*1000)||100*2**attempt);await response.body?.cancel();
    if(safe&&attempt<2){await this.sleep(retry);continue;}
    throw providerError(safe?(response.status===429?'PROVIDER_RATE_LIMIT':'PROVIDER_UNAVAILABLE'):'MANUAL_RECOVERY',safe);
   }
   let value;try{value=JSON.parse(await boundedText(response));}catch(error){if(error instanceof FactoryError)throw error;throw providerError(method==='POST'?'MANUAL_RECOVERY':'BAD_PROVIDER_RESPONSE');}
   if(!response.ok||value.success!==true)throw providerError('PROVIDER_REFUSED');
   return {result:value.result,page:value.result_info??null};
  }
 }
 async list(options){
  const result=[],seen=new Set();let page=1;
  for(;;){
   const separator=options.path.includes('?')?'&':'?';
   const response=await this.request({...options,path:options.path+separator+'page='+page+'&per_page=50'});
   if(!Array.isArray(response.result))throw providerError('INCOMPLETE_PROVIDER_INVENTORY');
   result.push(...response.result);
   const info=response.page;
   if(info?.total_pages!=null){if(!Number.isSafeInteger(info.total_pages)||info.total_pages<0||info.page!==page)throw providerError('INCOMPLETE_PROVIDER_INVENTORY');if(page>=info.total_pages)break;}
   else if(response.result.length<50)break;
   const signature=JSON.stringify(response.result.map(r=>r.id??r.name));if(seen.has(signature)||response.result.length===0)throw providerError('INCOMPLETE_PROVIDER_INVENTORY');seen.add(signature);page++;
  }
  return result;
 }
 async token({secretRef,accountId=null}){
  const base=accountId?'/accounts/'+cloudflareId(accountId)+'/tokens':'/user/tokens';
  const {result}=await this.request({path:base+'/verify',secretRef});
  if(result?.status!=='active'||result.expires_on&&(!Number.isFinite(Date.parse(result.expires_on))||Date.parse(result.expires_on)<=this.now())||result.not_before&&(!Number.isFinite(Date.parse(result.not_before))||Date.parse(result.not_before)>this.now()))throw providerError('BLOCKED_PROVIDER_CREDENTIAL');
  return {id:cloudflareId(result.id),expiresAt:result.expires_on??null,base};
 }
}
