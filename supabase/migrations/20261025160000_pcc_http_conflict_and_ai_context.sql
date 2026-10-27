-- Forward-only PCC R1 repair. Do not edit any previously applied migration.
-- `40001` is reserved for genuine transaction serialization failures. A stale
-- optimistic-concurrency revision is an application conflict, so PostgREST
-- must receive the non-retryable PT409 status instead.
begin;

create or replace function public.save_project_task(p_id uuid,p_project uuid,p_values jsonb,p_revision bigint,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare p public.support_projects; t public.project_tasks; previous jsonb; item jsonb; person uuid;
begin
 select * into p from public.support_projects where id=p_project and archived_at is null;
 if not found or not public.session_is_live() or not public.can_view_project(p.id) or not public.has_resource_permission('tasks.write',p.organization_id,p.id)
 or not public.has_resource_permission('tasks.read',p.organization_id,p.id) then raise exception 'Task administration denied' using errcode='42501'; end if;
 if jsonb_typeof(p_values) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in
 ('title','description','status','priority','visibility','assignee_id','due_at','checklist','archived')) then raise exception 'Invalid task fields' using errcode='22023'; end if;
 if exists(select 1 from jsonb_each(p_values) e where e.key not in ('checklist','archived') and jsonb_typeof(e.value) not in ('string','null'))
 or (p_values?'archived' and jsonb_typeof(p_values->'archived')<>'boolean') then raise exception 'Invalid task value types' using errcode='22023'; end if;
 if p_id is not null then
  select * into t from public.project_tasks where id=p_id and project_id=p.id for update;
  if not found or not public.can_write_project_task(t.id) then raise exception 'Task denied' using errcode='42501'; end if;
  if t.revision is distinct from p_revision then
   raise sqlstate 'PT409' using message='Task changed; reload before editing',detail='The submitted task revision is stale',hint='Reload the task and retry with its current revision';
  end if;
  previous:=to_jsonb(t);
 else
  t.id:=gen_random_uuid();t.project_id:=p.id;t.organization_id:=p.organization_id;t.created_by:=auth.uid();t.created_at:=now();
  t.title:='';t.description:='';t.status:='todo';t.priority:='normal';t.visibility:='internal';t.checklist:='[]';t.revision:=0;
 end if;
 t:=jsonb_populate_record(t,p_values-'archived');
 if t.visibility='internal' and not public.has_resource_permission('tasks.internal',p.organization_id,p.id) then raise exception 'Internal work denied' using errcode='42501'; end if;
 perform berryit_private.project_text(t.title,200);perform berryit_private.project_text(t.description,20000);
 if jsonb_typeof(t.checklist) is distinct from 'array' or jsonb_array_length(t.checklist)>100 then raise exception 'Invalid checklist' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(t.checklist) loop
  if jsonb_typeof(item)<>'object' or not(item ?& array['id','text','done']) or (select count(*) from jsonb_object_keys(item))<>3
   or jsonb_typeof(item->'text')<>'string' or jsonb_typeof(item->'done')<>'boolean' or jsonb_typeof(item->'id')<>'string'
   or (item->>'id') !~ '^[a-f0-9-]{36}$' or length(btrim(item->>'text')) not between 1 and 300 then raise exception 'Invalid checklist item' using errcode='22023'; end if;
  perform berryit_private.project_text(item->>'text',300);
 end loop;
 if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(t.checklist)x) then raise exception 'Duplicate checklist ID' using errcode='22023'; end if;
 person:=t.assignee_id;
 if person is not null and (not berryit_private.project_user_permission(person,'projects.read',p.id)
 or not berryit_private.project_user_permission(person,'tasks.read',p.id)
 or (t.visibility='internal' and not berryit_private.project_user_permission(person,'tasks.internal',p.id))) then
 raise exception 'Assignee is outside active project scope' using errcode='42501'; end if;
 t.archived_at:=case when p_values?'archived' then case when (p_values->>'archived')::boolean then coalesce(t.archived_at,now()) else null end else t.archived_at end;
 t.updated_at:=clock_timestamp();t.revision:=t.revision+1;
 insert into public.project_tasks select t.* on conflict(id) do update set title=excluded.title,description=excluded.description,status=excluded.status,
 priority=excluded.priority,visibility=excluded.visibility,assignee_id=excluded.assignee_id,due_at=excluded.due_at,checklist=excluded.checklist,
 archived_at=excluded.archived_at,revision=excluded.revision,updated_at=excluded.updated_at;
 perform berryit_private.project_event(p.id,t.id,case when p_id is null then 'task.created' when t.archived_at is not null then 'task.archived' when t.status='done' then 'task.done' else 'task.updated' end,
 'task','system',case when t.visibility='internal' or previous->>'visibility'='internal' then 'internal' else 'project' end,p_reason,jsonb_build_object('before',previous,'after',to_jsonb(t)));
 return t.id;
end $$;

