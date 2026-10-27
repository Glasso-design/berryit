-- Forward-only Project Control Center. No product deployment or external action.
begin;
insert into public.support_permissions(key,description,requires_mfa) values
 ('tasks.read','Read assigned project tasks',false),('tasks.write','Manage assigned project tasks',false),
 ('tasks.internal','Read internal project work',false),('tasks.sync','Request read-only GitHub issue import',true),
 ('projects.activity.read','Read scoped development history',false),('projects.activity.write','Record manual development evidence',true),
 ('projects.business.read','Read registered ownership/contract references',true),('projects.business.manage','Manage registered ownership/contract references',true)
 on conflict do nothing;
insert into public.support_role_permissions(role_key,permission_key)
 select r.key,p.key from public.support_roles r cross join public.support_permissions p
 where (r.key in ('BERRYIT_SUPPORT_SUPER_ADMIN','BERRYIT_SUPPORT_ADMIN') and p.key in
 ('tasks.read','tasks.write','tasks.internal','tasks.sync','projects.activity.read','projects.activity.write','projects.business.read','projects.business.manage'))
 or (r.key='BERRYIT_DEVELOPER' and p.key in ('tasks.read','tasks.write','tasks.internal','projects.activity.read'))
 on conflict do nothing;

create table public.project_control_profiles(
 project_id uuid primary key,organization_id uuid not null,
 project_type text not null default 'unknown' check(project_type in ('unknown','saas','web','mobile','desktop','game')),
 development_status text not null default 'unverified' check(development_status in ('unverified','planning','development','testing','release_review','maintenance','paused')),
 logo_path text check(logo_path is null or (length(logo_path)<=500 and logo_path ~ '^/assets/[A-Za-z0-9_./-]+$' and logo_path not like '%..%')),
 factory_product_key text check(factory_product_key is null or factory_product_key ~ '^[a-z][a-z0-9-]{1,60}$'),
 revision bigint not null default 1,updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id),
 foreign key(project_id,organization_id) references public.support_projects(id,organization_id) on delete restrict
);
create table public.project_code_records(
 project_id uuid primary key,organization_id uuid not null,
 frontend text not null default '',backend text not null default '',database_technology text not null default '',architecture text not null default '',
 local_paths jsonb not null default '[]' check(jsonb_typeof(local_paths)='array' and jsonb_array_length(local_paths)<=20),
 updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id),
 foreign key(project_id,organization_id) references public.support_projects(id,organization_id) on delete restrict
);
create table public.project_business_records(
 project_id uuid primary key,organization_id uuid not null,
 owner_kind text not null default 'unknown' check(owner_kind in ('unknown','mg_media','external')),
 owner_label text,agreement_reference text,source text not null default 'manual' check(source='manual'),
 updated_at timestamptz not null default now(),updated_by uuid references public.profiles(id),
 foreign key(project_id,organization_id) references public.support_projects(id,organization_id) on delete restrict
);
create table public.project_tasks(
 id uuid primary key default gen_random_uuid(),project_id uuid not null,organization_id uuid not null,
 title text not null check(length(btrim(title)) between 2 and 200),description text not null default '' check(length(description)<=20000),
 status text not null default 'todo' check(status in ('todo','in_progress','blocked','review','done')),
 priority text not null default 'normal' check(priority in ('low','normal','high','critical')),
 visibility text not null default 'internal' check(visibility in ('internal','project')),
 assignee_id uuid references public.profiles(id),due_at timestamptz,checklist jsonb not null default '[]',
 archived_at timestamptz,revision bigint not null default 1,created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(id,project_id,organization_id),
 foreign key(project_id,organization_id) references public.support_projects(id,organization_id) on delete restrict,
 check(jsonb_typeof(checklist)='array' and jsonb_array_length(checklist)<=100)
);
create index project_tasks_page on public.project_tasks(updated_at desc,id desc);
create index project_tasks_scope on public.project_tasks(project_id,organization_id,status);
create table public.project_task_comments(
 id uuid primary key default gen_random_uuid(),task_id uuid not null,project_id uuid not null,organization_id uuid not null,
 actor_id uuid not null references public.profiles(id),body text not null check(length(btrim(body)) between 1 and 10000),
 visibility text not null default 'internal' check(visibility in ('internal','project')),created_at timestamptz not null default now(),
 unique(id,task_id,project_id,organization_id),
 foreign key(task_id,project_id,organization_id) references public.project_tasks(id,project_id,organization_id) on delete restrict
);
create table public.project_evidence(
 id uuid primary key default gen_random_uuid(),project_id uuid not null,organization_id uuid not null,
 kind text not null check(kind in ('development_pass','code_change','test','bug','fix','release','deployment','infrastructure','decision','blocker','summary')),
 title text not null check(length(btrim(title)) between 2 and 200),body text not null default '' check(length(body)<=20000),
 stage text not null check(stage in ('LOCAL','MOCK','COMMITTED','PUSHED','STAGING','PRODUCTION')),
 source_kind text not null check(source_kind in ('manual','connector','ai_summary')),source_reference text,
 version text,branch text,commit_sha text check(commit_sha is null or commit_sha ~ '^[a-f0-9]{40,64}$'),
 system_verified boolean not null default false,
 actor_id uuid references public.profiles(id),occurred_at timestamptz not null,recorded_at timestamptz not null default now(),
 unique(id,project_id,organization_id),
 foreign key(project_id,organization_id) references public.support_projects(id,organization_id) on delete restrict,
 check(not system_verified or source_kind='connector')
);
alter table public.tickets add constraint tickets_project_control_identity unique(id,project_id,organization_id);
alter table public.connector_integrations add constraint integrations_project_control_identity unique(id,project_id,organization_id);
create table public.project_task_links(
 id uuid primary key default gen_random_uuid(),task_id uuid not null,project_id uuid not null,organization_id uuid not null,
 kind text not null check(kind in ('support_ticket','github_issue','github_pr','evidence')),
 ticket_id uuid,evidence_id uuid,integration_id uuid,external_number bigint,external_id text,
 observed_at timestamptz,checked_at timestamptz,proposal jsonb,created_at timestamptz not null default now(),
 foreign key(task_id,project_id,organization_id) references public.project_tasks(id,project_id,organization_id) on delete restrict,
 foreign key(ticket_id,project_id,organization_id) references public.tickets(id,project_id,organization_id) on delete restrict,
 foreign key(evidence_id,project_id,organization_id) references public.project_evidence(id,project_id,organization_id) on delete restrict,
 foreign key(integration_id,project_id,organization_id) references public.connector_integrations(id,project_id,organization_id) on delete restrict,
 check((kind='support_ticket' and ticket_id is not null and evidence_id is null and integration_id is null and external_number is null)
 or (kind='evidence' and evidence_id is not null and ticket_id is null and integration_id is null and external_number is null)
 or (kind in ('github_issue','github_pr') and integration_id is not null and external_number>0 and ticket_id is null and evidence_id is null)),
 unique(integration_id,external_number,kind),unique(task_id,ticket_id),unique(task_id,evidence_id)
);
create table public.project_task_attachments(
 id uuid primary key default gen_random_uuid(),task_id uuid not null,project_id uuid not null,organization_id uuid not null,
 uploaded_by uuid not null references public.profiles(id),filename text not null check(length(filename) between 1 and 255),
 content_type text not null,bytes bigint not null check(bytes between 1 and 26214400),storage_path text not null unique,
 visibility text not null default 'internal' check(visibility in ('internal','project')),
 completed_at timestamptz,created_at timestamptz not null default now(),
 foreign key(task_id,project_id,organization_id) references public.project_tasks(id,project_id,organization_id) on delete restrict
);
create table public.project_activity(
 id bigint generated always as identity primary key,project_id uuid not null,organization_id uuid not null,task_id uuid,
 actor_id uuid references public.profiles(id),action text not null,category text not null check(category in ('task','project','code','business','evidence')),
 source_kind text not null check(source_kind in ('system','manual','connector','ai_summary')),
 visibility text not null check(visibility in ('internal','project')),reason text not null,detail jsonb not null default '{}',
 occurred_at timestamptz not null default clock_timestamp(),
 foreign key(project_id,organization_id) references public.support_projects(id,organization_id) on delete restrict,
 foreign key(task_id,project_id,organization_id) references public.project_tasks(id,project_id,organization_id) on delete restrict
);
create index project_activity_page on public.project_activity(project_id,occurred_at desc,id desc);
create index project_comments_task on public.project_task_comments(task_id,created_at,id);
create index project_attachments_task on public.project_task_attachments(task_id,created_at,id);
create index project_links_task on public.project_task_links(task_id);
create index project_evidence_page on public.project_evidence(project_id,occurred_at desc,id desc);

