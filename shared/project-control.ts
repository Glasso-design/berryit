import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {RepositoryRequest,RepositoryResult} from './project-access';
const id=z.string().uuid(),reason=z.string().trim().min(3).max(1000),cursor=z.string().datetime({offset:true}).nullable().optional();
export const taskStatuses=['todo','in_progress','blocked','review','done'] as const;
export const taskPriorities=['low','normal','high','critical'] as const;
export const taskValues=z.object({title:z.string().trim().min(2).max(200),description:z.string().max(20000),status:z.enum(taskStatuses),priority:z.enum(taskPriorities),
 visibility:z.enum(['internal','project']),assignee_id:id.nullable(),due_at:z.string().datetime({offset:true}).nullable(),
 checklist:z.array(z.object({id,text:z.string().trim().min(1).max(300),done:z.boolean()}).strict()).max(100),archived:z.boolean().optional()}).strict();
export const projectControlAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('overview'),project:id}).strict(),z.object({action:z.literal('projectOptions')}).strict(),
 z.object({action:z.literal('tasks'),project:id.nullable(),status:z.enum(taskStatuses).nullable().optional(),priority:z.enum(taskPriorities).nullable().optional(),assignee:id.nullable().optional(),after:cursor,afterId:id.nullable().optional(),archived:z.boolean().optional()}).strict(),
 z.object({action:z.literal('taskDetails'),task:id}).strict(),z.object({action:z.literal('assignees'),project:id}).strict(),
 z.object({action:z.literal('saveTask'),id:id.nullable(),project:id,values:taskValues,revision:z.number().int().positive().nullable(),reason}).strict(),
 z.object({action:z.literal('comment'),task:id,body:z.string().trim().min(1).max(10000),visibility:z.enum(['internal','project'])}).strict(),
 z.object({action:z.literal('history'),project:id,after:cursor,afterId:z.string().max(100).nullable().optional()}).strict(),
 z.object({action:z.literal('taskHistory'),task:id,after:cursor,afterId:z.string().max(100).nullable().optional()}).strict(),
 z.object({action:z.literal('evidencePage'),project:id,after:cursor,afterId:id.nullable().optional()}).strict(),
 z.object({action:z.literal('saveControl'),project:id,section:z.enum(['profile','code','business']),values:z.record(z.string(),z.unknown()),reason}).strict(),
 z.object({action:z.literal('evidence'),project:id,values:z.object({kind:z.enum(['development_pass','code_change','test','bug','fix','release','deployment','infrastructure','decision','blocker','summary']),
 title:z.string().trim().min(2).max(200),body:z.string().max(20000),stage:z.enum(['LOCAL','MOCK','COMMITTED','PUSHED','STAGING','PRODUCTION']),source_kind:z.enum(['manual','ai_summary']),
 source_reference:z.string().max(500).nullable(),version:z.string().max(200).nullable(),branch:z.string().max(200).nullable(),commit_sha:z.string().regex(/^[a-f0-9]{40,64}$/).nullable(),occurred_at:z.string().datetime({offset:true})}).strict(),reason}).strict(),
 z.object({action:z.literal('linkTask'),task:id,kind:z.enum(['support_ticket','github_issue','github_pr','evidence']),resource:id,number:z.number().int().positive().nullable().optional()}).strict(),
 z.object({action:z.literal('attachmentUrl'),id}).strict(),
 z.object({action:z.literal('acceptIssue'),link:id,revision:z.number().int().positive(),reason}).strict(),
]);
export type ProjectControlAction=z.infer<typeof projectControlAction>;
export type ProjectEvidenceValues=Extract<ProjectControlAction,{action:'evidence'}>['values'];
export type TaskValues=z.infer<typeof taskValues>;
export type ProjectTask=TaskValues&{id:string;project_id:string;organization_id:string;project_name?:string;revision:number;archived_at:string|null;created_by:string;created_at:string;updated_at:string};
export type TaskAttachment={id:string;filename:string;content_type:string;bytes:number;storage_path:string;completed_at:string|null;visibility:'internal'|'project'};
export type TaskDetails={task:ProjectTask;comments:{id:string;actor_id:string;body:string;visibility:string;created_at:string}[];
 links:{id:string;kind:string;ticket_id:string|null;evidence_id:string|null;integration_id:string|null;external_number:number|null;observed_at:string|null;checked_at:string|null;proposal:Partial<TaskValues>|null}[];attachments:TaskAttachment[]};
