import { createHash,createHmac } from 'node:crypto';
import { cloudflareId,boundedText,providerError } from './cloudflare-api.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const mac=(key,value)=>createHmac('sha256',key).update(value).digest();
export const awsEncode=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const queryString=entries=>entries.map(([k,v])=>[awsEncode(k),awsEncode(String(v))]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]<b[1]?-1:a[1]>b[1]?1:0).map(pair=>pair.join('=')).join('&');
const signingKey=(secret,date,region)=>mac(mac(mac(mac('AWS4'+secret,date),region),'s3'),'aws4_request');

/** SigV4 query authentication. Every header returned MUST be sent unchanged.
 * UploadPart signatures bind length and Content-MD5; they grant neither PutObject
 * nor CompleteMultipartUpload, and cannot change key/upload ID/part number.
 */
export function signS3({url,method,headers={},credentials,now=new Date(),expires=120,region='auto'}){
 if(!Number.isInteger(expires)||expires<1||expires>604800||!credentials?.accessKeyId||!credentials.secretAccessKey)throw providerError('INVALID_SIGNING_INPUT');
 const target=new URL(url);if(target.searchParams.has('X-Amz-Signature')||target.username||target.password||target.hash)throw providerError('INVALID_SIGNING_INPUT');
 const date=now.toISOString().replace(/[:-]|\.\d{3}/g,''),scope=date.slice(0,8)+'/'+region+'/s3/aws4_request';
 const canonicalHeaders={host:target.host};
 for(const [name,value]of Object.entries(headers)){if(/[\r\n]/.test(String(value)))throw providerError('INVALID_SIGNING_INPUT');canonicalHeaders[name.toLowerCase()]=String(value).trim().replace(/\s+/g,' ');}
 const names=Object.keys(canonicalHeaders).sort(),signed=names.join(';');
 target.searchParams.set('X-Amz-Algorithm','AWS4-HMAC-SHA256');target.searchParams.set('X-Amz-Credential',credentials.accessKeyId+'/'+scope);
 target.searchParams.set('X-Amz-Date',date);target.searchParams.set('X-Amz-Expires',String(expires));target.searchParams.set('X-Amz-SignedHeaders',signed);
 if(credentials.sessionToken)target.searchParams.set('X-Amz-Security-Token',credentials.sessionToken);
 const request=[method,target.pathname,queryString([...target.searchParams]),names.map(k=>k+':'+canonicalHeaders[k]+'\n').join(''),signed,'UNSIGNED-PAYLOAD'].join('\n');
 const toSign=['AWS4-HMAC-SHA256',date,scope,sha(request)].join('\n');
 target.search=queryString([...target.searchParams,['X-Amz-Signature',mac(signingKey(credentials.secretAccessKey,date.slice(0,8),region),toSign).toString('hex')]]);
 return {url:target.href,headers:Object.fromEntries(Object.entries(canonicalHeaders).filter(([k])=>k!=='host')),expiresAt:new Date(now.getTime()+expires*1000).toISOString()};
}

// Small strict XML reader for the bounded S3 response subset. It rejects DTDs,
// custom entities, mixed content, mismatched tags and duplicate scalar fields.
// It never resolves entities, URLs or external documents.
export function parseS3Xml(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>1048576||/<!|&(?!(?:amp|lt|gt|quot|apos);)/.test(raw))throw providerError('BAD_S3_XML');
 const tokens=raw.replace(/^\s*<\?xml[^?]*\?>/,'').match(/<[^>]*>|[^<]+/g)??[];
 const root={name:'root',children:[],text:''},stack=[root];
 for(const token of tokens){
  if(token.startsWith('</')){if(token!==`</${stack.at(-1).name}>`||stack.length===1)throw providerError('BAD_S3_XML');stack.pop();}
  else if(token.startsWith('<')){
   const m=/^<([A-Za-z][A-Za-z0-9]*)(?: xmlns="https?:\/\/[^"<>]+")?(\/?)>$/.exec(token);if(!m||stack.length>12)throw providerError('BAD_S3_XML');
   const item={name:m[1],children:[],text:''};stack.at(-1).children.push(item);if(!m[2])stack.push(item);
  }else{stack.at(-1).text+=token;}
 }
 if(stack.length!==1||root.children.length!==1||root.text.trim())throw providerError('BAD_S3_XML');
 return root.children[0];
}
const decode=text=>text.replace(/&(amp|lt|gt|quot|apos);/g,(_,x)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[x]));
export function xmlValue(node,name,required=true){
 const values=node.children.filter(c=>c.name===name);if(values.length>1||required&&values.length!==1||values[0]?.children.length)throw providerError('BAD_S3_XML');return values[0]?decode(values[0].text):null;
}
const escapeXml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