create function berryit_private.project_user_permission(p_user uuid,p_permission text,p_project uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.support_projects x join public.support_role_grants g on g.grantee_id=p_user
 join public.profiles u on u.id=g.grantee_id and u.is_active and not u.login_activation_pending
 join public.support_roles r on r.key=g.role_key and r.is_active
 join public.support_role_permissions rp on rp.role_key=r.key and rp.permission_key=p_permission
 where x.id=p_project and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())
 and (g.scope='global' or (g.organization_id=x.organization_id and (g.project_id is null or g.project_id=x.id)))
 and (r.organization_id is null or r.organization_id=x.organization_id));
$$;
create function berryit_private.project_text(p_text text,p_max integer) returns text
language plpgsql immutable set search_path='' as $$
begin
 if p_text is null or length(p_text)>p_max or p_text ~* '(eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.|-----BEGIN|ghp_[A-Za-z0-9]{20,}|sb_secret_|sk_live_|://[^/@[:space:]]+:[^/@[:space:]]+@)'
 then raise exception 'Texten är för lång eller kan innehålla en hemlighet' using errcode='22023'; end if;
 return p_text;
end $$;
create function public.can_read_project_task(p_task uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.session_is_live() and exists(select 1 from public.project_tasks t where t.id=p_task and public.can_view_project(t.project_id)
 and public.has_resource_permission('tasks.read',t.organization_id,t.project_id)
 and (t.visibility='project' or public.has_resource_permission('tasks.internal',t.organization_id,t.project_id)));
$$;
create function public.can_write_project_task(p_task uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.project_tasks t join public.support_projects p on p.id=t.project_id and p.organization_id=t.organization_id
 where t.id=p_task and p.archived_at is null and public.can_read_project_task(t.id)
 and public.has_resource_permission('tasks.write',t.organization_id,t.project_id));
$$;
create function berryit_private.project_event(p_project uuid,p_task uuid,p_action text,p_category text,p_source text,p_visibility text,p_reason text,p_detail jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare org uuid;
begin
 select organization_id into strict org from public.support_projects where id=p_project;
 perform berryit_private.project_text(p_reason,1000);
 insert into public.project_activity(project_id,organization_id,task_id,actor_id,action,category,source_kind,visibility,reason,detail)
 values(p_project,org,p_task,auth.uid(),p_action,p_category,p_source,p_visibility,p_reason,p_detail);
 perform berryit_private.access_audit(p_action,'project',p_project::text,org,p_reason,jsonb_build_object('task_id',p_task,'category',p_category));
end $$;
create function berryit_private.project_append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Append-only history' using errcode='42501';end $$;
create trigger project_activity_append_only before update or delete on public.project_activity for each row execute function berryit_private.project_append_only();
create trigger project_comments_append_only before update or delete on public.project_task_comments for each row execute function berryit_private.project_append_only();
create trigger project_evidence_append_only before update or delete on public.project_evidence for each row execute function berryit_private.project_append_only();

-- No direct client writes, including for project administrators.
alter table public.project_control_profiles enable row level security;
alter table public.project_code_records enable row level security;
alter table public.project_business_records enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_task_comments enable row level security;
alter table public.project_task_links enable row level security;
alter table public.project_task_attachments enable row level security;
alter table public.project_activity enable row level security;
alter table public.project_evidence enable row level security;
create policy project_control_read on public.project_control_profiles for select to authenticated using(public.session_is_live() and public.can_view_project(project_id));
create policy project_code_read on public.project_code_records for select to authenticated using(public.session_is_live() and public.can_view_project(project_id) and public.has_resource_permission('repositories.read',organization_id,project_id));
create policy project_business_read on public.project_business_records for select to authenticated using(public.session_is_live() and public.can_view_project(project_id) and public.has_resource_permission('projects.business.read',organization_id,project_id));
create policy project_tasks_read on public.project_tasks for select to authenticated using(public.can_read_project_task(id));
create policy project_comments_read on public.project_task_comments for select to authenticated using(public.can_read_project_task(task_id) and (visibility='project' or public.has_resource_permission('tasks.internal',organization_id,project_id)));
create policy project_task_links_read on public.project_task_links for select to authenticated using(public.can_read_project_task(task_id)
 and (ticket_id is null or public.can_view_ticket(ticket_id)) and (evidence_id is null or public.has_resource_permission('projects.activity.read',organization_id,project_id)) and (integration_id is null or public.has_resource_permission('repositories.read',organization_id,project_id)));
create policy project_task_attachments_read on public.project_task_attachments for select to authenticated using(public.can_read_project_task(task_id) and (visibility='project' or public.has_resource_permission('tasks.internal',organization_id,project_id)));
create policy project_activity_read on public.project_activity for select to authenticated using(public.session_is_live() and public.can_view_project(project_id)
 and public.has_resource_permission('projects.activity.read',organization_id,project_id)
 and (task_id is null or public.can_read_project_task(task_id))
 and (visibility='project' or public.has_resource_permission('tasks.internal',organization_id,project_id))
 and (category<>'business' or public.has_resource_permission('projects.business.read',organization_id,project_id))
 and (category<>'code' or public.has_resource_permission('repositories.read',organization_id,project_id)));
create policy project_evidence_read on public.project_evidence for select to authenticated using(public.session_is_live() and public.can_view_project(project_id) and public.has_resource_permission('projects.activity.read',organization_id,project_id));
revoke all on public.project_control_profiles,public.project_code_records,public.project_business_records,public.project_tasks,
 public.project_task_comments,public.project_task_links,public.project_task_attachments,public.project_activity,public.project_evidence from public,anon,authenticated,service_role;
grant select on public.project_control_profiles,public.project_code_records,public.project_business_records,public.project_tasks,
 public.project_task_comments,public.project_task_links,public.project_task_attachments,public.project_activity,public.project_evidence to authenticated;
-- Helpers in the private schema are never client endpoints.
revoke all on function berryit_private.project_user_permission(uuid,text,uuid),berryit_private.project_text(text,integer),
 berryit_private.project_event(uuid,uuid,text,text,text,text,text,jsonb),berryit_private.project_append_only() from public,anon,authenticated;
revoke all on function public.can_read_project_task(uuid),public.can_write_project_task(uuid) from public,anon;
grant execute on function public.can_read_project_task(uuid),public.can_write_project_task(uuid) to authenticated;

create function public.save_project_task(p_id uuid,p_project uuid,p_values jsonb,p_revision bigint,p_reason text) returns uuid
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
  if t.revision is distinct from p_revision then raise exception 'Task changed; reload before editing' using errcode='40001'; end if;
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

create function public.project_task_comment(p_task uuid,p_body text,p_visibility text) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.project_tasks; result uuid;
begin
 select * into t from public.project_tasks where id=p_task;
 if not public.can_write_project_task(p_task) or (p_visibility='internal' and not public.has_resource_permission('tasks.internal',t.organization_id,t.project_id)) then raise exception 'Comment denied' using errcode='42501'; end if;
 perform berryit_private.project_text(p_body,10000);
 insert into public.project_task_comments(task_id,project_id,organization_id,actor_id,body,visibility)
 values(t.id,t.project_id,t.organization_id,auth.uid(),p_body,p_visibility) returning id into result;
 perform berryit_private.project_event(t.project_id,t.id,'task.comment','task','system',case when t.visibility='internal' then 'internal' else p_visibility end,'Task comment',jsonb_build_object('comment_id',result));
 return result;
end $$;

create function public.project_task_details(p_task uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 select jsonb_build_object('task',to_jsonb(t),'comments',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at,c.id) from public.project_task_comments c where c.task_id=t.id),'[]'),
 'links',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.project_task_links l where l.task_id=t.id),'[]'),
 'attachments',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.project_task_attachments a where a.task_id=t.id),'[]'))
 into result from public.project_tasks t where t.id=p_task;
 if result is null then raise exception 'Task unavailable or denied' using errcode='42501';end if;
 return result;