export type Page<T>={items:T[];hasMore:boolean};
export type ProjectActivity={id:string;actor_id:string|null;action:string;source_kind:string;occurred_at:string;reason:string;detail:Record<string,unknown>};
export type ProjectEvidence={id:string;kind:string;title:string;body:string;stage:string;source_kind:string;system_verified:boolean;version:string|null;branch:string|null;commit_sha:string|null;occurred_at:string;actor_id:string|null};
export type ProjectOverview={project:{id:string;organization_id:string;name:string;description:string;status:string;environment:string;website_url:string|null;archived_at:string|null};
 organization:{id:string;name:string;isInternal:boolean}|null;profile:{project_type:string;development_status:string;logo_path:string|null;factory_product_key:string|null}|null;
 code:{frontend:string;backend:string;database_technology:string;architecture:string;local_paths:string[]}|null;
 business:{owner_kind:string;owner_label:string|null;agreement_reference:string|null;source:string}|null;capabilities:Record<'manage'|'infrastructure'|'repositories'|'businessRead'|'businessManage'|'activityRead'|'activityWrite'|'tasksRead'|'tasksWrite'|'tasksSync',boolean>;
 services:{id:string;name:string;node_id:string|null;kind:string;environment:string;url:string|null;is_active:boolean}[];
 nodes:{id:string;name:string;hostname:string|null;provider:string|null;region:string|null;kind:string}[];checks:{service_id:string;status_key:'ok'|'degraded'|'down'|'unknown';checked_at:string;source:string;latency_ms:number|null}[];
 integrations:{id:string;provider:string;name:string;status:string;is_enabled:boolean;read_only:boolean;repository?:string|null;provider_id?:string|null}[];
 support:{id:string;reference:string;subject:string;status_key:string;priority_key:string;updated_at:string}[];supportHasMore:boolean;
 releases:ProjectEvidence[];releasesHasMore:boolean;latestVerifiedVersion:ProjectEvidence|null;lastActivity:{action:string;source_kind:string;actor_id:string|null;occurred_at:string}|null;openTasks:number;blockers:{id:string;title:string}[];
 factory:{status:string;items:{id:string;name:string;product_id:string;quota_bytes:number;execution_mode:string;status:string;provider:unknown}[];hasMore:boolean;adapter?:{productId:string;version:string;status:string}|null};
 backup:{status:string;reason:string};dataProvenance:string;externalActions:'READ_ONLY'};
export type ProjectControlClient={request:<T>(action:ProjectControlAction)=>Promise<T>;upload:(task:string,file:File,pending?:TaskAttachment)=>Promise<void>;
 repository?:(input:RepositoryRequest)=>Promise<RepositoryResult>;syncIssues?:(project:string,integration:string)=>Promise<{created:number;observed:number}>};

