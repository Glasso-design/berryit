import { randomUUID } from 'node:crypto';
import { providerError } from './cloudflare-api.mjs';

/** Product server only. db is a pool logged in as the limited factory_broker
 * role; binding/secret/tenant are operator configuration, never request fields.
 * The existing product HTTP host authenticates and checks permissions first.
 */
export class QuotaBroker {
 constructor({db,binding,secret,tenantId,r2,authorize}){Object.assign(this,{db,binding,secret,tenantId,r2,authorize});}
 async subject(principal){
  if(await this.authorize(principal)!==true||principal?.tenantId!==this.tenantId||principal.kind!=='user')throw providerError('BROKER_ACCESS_DENIED');
  return principal.userId;
 }
 async call(principal,name,args){
  const subject=await this.subject(principal);
  if(!['factory_broker_reserve','factory_broker_upload'].includes(name))throw providerError('BROKER_ACCESS_DENIED');
  const all=[this.binding,this.secret,this.tenantId,subject,...args];
  return (await this.db.query(`select public.${name}(${all.map((_,i)=>'$'+(i+1)).join(',')}) result`,all)).rows[0].result;
 }
 async reserve(principal,{idempotencyKey,bytes}){
  if(!Number.isSafeInteger(bytes)||bytes<1||typeof idempotencyKey!=='string'||! /^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))throw providerError('INVALID_UPLOAD_RESERVATION');
  const reservation=await this.call(principal,'factory_broker_reserve',[idempotencyKey,bytes,8*1024*1024]);
  if(reservation.state==='PENDING'){
   const lease=randomUUID();
   const upload=await this.call(principal,'factory_broker_upload',[reservation.reservationId,'initiate',JSON.stringify({lease})]);
   if(upload.state==='COMMITTED')return {reservationId:reservation.reservationId,state:'COMMITTED'};
   // If initiate times out, leave CREATING charged. Do not initiate a second
   // hidden MPU: the existing one must be reconciled from the provider first.
   const uploadId=await this.r2.initiate(upload.key,reservation.reservationId);
   await this.call(principal,'factory_broker_upload',[reservation.reservationId,'opened',JSON.stringify({lease,uploadId})]);
  }else if(!['OPEN','COMMITTED'].includes(reservation.state))throw providerError('MANUAL_RECOVERY');
  return {reservationId:reservation.reservationId,state:reservation.state==='COMMITTED'?'COMMITTED':'OPEN',bytes:reservation.bytes,partBytes:reservation.partBytes};
 }
 async part(principal,{reservationId,number,md5}){
  if(! /^[a-f0-9-]{36}$/.test(reservationId)||!Number.isInteger(number)||number<1||number>10000||typeof md5!=='string'||! /^[A-Za-z0-9+/]{22}==$/.test(md5))throw providerError('INVALID_UPLOAD_PART');
  const part=await this.call(principal,'factory_broker_upload',[reservationId,'part',JSON.stringify({number,md5})]);
  await this.subject(principal);
  return this.r2.partUrl(part);
 }
 async complete(principal,{reservationId}){
  if(! /^[a-f0-9-]{36}$/.test(reservationId))throw providerError('INVALID_UPLOAD_RESERVATION');
  const lease=randomUUID(),u=await this.call(principal,'factory_broker_upload',[reservationId,'complete',JSON.stringify({lease})]);
  if(u.state==='COMMITTED')return {state:'COMMITTED'};
  // The previous Complete response may have been lost after commit. Verify the
  // same immutable key/metadata first; never create a replacement MPU/object.
  let existing;
  try{existing=await this.r2.head(u.key);}catch(error){if(error.code!=='S3_NOT_FOUND')throw error;}
  if(existing)return this.call(principal,'factory_broker_upload',[reservationId,'committed',JSON.stringify({lease,...existing})]);
  const actual=await this.r2.parts(u.key,u.uploadId),expected=u.parts;
  if(expected.length!==Math.ceil(Number(u.bytes)/Number(u.partBytes))||actual.length!==expected.length||actual.some((p,i)=>p.number!==expected[i].number||p.bytes!==Number(expected[i].bytes)||p.etag.replaceAll('"','')!==Buffer.from(expected[i].md5,'base64').toString('hex')))throw providerError('MULTIPART_VERIFICATION_FAILED');
  await this.subject(principal);await this.r2.complete(u.key,u.uploadId,actual);
  const head=await this.r2.head(u.key);
  return this.call(principal,'factory_broker_upload',[reservationId,'committed',JSON.stringify({lease,...head})]);
 }
}

/** Append these routes to the EXISTING QABGO Core router. Its standard user
 * authentication reloads active session/membership/permissions on each request.
 * No new auth model, browser DB connection or central Factory grant is added.
 */
export function qabgoStorageRoutes(broker,{errors,rateLimiter}){
 const route=(suffix,operation,keys)=>({method:'POST',pattern:'/v1/dispatch/storage/'+suffix,auth:{kind:'user',audiences:['dispatch'],permissions:['sites.manage']},maxBodyBytes:4096,
  handler:async ctx=>{
   const body=ctx.body;
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==keys.length||keys.some(k=>!Object.hasOwn(body,k)))throw errors.badRequest('invalid_storage_request','Ogiltig lagringsbegäran.');
   await rateLimiter.consume('factory_storage',ctx.principal.sessionId,60,60);
   try{return {headers:{'Cache-Control':'no-store'},body:await broker[operation](ctx.principal,body)};}
   catch(error){throw errors.badRequest('storage_request_denied',error.code??'Lagringsbegäran nekades.');}
  }});
 return [route('reservations','reserve',['idempotencyKey','bytes']),route('parts','part',['reservationId','number','md5']),route('complete','complete',['reservationId'])];
}

/** Complete inventory only; revision fencing rejects concurrent mutations.
 * No timed-out, unknown or partial upload is silently cancelled/released. */
export async function reconcileR2(db,r2,instanceId){
 const {rows}=await db.query('select storage_revision from factory.instances where id=$1',[instanceId]);if(!rows.length)throw providerError('UNKNOWN_INSTANCE');
 const objects=await r2.inventory(instanceId);
 await db.query('select public.factory_worker_r2_inventory($1,$2,$3::jsonb)',[instanceId,rows[0].storage_revision,JSON.stringify(objects)]);
 return {objects:objects.length,bytes:objects.reduce((n,o)=>n+o.bytes,0)};
}