end
$$;
create function public.list_project_tasks(p_project uuid default null,p_status text default null,p_priority text default null,p_assignee uuid default null,
 p_after timestamptz default null,p_after_id uuid default null,p_archived boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
 with page as materialized(select t.*,p.name project_name from public.project_tasks t join public.support_projects p on p.id=t.project_id and p.organization_id=t.organization_id
 where (p_project is null or t.project_id=p_project) and (p_status is null or t.status=p_status) and (p_priority is null or t.priority=p_priority)
 and (p_assignee is null or t.assignee_id=p_assignee) and (p_archived or t.archived_at is null)
 and (p_after is null or (t.updated_at,t.id)<(p_after,p_after_id)) order by t.updated_at desc,t.id desc limit 101)
 select jsonb_build_object('items',coalesce((select jsonb_agg(x) from(select * from page order by updated_at desc,id desc limit 100)x),'[]'),'hasMore',(select count(*)>100 from page));
$$;
create function public.project_task_assignees(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 select organization_id into org from public.support_projects where id=p_project;
 if not public.session_is_live() or not public.can_view_project(p_project) or not public.has_resource_permission('tasks.write',org,p_project) then raise exception 'Assignee directory denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'label',coalesce(p.full_name,'Registered user')) order by p.id) from public.profiles p
 where berryit_private.project_user_permission(p.id,'projects.read',p_project) and berryit_private.project_user_permission(p.id,'tasks.read',p_project)),'[]');
end $$;

create function public.save_project_control(p_project uuid,p_section text,p_values jsonb,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare org uuid; old_value jsonb; new_value jsonb; profile public.project_control_profiles; code public.project_code_records; business public.project_business_records; category text;
begin
 select organization_id into org from public.support_projects where id=p_project and archived_at is null;
 if not found or not public.session_is_live() or not public.can_view_project(p_project) or not public.has_resource_permission('projects.manage',org,p_project) then raise exception 'Project control denied' using errcode='42501'; end if;
 if jsonb_typeof(p_values) is distinct from 'object' then raise exception 'Object required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('project-control:'||p_project::text,0));
 if p_section='profile' then
  if exists(select 1 from jsonb_object_keys(p_values) k where k not in ('project_type','development_status','logo_path','factory_product_key')) then raise exception 'Unknown profile fields' using errcode='22023'; end if;
  select * into profile from public.project_control_profiles where project_id=p_project;
  old_value:=to_jsonb(profile);
  if profile.project_id is null then profile.project_id:=p_project;profile.organization_id:=org;profile.project_type:='unknown';profile.development_status:='unverified';profile.revision:=0;end if;
  profile:=jsonb_populate_record(profile,p_values);profile.revision:=profile.revision+1;profile.updated_at:=now();profile.updated_by:=auth.uid();
  insert into public.project_control_profiles select profile.* on conflict(project_id) do update set project_type=excluded.project_type,development_status=excluded.development_status,
   logo_path=excluded.logo_path,factory_product_key=excluded.factory_product_key,revision=excluded.revision,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  category:='project';new_value:=to_jsonb(profile);
 elsif p_section='code' then
  if not public.has_resource_permission('repositories.read',org,p_project) then raise exception 'Code metadata denied' using errcode='42501'; end if;
  if exists(select 1 from jsonb_object_keys(p_values) k where k not in ('frontend','backend','database_technology','architecture','local_paths')) then raise exception 'Unknown code fields' using errcode='22023'; end if;
  select * into code from public.project_code_records where project_id=p_project;old_value:=to_jsonb(code);
  if code.project_id is null then code.project_id:=p_project;code.organization_id:=org;code.frontend:='';code.backend:='';code.database_technology:='';code.architecture:='';code.local_paths:='[]';end if;
  code:=jsonb_populate_record(code,p_values);
  perform berryit_private.project_text(code.frontend,200);perform berryit_private.project_text(code.backend,200);perform berryit_private.project_text(code.database_technology,200);perform berryit_private.project_text(code.architecture,10000);
  if jsonb_typeof(code.local_paths) is distinct from 'array' or jsonb_array_length(code.local_paths)>20 or exists(select 1 from jsonb_array_elements(code.local_paths)x where jsonb_typeof(x)<>'string') then raise exception 'Invalid local paths' using errcode='22023'; end if;
  perform berryit_private.project_text(code.local_paths::text,10000);
  code.updated_at:=now();code.updated_by:=auth.uid();
  insert into public.project_code_records select code.* on conflict(project_id) do update set frontend=excluded.frontend,backend=excluded.backend,database_technology=excluded.database_technology,
   architecture=excluded.architecture,local_paths=excluded.local_paths,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  category:='code';new_value:=to_jsonb(code);
 elsif p_section='business' then
  if not public.has_resource_permission('projects.business.manage',org,p_project) then raise exception 'Business administration denied' using errcode='42501'; end if;
  if exists(select 1 from jsonb_object_keys(p_values) k where k not in ('owner_kind','owner_label','agreement_reference')) then raise exception 'Unknown business fields' using errcode='22023'; end if;
  select * into business from public.project_business_records where project_id=p_project;old_value:=to_jsonb(business);
  if business.project_id is null then business.project_id:=p_project;business.organization_id:=org;business.owner_kind:='unknown';business.source:='manual';end if;
  business:=jsonb_populate_record(business,p_values);business.updated_at:=now();business.updated_by:=auth.uid();
  perform berryit_private.project_text(coalesce(business.owner_label,''),200);perform berryit_private.project_text(coalesce(business.agreement_reference,''),300);
  insert into public.project_business_records select business.* on conflict(project_id) do update set owner_kind=excluded.owner_kind,owner_label=excluded.owner_label,
   agreement_reference=excluded.agreement_reference,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
  category:='business';new_value:=to_jsonb(business);
 else raise exception 'Unknown section' using errcode='22023'; end if;
 perform berryit_private.project_event(p_project,null,'project.control_updated',category,'manual','internal',p_reason,jsonb_build_object('before',old_value,'after',new_value));
end $$;

create function public.record_project_evidence(p_project uuid,p_values jsonb,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare org uuid; r public.project_evidence;
begin
 select organization_id into org from public.support_projects where id=p_project;
 if not public.session_is_live() or not public.can_view_project(p_project) or not public.has_resource_permission('projects.activity.write',org,p_project) then raise exception 'Evidence recording denied' using errcode='42501'; end if;
 if jsonb_typeof(p_values) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_values) k where k not in
 ('kind','title','body','stage','source_kind','source_reference','version','branch','commit_sha','occurred_at')) then raise exception 'Invalid evidence fields' using errcode='22023'; end if;
 r:=jsonb_populate_record(r,p_values);r.id:=gen_random_uuid();r.project_id:=p_project;r.organization_id:=org;r.actor_id:=auth.uid();r.recorded_at:=now();r.system_verified:=false;
 r.source_kind:=coalesce(r.source_kind,'manual');r.stage:=coalesce(r.stage,'LOCAL');r.body:=coalesce(r.body,'');r.occurred_at:=coalesce(r.occurred_at,now());
 if r.source_kind not in ('manual','ai_summary') then raise exception 'Connectors cannot be impersonated' using errcode='42501'; end if;
 perform berryit_private.project_text(r.title,200);perform berryit_private.project_text(r.body,20000);perform berryit_private.project_text(coalesce(r.source_reference,''),500);
 perform berryit_private.project_text(coalesce(r.version,''),200);perform berryit_private.project_text(coalesce(r.branch,''),200);
 insert into public.project_evidence select r.*;
 perform berryit_private.project_event(p_project,null,'project.evidence_recorded','evidence',r.source_kind,'internal',p_reason,jsonb_build_object('evidence_id',r.id,'kind',r.kind,'stage',r.stage,'system_verified',false));
 return r.id;