export async function executeProjectControlAction(actor:SupabaseClient,input:unknown):Promise<unknown>{
 const p=projectControlAction.parse(input);
 const rpc=async(name:string,args:Record<string,unknown>={})=>{const r=await actor.rpc(name,args);if(r.error)throw r.error;return r.data;};
 switch(p.action){
 case 'overview':return rpc('project_control_overview',{p_project:p.project});
 case 'projectOptions':return rpc('project_task_projects');
 case 'tasks':return rpc('list_project_tasks',{p_project:p.project,p_status:p.status??null,p_priority:p.priority??null,p_assignee:p.assignee??null,p_after:p.after??null,p_after_id:p.afterId??null,p_archived:p.archived??false});
 case 'taskDetails':return rpc('project_task_details',{p_task:p.task});
 case 'assignees':return rpc('project_task_assignees',{p_project:p.project});
 case 'saveTask':return rpc('save_project_task',{p_id:p.id,p_project:p.project,p_values:p.values,p_revision:p.revision,p_reason:p.reason});
 case 'comment':return rpc('project_task_comment',{p_task:p.task,p_body:p.body,p_visibility:p.visibility});
 case 'history':return rpc('project_activity_page',{p_project:p.project,p_after:p.after??null,p_after_id:p.afterId??null});
 case 'taskHistory':return rpc('project_task_history',{p_task:p.task,p_after:p.after??null,p_after_id:p.afterId??null});
 case 'evidencePage':return rpc('project_evidence_page',{p_project:p.project,p_after:p.after??null,p_after_id:p.afterId??null});
 case 'saveControl':return rpc('save_project_control',{p_project:p.project,p_section:p.section,p_values:p.values,p_reason:p.reason});
 case 'evidence':return rpc('record_project_evidence',{p_project:p.project,p_values:p.values,p_reason:p.reason});
 case 'linkTask':return rpc('link_project_task',{p_task:p.task,p_kind:p.kind,p_resource:p.resource,p_number:p.number??null});
 case 'acceptIssue':return rpc('accept_project_issue_proposal',{p_link:p.link,p_revision:p.revision,p_reason:p.reason});
 case 'attachmentUrl':{
  const path=await rpc('project_task_attachment_path',{p_id:p.id});const r=await actor.storage.from('project-task-attachments').createSignedUrl(path,60,{download:true});
  if(r.error||!r.data)throw r.error??new Error('Bilagan är inte tillgänglig.');return r.data.signedUrl;
 }
 }
}
export async function uploadProjectTaskFile(actor:SupabaseClient,task:string,file:File,pending?:TaskAttachment):Promise<void>{
 id.parse(task);if(file.size<1||file.size>26214400)throw Error('Filen måste vara 1 byte–25 MB.');
 if(pending){
  const read=await actor.rpc('project_task_details',{p_task:task});if(read.error)throw read.error;
  const stored=(read.data as TaskDetails|null)?.attachments.find(a=>a.id===pending.id);
  if(!stored||stored.completed_at||stored.storage_path!==pending.storage_path||stored.filename!==pending.filename||Number(stored.bytes)!==Number(pending.bytes)||stored.content_type!==pending.content_type)throw Error('Den pågående uppladdningen hör inte till denna uppgift.');
 }
 if(pending&&(pending.filename!==file.name||Number(pending.bytes)!==file.size||pending.content_type!==(file.type||'application/octet-stream')))throw Error('Välj samma fil för att återuppta.');
 const result=pending?{data:{id:pending.id,path:pending.storage_path,bucket:'project-task-attachments'},error:null}:await actor.rpc('prepare_project_task_attachment',{p_task:task,p_filename:file.name,p_type:file.type||'application/octet-stream',p_bytes:file.size});
 if(result.error)throw result.error;const entry=result.data;
 const upload=await actor.storage.from(entry.bucket).upload(entry.path,file,{contentType:file.type||'application/octet-stream',upsert:false});
 const complete=await actor.rpc('complete_project_task_attachment',{p_id:entry.id});
 if(complete.error)throw complete.error??upload.error;
}
export function createProjectControlClient(actor:SupabaseClient,extra:Pick<ProjectControlClient,'repository'|'syncIssues'>={}):ProjectControlClient{
 return {request:async<T>(action:ProjectControlAction)=>executeProjectControlAction(actor,action) as Promise<T>,upload:(task,file,pending)=>uploadProjectTaskFile(actor,task,file,pending),...extra};
}
export function createPortalProjectControlClient(extra:Pick<ProjectControlClient,'repository'|'syncIssues'>={}):ProjectControlClient{
 return {...extra,request:async<T>(action:ProjectControlAction)=>{
  const response=await fetch('/api/control/project-control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(projectControlAction.parse(action))});const data=await response.json();if(!response.ok)throw Error(data.error??'Projektbegäran nekades.');return data.data as T;
 },upload:async(task,file,pending)=>{const form=new FormData();form.set('task',task);form.set('file',file);if(pending)form.set('pending',JSON.stringify(pending));
  const response=await fetch('/api/control/project-control/attachment',{method:'POST',body:form});const result=await response.json();if(!response.ok)throw Error(result.error??'Uppladdningen nekades.');}};
}