export class R2S3Provider {
 mode='HTTP_PROVIDER';
 constructor({accountId,bucket,jurisdiction,secretStore,secretRef,transport=fetch,authorize=async()=>false,now=()=>new Date(),synthetic=false}){
  cloudflareId(accountId);if(!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket)||!['eu','us'].includes(jurisdiction))throw providerError('INVALID_R2_BINDING');
  Object.assign(this,{accountId,bucket,jurisdiction,secretStore,secretRef,transport,authorize,now,synthetic});
  this.origin=`https://${accountId}.${jurisdiction}.r2.cloudflarestorage.com`;
 }
 url(key='',query={}){
  if(key&&(!/^[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(key)||key.includes('..')))throw providerError('INVALID_OBJECT_KEY');
  const u=new URL(this.origin+'/'+this.bucket+(key?'/'+key.split('/').map(awsEncode).join('/'):''));for(const [k,v]of Object.entries(query))u.searchParams.set(k,String(v));return u.href;
 }
 async signed(method,key,query={},headers={},expires=120){
  if(expires>300)throw providerError('INVALID_SIGNING_INPUT');
  if(await this.authorize({provider:'r2',method,key,query,synthetic:this.synthetic})!==true)throw providerError('BLOCKED_PROVIDER_ACTIVATION');
  const c=await this.secretStore.get(this.secretRef);
  if(!c||c.revokedAt||c.expiresAt&&(!Number.isFinite(Date.parse(c.expiresAt))||Date.parse(c.expiresAt)<=this.now().getTime()+expires*1000)||c.notBefore&&(!Number.isFinite(Date.parse(c.notBefore))||Date.parse(c.notBefore)>this.now().getTime()))throw providerError('BLOCKED_PROVIDER_CREDENTIAL');
  return signS3({url:this.url(key,query),method,headers,credentials:c,now:this.now(),expires});
 }
 async request(method,key,query={},headers={},body=undefined){
  const signed=await this.signed(method,key,query,headers);let response;
  try{response=await this.transport(signed.url,{method,headers:signed.headers,body,redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{throw providerError(method==='GET'||method==='HEAD'?'PROVIDER_TIMEOUT':'MANUAL_RECOVERY',method==='GET'||method==='HEAD');}
  if(!response.ok){await response.body?.cancel();if([401,403].includes(response.status))throw providerError('BLOCKED_PROVIDER_PERMISSION');throw providerError(response.status===404?'S3_NOT_FOUND':method==='POST'?'MANUAL_RECOVERY':'S3_REFUSED',response.status===429);}
  return response;
 }
 async initiate(key,reservationId){
  const r=await this.request('POST',key,{uploads:''},{'x-amz-meta-factory-reservation':reservationId,'x-amz-meta-factory-instance':key.split('/')[0]});
  const xml=parseS3Xml(await boundedText(r));if(xml.name!=='InitiateMultipartUploadResult')throw providerError('MANUAL_RECOVERY');
  return xmlValue(xml,'UploadId');
 }
 async partUrl({key,uploadId,number,bytes,md5}){
  if(typeof uploadId!=='string'||uploadId.length>1024||!Number.isInteger(number)||number<1||number>10000||!Number.isSafeInteger(bytes)||bytes<1||bytes>5368709120||! /^[A-Za-z0-9+/]{22}==$/.test(md5))throw providerError('INVALID_UPLOAD_PART');
  return this.signed('PUT',key,{partNumber:number,uploadId},{'content-length':String(bytes),'content-md5':md5},120);
 }
 async parts(key,uploadId){
  const parts=[],seen=new Set();let marker='0';
  for(;;){
   const xml=parseS3Xml(await boundedText(await this.request('GET',key,{uploadId,'part-number-marker':marker})));if(xml.name!=='ListPartsResult'||xmlValue(xml,'UploadId')!==uploadId)throw providerError('BAD_S3_XML');
   for(const p of xml.children.filter(n=>n.name==='Part')){const number=Number(xmlValue(p,'PartNumber')),bytes=Number(xmlValue(p,'Size')),etag=xmlValue(p,'ETag');if(!Number.isSafeInteger(number)||number<1||number>10000||!Number.isSafeInteger(bytes)||bytes<1||seen.has(number)||!/^"?[a-f0-9]{32}"?$/.test(etag))throw providerError('BAD_S3_XML');seen.add(number);parts.push({number,bytes,etag});}
   const truncated=xmlValue(xml,'IsTruncated');if(truncated==='false')return parts.sort((a,b)=>a.number-b.number);if(truncated!=='true')throw providerError('INCOMPLETE_PROVIDER_INVENTORY');
   const next=xmlValue(xml,'NextPartNumberMarker');if(!/^\d+$/.test(next)||Number(next)<=Number(marker)||Number(next)>10000||!xml.children.some(n=>n.name==='Part'))throw providerError('INCOMPLETE_PROVIDER_INVENTORY');marker=next;
  }
 }
 async complete(key,uploadId,parts){
  const body='<CompleteMultipartUpload>'+parts.map(p=>'<Part><PartNumber>'+p.number+'</PartNumber><ETag>'+escapeXml(p.etag)+'</ETag></Part>').join('')+'</CompleteMultipartUpload>';
  const xml=parseS3Xml(await boundedText(await this.request('POST',key,{uploadId},{'content-type':'application/xml','content-md5':createHash('md5').update(body).digest('base64')},body)));
  if(xml.name!=='CompleteMultipartUploadResult'||xmlValue(xml,'Key')!==key)throw providerError('MANUAL_RECOVERY');
 }
 async head(key){
  const r=await this.request('HEAD',key);const bytes=Number(r.headers.get('content-length'));
  if(!Number.isSafeInteger(bytes)||bytes<0||!r.headers.has('content-length'))throw providerError('BAD_PROVIDER_RESPONSE');
  return {bytes,reservationId:r.headers.get('x-amz-meta-factory-reservation'),instanceId:r.headers.get('x-amz-meta-factory-instance')};
 }
 async inventory(instanceId){
  if(!/^[a-f0-9-]{36}$/.test(instanceId))throw providerError('INVALID_OBJECT_KEY');
  const objects=[],seen=new Set(),tokens=new Set();let token='';
  for(;;){
   const query={'list-type':'2',prefix:instanceId+'/','max-keys':1000};if(token)query['continuation-token']=token;
   const xml=parseS3Xml(await boundedText(await this.request('GET','',query)));if(xml.name!=='ListBucketResult')throw providerError('BAD_S3_XML');
   for(const row of xml.children.filter(n=>n.name==='Contents')){const key=xmlValue(row,'Key'),bytes=Number(xmlValue(row,'Size'));if(!key.startsWith(instanceId+'/')||seen.has(key)||!Number.isSafeInteger(bytes)||bytes<0)throw providerError('BAD_PROVIDER_RESPONSE');seen.add(key);objects.push({key,bytes});if(objects.length>100000)throw providerError('INVENTORY_REQUIRES_BATCH_REVIEW');}
   const truncated=xmlValue(xml,'IsTruncated');if(truncated==='false')return objects;if(truncated!=='true')throw providerError('INCOMPLETE_PROVIDER_INVENTORY');
   token=xmlValue(xml,'NextContinuationToken');if(!token||tokens.has(token))throw providerError('INCOMPLETE_PROVIDER_INVENTORY');tokens.add(token);
  }
 }
 // Deliberately no DeleteObject, AbortMultipartUpload, public bucket, credential
 // export or unrestricted PutObject API. Unknown partial uploads stay reserved.
}