end $$;

create unique index project_github_issue_identity on public.project_task_links(external_id) where kind='github_issue' and external_id is not null;
create function public.link_project_task(p_task uuid,p_kind text,p_resource uuid,p_number bigint default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare t public.project_tasks; result uuid;repo text;existing_task uuid;
begin
 select * into t from public.project_tasks where id=p_task;
 if not public.can_write_project_task(p_task) then raise exception 'Task link denied' using errcode='42501'; end if;
 if p_kind='support_ticket' then
  if not exists(select 1 from public.tickets where id=p_resource and organization_id=t.organization_id and project_id=t.project_id and public.can_view_ticket(id)) then raise exception 'Ticket scope denied' using errcode='42501'; end if;
  insert into public.project_task_links(task_id,project_id,organization_id,kind,ticket_id) values(t.id,t.project_id,t.organization_id,p_kind,p_resource) on conflict(task_id,ticket_id) do update set ticket_id=excluded.ticket_id returning id into result;
 elsif p_kind='evidence' then
  if not exists(select 1 from public.project_evidence where id=p_resource and organization_id=t.organization_id and project_id=t.project_id)
   or not public.has_resource_permission('projects.activity.read',t.organization_id,t.project_id) then raise exception 'Evidence scope denied' using errcode='42501'; end if;
  insert into public.project_task_links(task_id,project_id,organization_id,kind,evidence_id) values(t.id,t.project_id,t.organization_id,p_kind,p_resource) on conflict(task_id,evidence_id) do update set evidence_id=excluded.evidence_id returning id into result;
 elsif p_kind in ('github_issue','github_pr') then
  if p_number is null or p_number<=0 or not public.has_resource_permission('repositories.read',t.organization_id,t.project_id)
   or not exists(select 1 from public.connector_integrations i where i.id=p_resource and i.project_id=t.project_id and i.organization_id=t.organization_id
   and i.connector_key='github' and i.access_mode='read_only' and i.is_enabled and i.config->>'provider_project_id' is not null) then raise exception 'Repository scope denied' using errcode='42501'; end if;
  select config->>'provider_project_id' into repo from public.connector_integrations where id=p_resource;
  perform pg_advisory_xact_lock(hashtextextended('github-resource:'||p_kind||':'||repo||':'||p_number::text,0));
  select l.id,l.task_id into result,existing_task from public.project_task_links l join public.connector_integrations i on i.id=l.integration_id
   where i.config->>'provider_project_id'=repo and l.external_number=p_number and l.kind=p_kind;
  if result is not null then
   if existing_task<>t.id then raise exception 'Issue already linked; review canonical resource' using errcode='23505';end if;
   return result;
  end if;
  insert into public.project_task_links(task_id,project_id,organization_id,kind,integration_id,external_number) values(t.id,t.project_id,t.organization_id,p_kind,p_resource,p_number)
   on conflict(integration_id,external_number,kind) do nothing returning id into result;
  if result is null then select id into result from public.project_task_links where task_id=t.id and integration_id=p_resource and external_number=p_number and kind=p_kind;end if;
  if result is null then raise exception 'Issue already linked to another task; review existing link' using errcode='23505'; end if;
 else raise exception 'Unknown link kind' using errcode='22023'; end if;
 perform berryit_private.project_event(t.project_id,t.id,'task.linked','task','system',t.visibility,'Task resource link',jsonb_build_object('link_id',result,'kind',p_kind));
 return result;
end $$;

create function public.prepare_project_task_attachment(p_task uuid,p_filename text,p_type text,p_bytes bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.project_tasks; id uuid:=gen_random_uuid();path text;
begin
 select x.* into t from public.project_tasks x where x.id=p_task;
 if not public.can_write_project_task(p_task) then raise exception 'Task upload denied' using errcode='42501'; end if;
 perform berryit_private.project_text(p_filename,255);
 if p_filename ~ '[/\\]' or p_filename in ('.','..') or p_type not in ('application/pdf','text/plain','image/png','image/jpeg','application/octet-stream','application/zip') then raise exception 'Invalid file metadata' using errcode='22023'; end if;
 path:='projects/'||t.project_id||'/tasks/'||t.id||'/'||id;
 insert into public.project_task_attachments(id,task_id,project_id,organization_id,uploaded_by,filename,content_type,bytes,storage_path,visibility)
 values(id,t.id,t.project_id,t.organization_id,auth.uid(),p_filename,p_type,p_bytes,path,t.visibility);
 return jsonb_build_object('id',id,'path',path,'bucket','project-task-attachments');
end $$;
create function public.complete_project_task_attachment(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.project_task_attachments; actual_size bigint;
begin
 select * into a from public.project_task_attachments where id=p_id for update;
 if not found or a.uploaded_by is distinct from auth.uid() or not public.can_write_project_task(a.task_id) or (a.visibility='internal' and not public.has_resource_permission('tasks.internal',a.organization_id,a.project_id)) then raise exception 'Upload completion denied' using errcode='42501'; end if;
 select (to_jsonb(o)->'metadata'->>'size')::bigint into actual_size from storage.objects o where bucket_id='project-task-attachments' and name=a.storage_path;
 if actual_size is distinct from a.bytes then raise exception 'Object missing or size not verified' using errcode='55000'; end if;
 if a.completed_at is null then
  update public.project_task_attachments set completed_at=clock_timestamp() where id=a.id;
  perform berryit_private.project_event(a.project_id,a.task_id,'task.attachment_completed','task','system',(select visibility from public.project_tasks where id=a.task_id),'Task attachment uploaded',jsonb_build_object('attachment_id',a.id));
 end if;
end $$;
create function public.project_task_attachment_path(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare a public.project_task_attachments;
begin
 select * into a from public.project_task_attachments where id=p_id;
 if not found or a.completed_at is null or not public.can_read_project_task(a.task_id) or (a.visibility='internal' and not public.has_resource_permission('tasks.internal',a.organization_id,a.project_id)) then raise exception 'Attachment denied' using errcode='42501'; end if;
 perform berryit_private.project_event(a.project_id,a.task_id,'task.attachment_read','task','system',case when a.visibility='internal' then 'internal' else (select visibility from public.project_tasks where id=a.task_id) end,'Authorized attachment request',jsonb_build_object('attachment_id',a.id));
 return a.storage_path;
end $$;
-- Private Storage bucket; no overwrites/deletes or public URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('project-task-attachments','project-task-attachments',false,26214400,
 array['application/pdf','text/plain','image/png','image/jpeg','application/octet-stream','application/zip']) on conflict(id) do nothing;
do $$ begin
 if exists(select 1 from storage.buckets where id='project-task-attachments' and (public is distinct from false or file_size_limit is distinct from 26214400
 or not(coalesce(allowed_mime_types,'{}')@>array['application/pdf','text/plain','image/png','image/jpeg','application/octet-stream','application/zip']
 and coalesce(allowed_mime_types,'{}')<@array['application/pdf','text/plain','image/png','image/jpeg','application/octet-stream','application/zip'])))
 then raise exception 'Existing task bucket does not meet private Storage policy; review required' using errcode='23514';end if;
end $$;
create policy project_task_object_read on storage.objects for select to authenticated using(bucket_id='project-task-attachments' and exists(
 select 1 from public.project_task_attachments a where a.storage_path=storage.objects.name and a.completed_at is not null and public.can_read_project_task(a.task_id)));
create policy project_task_object_insert on storage.objects for insert to authenticated with check(bucket_id='project-task-attachments' and exists(
 select 1 from public.project_task_attachments a where a.storage_path=storage.objects.name and a.uploaded_by=auth.uid() and a.completed_at is null and public.can_write_project_task(a.task_id)));
create policy project_task_object_read_bound on storage.objects as restrictive for select to authenticated using(bucket_id<>'project-task-attachments' or exists(
 select 1 from public.project_task_attachments a where a.storage_path=storage.objects.name and a.completed_at is not null and public.can_read_project_task(a.task_id)));
create policy project_task_object_insert_bound on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'project-task-attachments' or exists(
 select 1 from public.project_task_attachments a where a.storage_path=storage.objects.name and a.uploaded_by=auth.uid() and a.completed_at is null and public.can_write_project_task(a.task_id)));
create policy project_task_object_no_update on storage.objects as restrictive for update to authenticated using(bucket_id<>'project-task-attachments') with check(bucket_id<>'project-task-attachments');
create policy project_task_object_no_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'project-task-attachments');
create policy project_task_object_no_anon on storage.objects as restrictive for all to anon using(bucket_id<>'project-task-attachments') with check(bucket_id<>'project-task-attachments');

revoke all on function public.save_project_task(uuid,uuid,jsonb,bigint,text),public.project_task_comment(uuid,text,text),public.project_task_details(uuid),
 public.list_project_tasks(uuid,text,text,uuid,timestamptz,uuid,boolean),public.project_task_assignees(uuid),public.save_project_control(uuid,text,jsonb,text),
 public.record_project_evidence(uuid,jsonb,text),public.link_project_task(uuid,text,uuid,bigint),public.prepare_project_task_attachment(uuid,text,text,bigint),
 public.complete_project_task_attachment(uuid),public.project_task_attachment_path(uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_project_task(uuid,uuid,jsonb,bigint,text),public.project_task_comment(uuid,text,text),public.project_task_details(uuid),
 public.list_project_tasks(uuid,text,text,uuid,timestamptz,uuid,boolean),public.project_task_assignees(uuid),public.save_project_control(uuid,text,jsonb,text),
 public.record_project_evidence(uuid,jsonb,text),public.link_project_task(uuid,text,uuid,bigint),public.prepare_project_task_attachment(uuid,text,text,bigint),
 public.complete_project_task_attachment(uuid),public.project_task_attachment_path(uuid) to authenticated;
create function public.project_activity_page(p_project uuid,p_after timestamptz default null,p_after_id text default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 with events as (
  select 'activity:'||id::text id,project_id,actor_id,action,source_kind,occurred_at,reason,detail from public.project_activity where project_id=p_project
  union all
  select 'audit:'||id::text,p_project,actor_id,action,'system',created_at,coalesce(reason,''),'{}'::jsonb from public.support_admin_audit
   where target_type='project' and target_id=p_project::text and not(metadata?'category') and public.session_is_live() and public.can_view_project(p_project)
   and public.has_resource_permission('projects.activity.read',organization_id,p_project)
 ),page as materialized(select * from events where p_after is null or (occurred_at,id)<(p_after,p_after_id)
 order by occurred_at desc,id desc limit 101)
 select jsonb_build_object('items',coalesce((select jsonb_agg(x) from(select * from page order by occurred_at desc,id desc limit 100)x),'[]'),'hasMore',(select count(*)>100 from page));
$$;

create function public.project_control_overview(p_project uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p public.support_projects; org jsonb; profile jsonb; code jsonb; business jsonb; services jsonb:='[]';nodes jsonb:='[]';checks jsonb:='[]';connections jsonb:='[]';tickets jsonb;releases jsonb;factory jsonb;infra jsonb;
 infra_allowed boolean;repo_allowed boolean;business_allowed boolean;activity_allowed boolean;task_allowed boolean;
begin
 select * into p from public.support_projects where id=p_project;
 if not found or not public.session_is_live() or not public.can_view_project(p_project) then raise exception 'Project denied' using errcode='42501'; end if;
 infra_allowed:=public.has_resource_permission('infrastructure.read',p.organization_id,p.id);
 repo_allowed:=public.has_resource_permission('repositories.read',p.organization_id,p.id);
 business_allowed:=public.has_resource_permission('projects.business.read',p.organization_id,p.id);
 activity_allowed:=public.has_resource_permission('projects.activity.read',p.organization_id,p.id);
 task_allowed:=public.has_resource_permission('tasks.read',p.organization_id,p.id);
 select jsonb_build_object('id',id,'name',name,'isInternal',is_internal) into org from public.organizations where id=p.organization_id;
 select to_jsonb(x) into profile from public.project_control_profiles x where project_id=p.id;
 if repo_allowed then select to_jsonb(x) into code from public.project_code_records x where project_id=p.id; end if;
 if business_allowed then select to_jsonb(x) into business from public.project_business_records x where project_id=p.id; end if;
 if infra_allowed then
  infra:=public.project_infrastructure_context(p.id);services:=infra->'services';nodes:=infra->'nodes';checks:=infra->'checks';
 end if;
 if repo_allowed then connections:=public.project_repository_catalog(p.id);end if;
 if infra_allowed then connections:=connections||coalesce(infra->'integrations','[]');end if;
 select coalesce(jsonb_agg(x),'[]') into tickets from(select id,reference,subject,status_key,priority_key,updated_at from public.tickets where project_id=p.id and organization_id=p.organization_id order by updated_at desc,id desc limit 50)x;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into releases from(select * from public.project_evidence where project_id=p.id and kind in ('release','deployment','test') order by occurred_at desc,id desc limit 50)x;
 factory:=jsonb_build_object('status','BLOCKED_SCHEMA_OR_PERMISSION','items','[]'::jsonb,'hasMore',false);
 if to_regclass('factory.instances') is not null and to_regprocedure('public.factory_provider_status(uuid)') is not null and public.has_resource_permission('factory.read',p.organization_id,p.id) then
  execute 'with page as materialized(select i.id,i.name,i.product_id,i.quota_bytes,i.used_bytes,i.reserved_bytes,i.execution_mode,i.status,public.factory_provider_status(i.id) provider from factory.instances i where i.project_id=$1 order by i.created_at desc,i.id desc limit 51)
   select jsonb_build_object(''status'',''MOCK'',''items'',coalesce((select jsonb_agg(x) from(select * from page limit 50)x),''[]''),''hasMore'',(select count(*)>50 from page))' into factory using p.id;
  factory:=factory||jsonb_build_object('adapter',public.project_factory_adapter(p.id));
 end if;
 return jsonb_build_object('project',(to_jsonb(p)-'repository_url'-'website_url')||jsonb_build_object('website_url',case when p.website_url ~ '^https?://' and p.website_url !~ '[@?#]' then p.website_url end),'organization',org,'profile',profile,'code',code,'business',business,
 'capabilities',jsonb_build_object('manage',public.has_resource_permission('projects.manage',p.organization_id,p.id),'infrastructure',infra_allowed,'repositories',repo_allowed,'businessRead',business_allowed,
 'businessManage',public.has_resource_permission('projects.business.manage',p.organization_id,p.id),'activityRead',activity_allowed,'activityWrite',public.has_resource_permission('projects.activity.write',p.organization_id,p.id),
 'tasksRead',task_allowed,'tasksWrite',public.has_resource_permission('tasks.write',p.organization_id,p.id),'tasksSync',public.has_resource_permission('tasks.sync',p.organization_id,p.id)),
 'services',services,'nodes',nodes,'checks',checks,'integrations',connections,'support',tickets,'supportHasMore',(select count(*)>50 from public.tickets where project_id=p.id),
 'releases',releases,'releasesHasMore',(select count(*)>50 from public.project_evidence where project_id=p.id and kind in ('release','deployment','test')),
 'latestVerifiedVersion',(select to_jsonb(e) from public.project_evidence e where project_id=p.id and system_verified and kind='release' order by occurred_at desc,id desc limit 1),
 'lastActivity',(select jsonb_build_object('action',a.action,'source_kind',a.source_kind,'actor_id',a.actor_id,'occurred_at',a.occurred_at) from public.project_activity a where project_id=p.id order by occurred_at desc,id desc limit 1),
 'openTasks',(select count(*) from public.project_tasks where project_id=p.id and archived_at is null and status<>'done'),
 'blockers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title)),'[]') from public.project_tasks where project_id=p.id and archived_at is null and status='blocked'),
 'factory',factory,'backup',jsonb_build_object('status','UNVERIFIED','reason','No verified external restore evidence connected to this project'),
 'dataProvenance','LOCAL_REGISTER_AND_AUTHORIZED_OBSERVATIONS','externalActions','READ_ONLY');
end $$;

create function public.project_control_ai_context(p_project uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare p public.support_projects; facts jsonb; part jsonb; missing jsonb;
begin
 select * into p from public.support_projects where id=p_project;
 if not found or not public.session_is_live() or not public.can_view_project(p.id) then raise exception 'AI project scope denied' using errcode='42501'; end if;
 facts:='[]';missing:=jsonb_build_array('Project Control Center contains registered data, not a live server investigation. Business/contract records and local filesystem paths are excluded.');
 select coalesce(jsonb_agg(jsonb_build_object('id','task:'||x.id,'kind','task','at',x.updated_at,'text','Registered task: '||x.title||' | status='||x.status||' | priority='||x.priority||' | deadline='||coalesce(x.due_at::text,'unknown')||' | assignee='||coalesce(x.assignee_id::text,'unassigned'),
 'origin','project_tasks/server_scope','stale',false) order by x.updated_at desc,x.id desc),'[]') into part from(select id,title,status,priority,updated_at,due_at,assignee_id from public.project_tasks where project_id=p.id and archived_at is null and status<>'done' order by updated_at desc,id desc limit 10)x;
 facts:=facts||part;
 select coalesce(jsonb_agg(jsonb_build_object('id','evidence:'||x.id,'kind',x.kind,'at',x.occurred_at,
 'text',case when x.system_verified then 'Connector observation: ' else 'Unverified manually registered statement: ' end||x.title||' | stage='||x.stage||' | version='||coalesce(x.version,'unknown')||' | branch='||coalesce(x.branch,'unknown')||' | commit='||coalesce(x.commit_sha,'unknown')||' | '||left(x.body,2000),
 'origin','project_evidence/'||x.source_kind,'stale',x.occurred_at<now()-interval '7 days') order by x.occurred_at desc,x.id desc),'[]') into part from(select * from public.project_evidence
 where project_id=p.id and source_kind<>'ai_summary' order by occurred_at desc,id desc limit 10)x;
 facts:=facts||part;
 select coalesce(jsonb_agg(jsonb_build_object('id','activity:'||x.id,'kind','activity','at',x.occurred_at,'text','Registered project event: '||x.action||' | '||x.reason,
 'origin','project_activity/'||x.source_kind,'stale',false) order by x.occurred_at desc,x.id desc),'[]') into part from(select id,action,reason,occurred_at,source_kind from public.project_activity
 where project_id=p.id and category not in ('business','code') and source_kind<>'ai_summary' and occurred_at>=now()-interval '7 days' order by occurred_at desc,id desc limit 20)x;
 facts:=facts||part;
 missing:=missing||jsonb_build_array('Context is bounded to 10 open tasks, 10 evidence rows and 20 events from the last seven days. It is not a complete export. AI summaries are not treated as verified sources.');
 return jsonb_build_object('facts',facts,'missingInformation',missing);
end $$;
revoke all on function public.project_activity_page(uuid,timestamptz,text),public.project_control_overview(uuid),public.project_control_ai_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.project_activity_page(uuid,timestamptz,text),public.project_control_overview(uuid),public.project_control_ai_context(uuid) to authenticated;
create function public.project_repository_context(p_project uuid,p_integration uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.support_projects;i public.connector_integrations;
begin
 select * into p from public.support_projects where id=p_project;
 if not found or not public.session_is_live() or not public.has_resource_permission('repositories.read',p.organization_id,p.id) then raise exception 'Repository denied' using errcode='42501'; end if;
 select * into i from public.connector_integrations where id=p_integration and project_id=p.id and organization_id=p.organization_id
 and connector_key='github' and access_mode='read_only' and is_enabled;
 if not found or i.config->>'repository' !~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' or i.config->>'provider_project_id' !~ '^[0-9]{1,30}$'
 or i.secret_ref is null then raise exception 'Approved repository reader missing' using errcode='22023'; end if;
 return jsonb_build_object('repository',i.config->>'repository','provider_id',i.config->>'provider_project_id','secret_ref',i.secret_ref,'integration_id',i.id,
 'actor_id',auth.uid(),'session_id',auth.jwt()->>'session_id');
end $$;
create function public.project_repository_catalog(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 select organization_id into org from public.support_projects where id=p_project;
 if not public.session_is_live() or not public.has_resource_permission('repositories.read',org,p_project) then raise exception 'Repository catalog denied' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'provider','github','name',i.display_name,'is_enabled',i.is_enabled,'status',i.status,'read_only',i.access_mode='read_only',
 'repository',case when i.config->>'repository' ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' then i.config->>'repository' else null end,
 'provider_id',case when i.config->>'provider_project_id' ~ '^[0-9]{1,30}$' then i.config->>'provider_project_id' else null end) order by i.id)
 from public.connector_integrations i where i.project_id=p_project and i.organization_id=org and i.connector_key='github'),'[]');
end $$;

create function public.import_project_github_issue(p_project uuid,p_integration uuid,p_actor uuid,p_session uuid,p_issue jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved text:=current_setting('request.jwt.claims',true);org uuid;context jsonb;link public.project_task_links;task uuid;number bigint;external text;next_proposal jsonb;created boolean:=false;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted server import required' using errcode='42501'; end if;
 if not exists(select 1 from auth.sessions where id=p_session and user_id=p_actor and aal='aal2' and (not_after is null or not_after>now())) then raise exception 'Current MFA session required' using errcode='42501'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_actor,'role','authenticated','aal','aal2','session_id',p_session)::text,true);
 context:=public.project_repository_context(p_project,p_integration);
 select organization_id into org from public.support_projects where id=p_project;
 if not public.can_view_project(p_project) or not public.has_resource_permission('tasks.sync',org,p_project) or not public.has_resource_permission('tasks.write',org,p_project) then raise exception 'Issue synchronization denied' using errcode='42501'; end if;
 if jsonb_typeof(p_issue) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_issue) k where k not in ('id','number','title','body','state','updated_at'))
 or not(p_issue ?& array['id','number','title','body','state','updated_at']) or p_issue->>'state' not in ('open','closed')
 or p_issue->>'id' !~ '^[0-9]{1,30}$' then raise exception 'Invalid verified issue payload' using errcode='22023'; end if;
 number:=(p_issue->>'number')::bigint;external:=p_issue->>'id';
 if number<=0 then raise exception 'Invalid issue number' using errcode='22023'; end if;
 perform berryit_private.project_text(p_issue->>'title',200);perform berryit_private.project_text(p_issue->>'body',20000);
 perform pg_advisory_xact_lock(hashtextextended('github-resource:github_issue:'||(context->>'provider_id')||':'||number::text,0));
 select l.* into link from public.project_task_links l join public.connector_integrations i on i.id=l.integration_id
 where l.kind='github_issue' and (l.external_id=external or (l.external_number=number and i.config->>'provider_project_id'=context->>'provider_id')) for update of l;
 next_proposal:=jsonb_build_object('title',p_issue->>'title','description',p_issue->>'body','status',case when p_issue->>'state'='closed' then 'done' else 'todo' end);
 if link.id is null then
  task:=public.save_project_task(null,p_project,next_proposal,null,'Issue imported from approved GitHub GET response');created:=true;
  insert into public.project_task_links(task_id,project_id,organization_id,kind,integration_id,external_number,external_id,observed_at,checked_at)
  values(task,p_project,org,'github_issue',p_integration,number,external,(p_issue->>'updated_at')::timestamptz,clock_timestamp()) returning * into link;
 else
  if link.project_id<>p_project or link.organization_id<>org or link.external_number<>number
   or not public.can_write_project_task(link.task_id)
   or (select i.config->>'provider_project_id' from public.connector_integrations i where i.id=link.integration_id) is distinct from context->>'provider_id'
   or (link.external_id is not null and link.external_id<>external) then raise exception 'Issue identity collision or task scope denied' using errcode='42501'; end if;
  task:=link.task_id;
  -- Even subsequent verified observations cannot overwrite manual task edits.
  if link.observed_at>=(p_issue->>'updated_at')::timestamptz then
   update public.project_task_links set checked_at=clock_timestamp() where id=link.id;
   perform set_config('request.jwt.claims',coalesce(saved,''),true);return jsonb_build_object('taskId',task,'created',false,'unchanged',true);
  end if;
  update public.project_task_links set external_id=external,observed_at=(p_issue->>'updated_at')::timestamptz,checked_at=clock_timestamp(),proposal=next_proposal where id=link.id;
 end if;
 perform berryit_private.project_event(p_project,task,'task.github_observed','task','connector','internal','Verified read-only GitHub observation',jsonb_build_object('integration_id',p_integration,'issue_number',number,'new_task',created));
 perform set_config('request.jwt.claims',coalesce(saved,''),true);
 return jsonb_build_object('taskId',task,'created',created,'proposalOnly',not created);
exception when others then perform set_config('request.jwt.claims',coalesce(saved,''),true);raise;
end $$;
create function public.accept_project_issue_proposal(p_link uuid,p_revision bigint,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare l public.project_task_links;t uuid;
begin
 select * into l from public.project_task_links where id=p_link for update;
 if not found or not public.can_write_project_task(l.task_id) or not public.has_resource_permission('repositories.read',l.organization_id,l.project_id) or l.proposal is null then raise exception 'Issue proposal denied or missing' using errcode='42501'; end if;
 t:=public.save_project_task(l.task_id,l.project_id,l.proposal,p_revision,p_reason);
 update public.project_task_links set proposal=null where id=l.id;
 return t;
end $$;
revoke all on function public.project_repository_context(uuid,uuid),public.project_repository_catalog(uuid),public.import_project_github_issue(uuid,uuid,uuid,uuid,jsonb),public.accept_project_issue_proposal(uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.project_repository_context(uuid,uuid),public.project_repository_catalog(uuid),public.accept_project_issue_proposal(uuid,bigint,text) to authenticated;
grant execute on function public.import_project_github_issue(uuid,uuid,uuid,uuid,jsonb) to service_role;
create function public.project_infrastructure_context(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid;services jsonb;nodes jsonb;checks jsonb;integrations jsonb;
begin
 select organization_id into org from public.support_projects where id=p_project;
 if not public.session_is_live() or not public.can_view_project(p_project) or not public.has_resource_permission('infrastructure.read',org,p_project) then raise exception 'Project infrastructure denied' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'node_id',s.node_id,'kind',s.service_kind,'environment',s.environment,
 'url',case when s.url !~ '[@?#]' then s.url else null end,'is_active',s.is_active)),'[]') into services from public.infra_services s where s.project_id=p_project and s.organization_id=org;
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'name',n.name,'hostname',case when n.hostname ~ '^[A-Za-z0-9.:-]{1,253}$' then n.hostname else null end,
 'provider',n.provider,'region',n.region,'kind',n.node_kind)),'[]') into nodes from public.infra_nodes n where n.organization_id=org and exists(select 1 from public.infra_services s where s.project_id=p_project and s.organization_id=org and s.node_id=n.id);
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into checks from(select distinct on(c.service_id) c.service_id,c.status_key,c.checked_at,c.source,c.latency_ms from public.service_status_checks c
 join public.infra_services s on s.id=c.service_id and s.organization_id=c.organization_id where s.project_id=p_project and s.organization_id=org order by c.service_id,c.checked_at desc,c.id desc)x;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.display_name,'provider',i.connector_key,'status',i.status,'is_enabled',i.is_enabled,'read_only',i.access_mode='read_only')),'[]') into integrations from public.connector_integrations i
 where i.organization_id=org and i.connector_key<>'github' and (i.project_id=p_project or exists(select 1 from public.infra_services s where s.id=i.service_id and s.organization_id=org and s.project_id=p_project));
 return jsonb_build_object('services',services,'nodes',nodes,'checks',checks,'integrations',integrations);
