import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

const uuid=z.string().uuid();
const nullableId=uuid.nullable();
const reason=z.string().trim().min(3).max(1000);
export const accessActionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('catalog')}),
 z.object({action:z.literal('directory'),org:nullableId}),
 z.object({action:z.literal('details'),project:uuid}),
 z.object({action:z.literal('impact'),role:z.string().max(64)}),
 z.object({action:z.literal('project'),id:nullableId,org:uuid,values:z.record(z.string(),z.unknown()),reason,revision:z.number().int().positive().nullable()}),
 z.object({action:z.literal('role'),key:z.string().max(64).nullable(),label:z.string().min(2).max(120),description:z.string().max(2000),permissions:z.array(z.string().max(100)),org:nullableId,active:z.boolean(),reason,revision:z.number().int().positive().nullable(),impact:z.string().nullable()}),
 z.object({action:z.literal('grant'),user:uuid,role:z.string().max(64),org:nullableId,project:nullableId,expires:z.string().datetime().nullable(),reason,external:z.boolean(),company:z.string().max(200).nullable(),commissioner:nullableId}),
 z.object({action:z.literal('revoke'),id:uuid,reason}),
 z.object({action:z.literal('link'),project:uuid,kind:z.enum(['service','integration','ticket']),resource:uuid,reason}),
 z.object({action:z.literal('service'),project:uuid,name:z.string().min(2).max(120),node:nullableId,kind:z.enum(['web','api','database','container','job','static','desktop']),environment:z.enum(['development','staging','production']),url:z.string().max(500).nullable(),reason}),
 z.object({action:z.literal('unlink'),id:uuid,reason}),
 z.object({action:z.literal('userActive'),user:uuid,active:z.boolean(),reason}),
 z.object({action:z.literal('review'),project:uuid,body:z.string().trim().min(1).max(20000),reason}),
 z.object({action:z.literal('registerProjects'),org:uuid,names:z.array(z.string().trim().min(2).max(120)).min(1).max(30),reason}).strict(),
]);
export type AccessAction=z.infer<typeof accessActionSchema>;
export type ProjectRecord={id:string;organization_id:string;name:string;description:string;status:string;environment:string;website_url:string|null;repository_url:string|null;contact_id:string|null;archived_at:string|null;source:string;revision:number};
export type RoleRecord={key:string;label:string;description:string;rank:number;is_system:boolean;organization_id:string|null;is_active:boolean;revision:number};
export type GrantRecord={id:string;grantee_id:string;role_key:string;organization_id:string|null;project_id:string|null;expires_at:string|null;revoked_at:string|null};
export type AccessCatalog={
 authority:{permissions:string[];roles:string[];isStaff:boolean;isSuperAdmin:boolean;requiresMfa:boolean};
 organizations:{id:string;name:string;is_internal:boolean}[];
 projects:ProjectRecord[];roles:RoleRecord[];permissions:{key:string;description:string;requires_mfa:boolean}[];
 rolePermissions:{role_key:string;permission_key:string}[];grants:GrantRecord[];
 services:{id:string;name:string;organization_id:string;project_id:string;node_id:string|null}[];
 nodes:{id:string;name:string;organization_id:string}[];
 integrations:{id:string;display_name:string;organization_id:string;project_id:string|null;scope_kind:string;status:string}[];
 identities:{id:string;project_id:string;provider:string;external_id:string}[];
 tickets:{id:string;reference:string;subject:string;organization_id:string|null;project_id:string|null}[];
 statusChecks:{service_id:string;status_key:'ok'|'degraded'|'down'|'unknown';checked_at:string;source:string}[];
 audit:{id:number;actor_id:string|null;action:string;target_id:string;reason:string|null;created_at:string}[];
};
export type RepositoryRequest={project:string;integration?:string;kind:'branches'|'commits'|'pulls'|'files'|'issues'|'releases'|'runs'|'deployments';path?:string;ref?:string;page?:number};
export type RepositoryResult={repository:string;kind:RepositoryRequest['kind'];entries:Record<string,unknown>[];page:number;mayHaveMore:boolean;readOnly:true};
export type AccessClient={request:<T>(input:AccessAction)=>Promise<T>;repository?:(input:RepositoryRequest)=>Promise<RepositoryResult>};

