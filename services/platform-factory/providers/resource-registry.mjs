import { randomUUID } from 'node:crypto';
import { canonical,hash,FactoryError } from '../contract.mjs';

/** Durable intents are written BEFORE the HTTP call. Never adopt unowned
 * resources by name after a timeout. Fencing serializes the same intent; an
 * expired lease requires reconciliation, never a new account/idempotency key. */
export class ResourceRegistry {
 constructor(db,{now=()=>Date.now()}={}){this.db=db;this.now=now;}
 async assertAccountMode(job,mode){
  await this.authorize(job);
  if(mode===job.input.accountMode)return;
  const {rows}=await this.db.query('select factory.account_mode_allowed($1,$2) allowed',[job.id,mode]);
  if(!rows[0]?.allowed)throw new FactoryError('ACCOUNT_MODE_APPROVAL_REQUIRED','Byte av kontomodell kräver uttryckligt, separat MFA-godkännande.');
 }
 async authorize(job){
  const {rows}=await this.db.query('select 1 from factory.jobs where id=$1 and instance_id=$2 and lease_token=$3 and input=$4::jsonb and lease_until>now() and factory.initiator_allowed(id)',[job.id,job.instance_id,job.token,JSON.stringify(job.input)]);
  if(!rows.length)throw new FactoryError('AUTHORIZATION_REVOKED','Aktuell behörighet och worker-lease krävs.');
 }
 async recordAccount(job,accountId,mode){
  await this.authorize(job);
  const owner=mode==='MANAGED_RESOURCE_ISOLATION'?null:job.instance_id;
  const {rowCount}=await this.db.query(`insert into factory.external_accounts(account_id,mode,owner_instance) values($1,$2,$3)
   on conflict(account_id) do update set account_id=excluded.account_id
   where factory.external_accounts.mode=excluded.mode and factory.external_accounts.owner_instance is not distinct from excluded.owner_instance returning account_id`,[accountId,mode,owner]);
  if(rowCount!==1)throw new FactoryError('ACCOUNT_COLLISION','Kontot tillhör en annan instans eller kontomodell.');
 }
 async ensure(job,step,plan,perform){
  await this.authorize(job);
  const verification=plan.verification??'UNVERIFIED';
  if(!['UNVERIFIED','SYNTHETIC_HTTP','LIVE_HTTP'].includes(verification))throw new FactoryError('INVALID_VERIFICATION','Okänd providerverifiering.');
  if(verification==='LIVE_HTTP'){
   const instance=(await this.db.query('select execution_mode from factory.instances where id=$1',[job.instance_id])).rows[0];
   if(instance?.execution_mode!=='LIVE')throw new FactoryError('BLOCKED_LIVE_PROVIDER','MOCK-instans får inte skapa verkliga providerresurser.');
  }
  const digest=hash(canonical({method:plan.method,path:plan.path,body:plan.body,headers:plan.headers,mode:plan.mode,verification}));
  const token=randomUUID();
  const {rows}=await this.db.query(`insert into factory.provider_intents(job_id,instance_id,step,input_hash) values($1,$2,$3,$4)
   on conflict(job_id,step) do update set step=excluded.step returning *`,[job.id,job.instance_id,step,digest]);
  const intent=rows[0];
  if(intent.input_hash!==digest||intent.instance_id!==job.instance_id)throw new FactoryError('INTENT_CONFLICT','Tidigare resursintent matchar inte.');
  if(intent.state==='VERIFIED')return intent.result;
  const claim=await this.db.query(`update factory.provider_intents set lease_token=$2,lease_until=now()+interval '45 seconds',state='IN_FLIGHT',attempts=attempts+1
   where id=$1 and (lease_until is null or lease_until<now()) returning *`,[intent.id,token]);
  if(claim.rowCount!==1)throw new FactoryError('PROVIDER_INTENT_BUSY','Ett annat anrop arbetar med samma resurs.',true);
  try{
   await this.authorize(job);
   const result={...await perform({id:intent.id,previousAttempt:intent.attempts>0}),verification};
   if(!result?.id||!result.kind)throw new FactoryError('INVALID_PROVIDER_RESULT','Resursreferens saknas.');
   await this.authorize(job);
   // Unique external references prevent a second tenant claiming the same resource.
   const saved=await this.db.query(`update factory.provider_intents set state='VERIFIED',result=$3,external_ref=$4,lease_token=null,lease_until=null
    where id=$1 and lease_token=$2 and lease_until>now() returning id`,[intent.id,token,JSON.stringify(result),result.kind+':'+result.id]);
   if(saved.rowCount!==1)throw new FactoryError('MANUAL_RECOVERY','Provider-lease har löpt ut. Resursen måste återföras till samma intent.');
   await this.db.query("select factory.audit($1,'provider_verified',jsonb_build_object('intent_id',$2::text,'step',$3::text,'verification',$4::text))",[job.id,intent.id,step,verification]);
   return result;
  }catch(error){
   await this.db.query("update factory.provider_intents set state='AMBIGUOUS',lease_token=null,lease_until=null where id=$1 and lease_token=$2",[intent.id,token]);
   throw error;
  }
 }
}
