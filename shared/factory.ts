import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { factoryRequestSchema } from './factory/schema.mjs';
export type { FactoryRequest } from './factory/schema.mjs';
const uuid=z.string().uuid();
export const factoryActionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('catalog')}).strict(),
 z.object({action:z.literal('list'),after:z.string().datetime({offset:true}).nullable().optional(),afterId:uuid.nullable().optional()}).strict(),
 z.object({action:z.literal('create'),input:factoryRequestSchema}).strict(),
 z.object({action:z.literal('details'),jobId:uuid}).strict(),
 z.object({action:z.literal('providerStatus'),instanceId:uuid}).strict(),
 z.object({action:z.literal('approveAccountMode'),jobId:uuid,mode:z.enum(['DEDICATED_MANAGED','LIMITED_STANDALONE','MANAGED_RESOURCE_ISOLATION']),reason:z.string().trim().min(15).max(500)}).strict(),
 z.object({action:z.literal('retry'),jobId:uuid}).strict(),
 z.object({action:z.literal('manual'),jobId:uuid,step:z.string().regex(/^[a-z-]{2,60}$/),note:z.string().trim().min(10).max(1000)}).strict(),
 z.object({action:z.literal('operation'),instanceId:uuid,operation:z.enum(['upgrade','suspend','backup','restore','cleanup-review']),reason:z.string().trim().min(10).max(1000)}).strict(),
]);
export type FactoryAction=z.infer<typeof factoryActionSchema>;
export type FactoryCatalog={executionMode:'MOCK';liveProvisioning:false;products:{id:string;name:string;version:string|null;status:string;liveApproved:boolean;addons:{id:string;title:string}[];provenance:Record<string,unknown>}[];projects:{id:string;organizationId:string;name:string;canCreate:boolean}[];owners:{id:string;organizationId:string|null;label:string}[]};
export type FactoryItem={id:string;instance_id:string;organization_id:string;project_id:string;name:string;product_id:string;version:string;owner_id:string;state:string;execution_mode:string;created_at:string;last_error:string|null;quota_bytes:number|string;used_bytes:number|string;reserved_bytes:number|string};
export type FactoryCheck={id:string;title:string;description:string;type:'AUTO'|'MANUAL'|'EXTERNAL';required:boolean;dependsOn:string[];status:string;verificationMethod:string;responsible:string;verifiedAt:string|null;error:string|null;evidence?:Record<string,unknown>;actionLink:string};
export type FactorySnapshot={job:{id:string;state:string;checklist:FactoryCheck[];last_error:string|null;created_at:string};instance:{id:string;name:string;product_id:string;version:string;organization_id:string;project_id:string;owner_id:string;region:string;domain:string;execution_mode:string;status:string;quota_bytes:number|string;used_bytes:number|string;reserved_bytes:number|string};resources:{step:string;id:string;provider:string;evidence:Record<string,unknown>}[];audit:{id:number;created_at:string;action:string;metadata:Record<string,unknown>}[]};
export type FactoryClient={request:<T>(action:FactoryAction)=>Promise<T>};
export type FactoryProviderStatus={observedAt:string|null;verification:'SYNTHETIC_HTTP'|'LIVE_READ_ONLY'|'LIVE_VERIFIED'|null;accountMode:string|null;approvedAccountMode:string|null;capabilities:Record<string,string>|null;missingPermissions:string[]|null;blockers:string[]|null;dns:string|null;email:string|null;tls:string|null;resources:{step:string;state:string;reference:string|null;verification:string|null}[];quota:{used_bytes:number|string;reserved_bytes:number|string;quota_bytes:number|string;warning:number;blocked:boolean};cost:{currency:string;monthlyEstimate:number;actualBillVerified:boolean;exclusiveOf:string[]}|null};

// Input/transport validation is shared. Authorization is exclusively in SQL,
// including when a caller skips this module and invokes the RPC directly.
export async function executeFactoryAction(actor:SupabaseClient,input:unknown):Promise<unknown>{
 const p=factoryActionSchema.parse(input);
 let name:string,args:Record<string,unknown>={};
 switch(p.action){
 case 'catalog':name='factory_catalog';break;
 case 'list':name='factory_list';args={p_after:p.after??null,p_after_id:p.afterId??null};break;
 case 'create':name='factory_create';args={p_input:p.input};break;
 case 'details':name='factory_snapshot';args={p_job:p.jobId};break;
 case 'providerStatus':name='factory_provider_status';args={p_instance:p.instanceId};break;
 case 'approveAccountMode':name='factory_approve_account_mode';args={p_job:p.jobId,p_mode:p.mode,p_reason:p.reason};break;
 case 'retry':name='factory_resume';args={p_job:p.jobId};break;
 case 'manual':name='factory_manual';args={p_job:p.jobId,p_step:p.step,p_note:p.note};break;
 case 'operation':name='factory_operation';args={p_instance:p.instanceId,p_operation:p.operation,p_reason:p.reason};break;
 }
 const result=await actor.rpc(name,args);if(result.error)throw new Error(result.error.message??'Factory-anropet nekades.');
 if((p.action==='details'||p.action==='catalog')&&!result.data)throw new Error('Factory nekade åtkomst till resursen.');return result.data;
}
export function createFactoryClient(actor:SupabaseClient):FactoryClient{return {request:<T>(action:FactoryAction)=>executeFactoryAction(actor,action) as Promise<T>};}
export function createFactoryHttpClient(fetcher:typeof fetch=fetch,url='/api/control/factory'):FactoryClient{return {request:async<T>(action:FactoryAction)=>{
 const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(factoryActionSchema.parse(action))});const result=await response.json();if(!response.ok)throw new Error(result.error??'Factory kunde inte nås.');return result.data as T;
}};}