create or replace function public.project_control_ai_context(p_project uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p public.support_projects; facts jsonb; part jsonb; missing jsonb; repositories jsonb; infrastructure jsonb;
begin
 select * into p from public.support_projects where id=p_project;
 if not found or not public.session_is_live() or not public.can_view_project(p.id) then raise exception 'AI project scope denied' using errcode='42501'; end if;
 facts:='[]';
 missing:=jsonb_build_array('Project Control Center contains registered data, not a live server investigation. Business/contract records and local filesystem paths are excluded.');
 select coalesce(jsonb_agg(jsonb_build_object('id','task:'||x.id,'kind','task','at',x.updated_at,'text','Registered task: '||x.title||' | status='||x.status||' | priority='||x.priority||' | deadline='||coalesce(x.due_at::text,'unknown')||' | assignee='||coalesce(x.assignee_id::text,'unassigned'),
 'origin','project_tasks/server_scope','stale',false) order by x.updated_at desc,x.id desc),'[]') into part from(select id,title,status,priority,updated_at,due_at,assignee_id from public.project_tasks where project_id=p.id and archived_at is null and status<>'done' order by updated_at desc,id desc limit 10)x;
 facts:=facts||part;
 select coalesce(jsonb_agg(jsonb_build_object('id','evidence:'||x.id,'kind',x.kind,'at',x.occurred_at,
 'text',case when x.system_verified then 'Connector observation: ' else 'Unverified manually registered statement: ' end||x.title||' | stage='||x.stage||' | version='||coalesce(x.version,'unknown')||' | branch='||coalesce(x.branch,'unknown')||' | commit='||coalesce(x.commit_sha,'unknown')||' | '||left(x.body,2000),
 'origin','project_evidence/'||x.source_kind,'stale',x.occurred_at<now()-interval '7 days') order by x.occurred_at desc,x.id desc),'[]') into part from(select * from public.project_evidence
 where project_id=p.id and source_kind<>'ai_summary' order by occurred_at desc,id desc limit 10)x;
 facts:=facts||part;
 select coalesce(jsonb_agg(jsonb_build_object('id','activity:'||x.id,'kind','activity','at',x.occurred_at,'text','Verified project event: '||x.action||' | '||x.reason,
 'origin','project_activity/'||x.source_kind,'stale',false) order by x.occurred_at desc,x.id desc),'[]') into part from(select id,action,reason,occurred_at,source_kind from public.project_activity
 where project_id=p.id and category not in ('business','code') and source_kind in ('system','connector') and occurred_at>=now()-interval '7 days' order by occurred_at desc,id desc limit 20)x;
 facts:=facts||part;
 if public.has_resource_permission('repositories.read',p.organization_id,p.id) then
  repositories:=public.project_repository_catalog(p.id);
  select coalesce(jsonb_agg(jsonb_build_object('id','repository:'||(x->>'id'),'kind','repository','at',null,
   'text','Registered read-only repository: '||coalesce(x->>'repository',x->>'name','unknown')||' | provider='||coalesce(x->>'provider','unknown')||' | status='||coalesce(x->>'status','unknown')||' | enabled='||coalesce(x->>'is_enabled','false'),
   'origin','project_repository_catalog/server_scope','stale',coalesce(x->>'status','')<>'connected')),'[]') into part from jsonb_array_elements(repositories) x;
  facts:=facts||part;
 else
  missing:=missing||jsonb_build_array('Repository metadata is not available to the current project scope.');
 end if;
 if public.has_resource_permission('infrastructure.read',p.organization_id,p.id) then
  infrastructure:=public.project_infrastructure_context(p.id);
  select coalesce(jsonb_agg(jsonb_build_object('id','service:'||(x->>'id'),'kind','infrastructure','at',c.checked_at,
   'text','Registered service: '||coalesce(x->>'name','unknown')||' | kind='||coalesce(x->>'kind','unknown')||' | environment='||coalesce(x->>'environment','unknown')||' | active='||coalesce(x->>'is_active','false')||' | recorded_status='||coalesce(c.status_key,'unknown'),
   'origin','project_infrastructure_context/server_scope','stale',c.checked_at is null or c.checked_at<now()-interval '7 days')),'[]') into part
   from jsonb_array_elements(infrastructure->'services') x left join lateral(select q->>'service_id' service_id,q->>'status_key' status_key,(q->>'checked_at')::timestamptz checked_at from jsonb_array_elements(infrastructure->'checks') q where q->>'service_id'=x->>'id' limit 1)c on true;
  facts:=facts||part;
 else
  missing:=missing||jsonb_build_array('Infrastructure status is not available to the current project scope.');
 end if;
 missing:=missing||jsonb_build_array('Context is bounded to 10 open tasks, 10 evidence rows, 20 verified events and scope-authorized repository/infrastructure metadata. It is not a complete export. AI summaries are not treated as verified sources.');
 return jsonb_build_object('scope',jsonb_build_object('project_id',p.id,'organization_id',p.organization_id,'project_name',p.name),'facts',facts,'missingInformation',missing);
end $$;

revoke all on function public.save_project_task(uuid,uuid,jsonb,bigint,text),public.project_control_ai_context(uuid) from public,anon,service_role;
grant execute on function public.save_project_task(uuid,uuid,jsonb,bigint,text),public.project_control_ai_context(uuid) to authenticated;
commit;