// The operation allowlist is shared transport validation, never authorization.
// All reads run under caller RLS; every write calls a protected database function.
export async function executeAccessAction(actor:SupabaseClient,input:unknown):Promise<unknown>{
 const p=accessActionSchema.parse(input);
 const writes=new Set(['save_support_project','save_support_role','grant_support_role','revoke_support_role','link_project_resource','unlink_project_identity','set_support_user_active','create_project_service','save_repository_review']);
 const rpc=async(name:string,args:Record<string,unknown>={})=>{
  const wrapped=writes.has(name);
  const r=await actor.rpc(wrapped?'perform_access_request':name,wrapped?{p_operation:name,p_args:args}:args);
  if(r.error)throw r.error;
  if(wrapped){if(r.data?.ok!==true)throw Object.assign(new Error(r.data?.error??'Backend nekade åtgärden.'),{code:r.data?.code});return r.data.data;}
  return r.data;
 };
 switch(p.action){
 case 'catalog':{
  const tables={organizations:'id,name,is_internal',support_projects:'id,organization_id,name,description,status,environment,website_url,repository_url,contact_id,archived_at,source,revision',support_roles:'key,label,description,rank,is_system,organization_id,is_active,revision',support_permissions:'key,description,requires_mfa',support_role_permissions:'role_key,permission_key',support_role_grants:'id,grantee_id,role_key,organization_id,project_id,expires_at,revoked_at',infra_services:'id,name,organization_id,project_id,node_id',infra_nodes:'id,name,organization_id',connector_integrations:'id,display_name,organization_id,project_id,scope_kind,status',project_external_identities:'id,project_id,provider,external_id',tickets:'id,reference,subject,organization_id,project_id',support_admin_audit:'id,actor_id,action,target_id,reason,created_at'};
  const keys=['organizations','projects','roles','permissions','rolePermissions','grants','services','nodes','integrations','identities','tickets','audit'];
  const rows=await Promise.all(Object.entries(tables).map(async([table,columns])=>{
   // No silent page cap. PostgREST may impose a lower page size: stop only on an empty page.
   const all:unknown[]=[];const seen=new Set<string>();let offset=0;
   for(;;){const order=table==='support_role_permissions'?'role_key':table==='support_roles'||table==='support_permissions'?'key':'id';
    let query=actor.from(table).select(columns).order(order);
    if(table==='support_role_permissions')query=query.order('permission_key');
    const result=await query.range(offset,offset+499);if(result.error)throw result.error;
    if(!result.data?.length)break;
    for(const row of result.data){const record=row as unknown as Record<string,unknown>;
      const identity=table==='support_role_permissions'?JSON.stringify([record.role_key,record.permission_key]):String(record.id??record.key);
      if(seen.has(identity))throw new Error('Ofullständig registerhämtning: sidan upprepades eller ändrades. Läs om och försök igen.');
      seen.add(identity);
    }
    all.push(...result.data);offset+=result.data.length;
   }return all;
  }));
  const [authority,statusChecks]=await Promise.all([rpc('support_access_context'),rpc('project_registry_status')]);
  return {...Object.fromEntries(keys.map((k,n)=>[k,rows[n]])),authority,statusChecks};
 }
 case 'directory':return rpc('access_administration_directory',{p_org:p.org});
 case 'details':return rpc('project_access_details',{p_project:p.project});
 case 'impact':return rpc('support_role_impact',{p_role:p.role});
 case 'project':return rpc('save_support_project',{p_id:p.id,p_organization_id:p.org,p_values:p.values,p_reason:p.reason,p_revision:p.revision});
 case 'role':return rpc('save_support_role',{p_key:p.key,p_label:p.label,p_description:p.description,p_permissions:p.permissions,p_org:p.org,p_active:p.active,p_reason:p.reason,p_revision:p.revision,p_impact:p.impact});
 case 'grant':return rpc('grant_support_role',{p_user:p.user,p_role:p.role,p_org:p.org,p_project:p.project,p_expires:p.expires,p_reason:p.reason,p_external:p.external,p_company:p.company,p_commissioner:p.commissioner});
 case 'revoke':return rpc('revoke_support_role',{p_id:p.id,p_reason:p.reason});
 case 'link':return rpc('link_project_resource',{p_project:p.project,p_kind:p.kind,p_resource:p.resource,p_reason:p.reason});
 case 'service':return rpc('create_project_service',{p_project:p.project,p_name:p.name,p_node:p.node,p_kind:p.kind,p_environment:p.environment,p_url:p.url,p_reason:p.reason});
 case 'unlink':return rpc('unlink_project_identity',{p_id:p.id,p_reason:p.reason});
 case 'userActive':return rpc('set_support_user_active',{p_user:p.user,p_active:p.active,p_reason:p.reason});
 case 'review':return rpc('save_repository_review',{p_project:p.project,p_body:p.body,p_reason:p.reason});
 case 'registerProjects':return rpc('register_project_names',{p_org:p.org,p_names:p.names,p_reason:p.reason});
 }
}
export function createAccessClient(actor:SupabaseClient,repository?:AccessClient['repository']):AccessClient{return {request:async<T>(input:AccessAction)=>executeAccessAction(actor,input) as Promise<T>,repository};}
export function createPortalAccessClient():AccessClient{return {repository:async input=>{
 const response=await fetch('/api/control/repository',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const result=await response.json();if(!response.ok)throw new Error(result.error??'Repositoryåtkomst nekades.');return result.data;
},request:async<T>(input:AccessAction)=>{
 const response=await fetch('/api/control/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 const result=await response.json();if(!response.ok)throw new Error(result.error??'Begäran nekades.');return result.data as T;
}};}
