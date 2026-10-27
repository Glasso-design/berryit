import { factoryRequestSchema } from '../../shared/factory/schema.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { sanitizeDetail } from '../connector-engine/contract.mjs';

export { DEFAULT_STORAGE_QUOTA } from '../../shared/factory/schema.mjs';
export const JOB_STATES = Object.freeze(['DRAFT','PREFLIGHT','APPROVED','PROVISIONING','VERIFYING','READY','BLOCKED','WAITING_FOR_EXTERNAL','RETRYABLE_FAILURE','FAILED','MANUAL_RECOVERY']);
export const CHECK_STATES = Object.freeze(['NOT_STARTED','IN_PROGRESS','WAITING_FOR_USER','WAITING_FOR_PROVIDER','BLOCKED','VERIFIED','FAILED','NOT_APPLICABLE']);
export const OPERATIONS = Object.freeze(['provision','verify','retry','reconcile','safeCleanup','upgrade','suspend','backup','restore']);
export const PROVIDER_KINDS = Object.freeze(['account','database','migrations','storage','quota','runtime','domain','tls','email','identity','backup','health','isolation']);
export class FactoryError extends Error {
  constructor(code, message, retryable=false) { super(message); this.name='FactoryError'; this.code=code; this.retryable=retryable; }
}
export const requestSchema=factoryRequestSchema;

export const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
export function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function newId(){return randomUUID();}
export function safeEvidence(value) { return sanitizeDetail(value); }
export function requireOwned(resource, job, step) {
  if(!resource || typeof resource.id!=='string' || resource.jobId!==job.id || resource.instanceId!==job.instance_id || resource.step!==step)
    throw new FactoryError('RESOURCE_OWNERSHIP_MISMATCH','Resursägarskap kan inte verifieras. Ingen cleanup eller automatisk nyregistrering tillåts.');
  return resource;
}
export function orderChecklist(steps){
 const result=[],visited=new Set(),visiting=new Set();
 const byId=new Map(steps.map(s=>[s.id,s]));if(byId.size!==steps.length)throw new FactoryError('INVALID_ADAPTER','Dubblerade checklist-ID.');
 const visit=id=>{if(visited.has(id))return;if(visiting.has(id)||!byId.has(id))throw new FactoryError('INVALID_ADAPTER','Ogiltig checklistgraf.');visiting.add(id);for(const d of byId.get(id).dependsOn)visit(d);visiting.delete(id);visited.add(id);result.push(byId.get(id));};
 for(const step of steps)visit(step.id);return result;
}
export function validateAdapter(adapter) {
  if(!adapter || !/^[a-z][a-z0-9-]+$/.test(adapter.productId) || !Array.isArray(adapter.versions) || !adapter.versions.length)
    throw new FactoryError('INVALID_ADAPTER','Adaptern saknar versionsstyrd produktidentitet.');
  for(const profile of ['runtime','database','storage','domain','auth','email'])if(!adapter.profiles?.[profile])throw new FactoryError('INVALID_ADAPTER','Ofullständigt distributionskontrakt.');
  for(const op of OPERATIONS)if(typeof adapter[op]!=='function')throw new FactoryError('INVALID_ADAPTER','Adaptern saknar operationen '+op);
  const steps=adapter.checklist(); const ids=new Set(steps.map(s=>s.id));
  if(ids.size!==steps.length)throw new FactoryError('INVALID_ADAPTER','Dubblerade checklist-ID.');
  const visited=new Set(), visiting=new Set();
  const visit=id=>{if(visiting.has(id))throw new FactoryError('INVALID_ADAPTER','Cyklisk checklista.');if(visited.has(id))return;const s=steps.find(x=>x.id===id);if(!s)throw new FactoryError('INVALID_ADAPTER','Okänt stegberoende.');visiting.add(id);for(const d of s.dependsOn)visit(d);visiting.delete(id);visited.add(id);};
  for(const step of steps){if(!['AUTO','MANUAL','EXTERNAL'].includes(step.type)||typeof step.required!=='boolean')throw new FactoryError('INVALID_ADAPTER','Ogiltig checklisttyp.');visit(step.id);}
  return adapter;
}
