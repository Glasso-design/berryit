import { FactoryError, newId } from './contract.mjs';

// Queryable is injected by the server/worker. It is never a client database URL.
// Separate request transactions use the existing verified JWT's claims/RLS.
export class FactoryStore {
  constructor(db) {this.db=db;}
  async scalar(name,args=[]) {
    const allowed=new Set(['factory_create','factory_catalog','factory_list','factory_operation','factory_storage_status','factory_snapshot','factory_resume','factory_manual','factory_worker_claim','factory_worker_save','factory_reserve','factory_worker_complete_upload','factory_worker_cancel_upload','factory_worker_reconcile_storage']);
    if(!allowed.has(name))throw new FactoryError('UNKNOWN_OPERATION','Okänd SQL-operation.');
    return (await this.db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args)).rows[0].result;
  }
  async claim(jobId) { const token=newId();const job=await this.scalar('factory_worker_claim',[jobId,token]);return job?{...job,token}:null; }
  async save(job,state,checklist,error=null) {
    const next=await this.scalar('factory_worker_save',[job.id,job.token,job.revision,state,JSON.stringify(checklist),error]);
    if(!next)throw new FactoryError('AUTHORIZATION_REVOKED','Aktuell behörighet/session återkallad; fler provideranrop stoppas.');
    return {...next,token:job.token};
  }
  async record(job,step,resource) {
    const result=await this.db.query(`insert into factory.resources(job_id,step,instance_id,provider_id,resource_id,evidence)
      select id,$3,instance_id,$4,$5,$6::jsonb from factory.jobs where id=$1 and lease_token=$2 and lease_until>now()
      on conflict(job_id,step) do update set evidence=excluded.evidence
      where factory.resources.resource_id=excluded.resource_id and factory.resources.instance_id=excluded.instance_id
      returning resource_id`,[job.id,job.token,step,resource.provider,resource.id,JSON.stringify(resource.evidence)]);
    if(result.rowCount!==1)throw new FactoryError('MANUAL_RECOVERY','Resurs eller worker-lease matchar inte tidigare registrering.');
  }
}