end $$;
revoke all on function public.project_infrastructure_context(uuid) from public,anon,authenticated,service_role;
grant execute on function public.project_infrastructure_context(uuid) to authenticated;
create function public.project_task_projects() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'organization_id',p.organization_id,
 'canWrite',public.has_resource_permission('tasks.write',p.organization_id,p.id),'canInternal',public.has_resource_permission('tasks.internal',p.organization_id,p.id)) order by p.name,p.id),'[]')
 from public.support_projects p where public.session_is_live() and public.can_view_project(p.id) and public.has_resource_permission('tasks.read',p.organization_id,p.id);
$$;
revoke all on function public.project_task_projects() from public,anon,authenticated,service_role;
grant execute on function public.project_task_projects() to authenticated;
create function public.project_issue_sync_context(p_project uuid,p_integration uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid;context jsonb;
begin
 context:=public.project_repository_context(p_project,p_integration);
 select organization_id into org from public.support_projects where id=p_project;
 if not public.has_resource_permission('tasks.sync',org,p_project) or not public.has_resource_permission('tasks.write',org,p_project) then raise exception 'Issue sync denied' using errcode='42501'; end if;
 return context;
end $$;
create function public.import_project_github_issues(p_project uuid,p_integration uuid,p_actor uuid,p_session uuid,p_issues jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb;result jsonb;created integer:=0;observed integer:=0;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted import required' using errcode='42501'; end if;
 if jsonb_typeof(p_issues) is distinct from 'array' or jsonb_array_length(p_issues)>2000 or length(p_issues::text)>8388608 then raise exception 'Bounded complete import required' using errcode='22023'; end if;
 for item in select value from jsonb_array_elements(p_issues) loop
  result:=public.import_project_github_issue(p_project,p_integration,p_actor,p_session,item);
  observed:=observed+1;if (result->>'created')::boolean then created:=created+1;end if;
 end loop;
 return jsonb_build_object('created',created,'observed',observed);
end $$;
revoke all on function public.project_issue_sync_context(uuid,uuid),public.import_project_github_issues(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.project_issue_sync_context(uuid,uuid) to authenticated;
grant execute on function public.import_project_github_issues(uuid,uuid,uuid,uuid,jsonb) to service_role;
create function public.project_factory_adapter(p_project uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid;product text;result jsonb;
begin
 select organization_id into org from public.support_projects where id=p_project;
 if not public.session_is_live() or not public.can_view_project(p_project) or not public.has_resource_permission('factory.read',org,p_project) then raise exception 'Factory project denied' using errcode='42501';end if;
 if to_regclass('factory.adapters') is null then return null;end if;
 select factory_product_key into product from public.project_control_profiles where project_id=p_project;
 execute 'select jsonb_build_object(''productId'',a.product_id,''version'',a.version,''status'',a.status) from factory.adapters a where a.product_id=$1 and a.version is not null' into result using product;
 return result;
end $$;
revoke all on function public.project_factory_adapter(uuid) from public,anon,authenticated,service_role;
grant execute on function public.project_factory_adapter(uuid) to authenticated;
create function public.project_evidence_page(p_project uuid,p_after timestamptz default null,p_after_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 with page as materialized(select * from public.project_evidence e where e.project_id=p_project and e.kind in ('release','deployment','test')
 and (p_after is null or (e.occurred_at,e.id)<(p_after,p_after_id)) order by e.occurred_at desc,e.id desc limit 51)
 select jsonb_build_object('items',coalesce((select jsonb_agg(x) from(select * from page order by occurred_at desc,id desc limit 50)x),'[]'),'hasMore',(select count(*)>50 from page));
$$;
revoke all on function public.project_evidence_page(uuid,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.project_evidence_page(uuid,timestamptz,uuid) to authenticated;
create function public.project_task_history(p_task uuid,p_after timestamptz default null,p_after_id text default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t public.project_tasks;result jsonb;
begin
 select * into t from public.project_tasks where id=p_task;
 if not found or not public.can_read_project_task(p_task) or not public.has_resource_permission('projects.activity.read',t.organization_id,t.project_id) then raise exception 'Task history denied' using errcode='42501';end if;
 with page as materialized(select 'activity:'||a.id::text id,a.actor_id,a.action,a.source_kind,a.occurred_at,a.reason,a.detail from public.project_activity a
 where a.task_id=p_task and (p_after is null or (a.occurred_at,'activity:'||a.id::text)<(p_after,p_after_id)) order by a.occurred_at desc,('activity:'||a.id::text) desc limit 101)
 select jsonb_build_object('items',coalesce((select jsonb_agg(x) from(select * from page order by occurred_at desc,id desc limit 100)x),'[]'),'hasMore',(select count(*)>100 from page)) into result;
 return result;
end $$;
revoke all on function public.project_task_history(uuid,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.project_task_history(uuid,timestamptz,text) to authenticated;
create function public.register_project_names(p_org uuid,p_names jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare project_name text;project uuid;result jsonb:='[]';matches integer;created boolean;
begin
 if not public.session_is_live() or not public.has_resource_permission('projects.manage',p_org,null)
 or not exists(select 1 from public.organizations where id=p_org) then raise exception 'Registration denied' using errcode='42501'; end if;
 if jsonb_typeof(p_names) is distinct from 'array' or jsonb_array_length(p_names) not between 1 and 30
 or exists(select 1 from jsonb_array_elements(p_names)x where jsonb_typeof(x)<>'string')
 or (select count(*)<>count(distinct lower(btrim(x))) from jsonb_array_elements_text(p_names)x) then raise exception 'Invalid registration list' using errcode='22023'; end if;
 for project_name in select btrim(value) from jsonb_array_elements_text(p_names) loop
  perform berryit_private.project_text(project_name,120);
  perform pg_advisory_xact_lock(hashtextextended('project-name:'||p_org::text||':'||lower(project_name),0));
  select count(*),(array_agg(id))[1] into matches,project from public.support_projects where organization_id=p_org and lower(btrim(support_projects.name))=lower(project_name);
  if matches>1 then raise exception 'Ambiguous existing name; reconcile manually' using errcode='23505';end if;
  created:=matches=0;
  if created then project:=public.save_support_project(null,p_org,jsonb_build_object('name',project_name,'description','','source','manual'),p_reason);end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',project,'name',project_name,'created',created,'technicalDetails','UNVERIFIED','businessOwnership','UNVERIFIED'));
 end loop;
 return result;
end $$;
revoke all on function public.register_project_names(uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.register_project_names(uuid,jsonb,text) to authenticated;
commit;
