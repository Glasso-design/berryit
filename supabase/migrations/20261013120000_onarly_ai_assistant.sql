-- BERRYiT Control Center: ONARLY AI support assistant.
-- The Desktop never receives provider or gateway credentials. It writes user
-- messages with its own JWT; assistant messages and audit rows are server-only.

create table public.support_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text not null default '',
  repository_url text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, name),
  constraint support_projects_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint support_projects_description_length check (char_length(description) <= 4000),
  constraint support_projects_repository_https check (
    repository_url is null or (char_length(repository_url) <= 500 and repository_url ~ '^https://[^[:space:]]+$')
  )
);

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  service_key text references public.ticket_categories(key) on update cascade on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  title text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id)
    references public.support_projects(id, organization_id) on delete restrict,
  constraint ai_conversations_title_length check (char_length(btrim(title)) between 2 and 160)
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  organization_id uuid not null,
  actor_id uuid references public.profiles(id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  body text not null,
  provider text,
  model text,
  structured_response jsonb,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (conversation_id, organization_id)
    references public.ai_conversations(id, organization_id) on delete cascade,
  constraint ai_messages_body_length check (char_length(btrim(body)) between 1 and 20000),
  constraint ai_messages_actor_role check (
    (role = 'user' and actor_id is not null and provider is null and model is null
      and structured_response is null)
    or (role = 'assistant' and actor_id is null and provider is not null
      and model is not null and structured_response is not null)
  ),
  constraint ai_messages_structured_object check (
    structured_response is null or jsonb_typeof(structured_response) = 'object'
  )
);

create table public.ai_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid,
  service_key text references public.ticket_categories(key) on update cascade on delete restrict,
  source_conversation_id uuid,
  source_message_id uuid,
  title text not null,
  problem text not null,
  verified_solution text not null,
  source_references jsonb not null default '[]'::jsonb,
  verified_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id)
    references public.support_projects(id, organization_id) on delete restrict,
  foreign key (source_conversation_id, organization_id)
    references public.ai_conversations(id, organization_id) on delete restrict,
  foreign key (source_message_id, organization_id)
    references public.ai_messages(id, organization_id) on delete restrict,
  constraint ai_knowledge_title_length check (char_length(btrim(title)) between 3 and 200),
  constraint ai_knowledge_problem_length check (char_length(btrim(problem)) between 3 and 10000),
  constraint ai_knowledge_solution_length check (char_length(btrim(verified_solution)) between 3 and 20000),
  constraint ai_knowledge_sources_array check (jsonb_typeof(source_references) = 'array')
);

create table public.ai_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  request_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ai_audit_action_format check (action ~ '^ai[.][a-z0-9_.]{2,80}$'),
  constraint ai_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index support_projects_org_name on public.support_projects(organization_id, name);
create index ai_conversations_org_updated on public.ai_conversations(organization_id, updated_at desc);
create index ai_messages_conversation_created on public.ai_messages(conversation_id, created_at);
create index ai_knowledge_org_project on public.ai_knowledge_entries(organization_id, project_id, created_at desc);
create index ai_audit_created on public.ai_audit_events(created_at desc);

create trigger support_projects_set_updated_at before update on public.support_projects
  for each row execute function public.set_updated_at();
create trigger ai_conversations_set_updated_at before update on public.ai_conversations
  for each row execute function public.set_updated_at();
create trigger ai_knowledge_set_updated_at before update on public.ai_knowledge_entries
  for each row execute function public.set_updated_at();

create or replace function public.guard_ai_context_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'AI organization context is immutable'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'support_projects' and
     to_jsonb(new)->>'created_by' is distinct from to_jsonb(old)->>'created_by' then
    raise exception 'Project creator is immutable'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'ai_conversations' and (
     to_jsonb(new)->>'project_id' is distinct from to_jsonb(old)->>'project_id'
     or to_jsonb(new)->>'service_key' is distinct from to_jsonb(old)->>'service_key'
     or to_jsonb(new)->>'created_by' is distinct from to_jsonb(old)->>'created_by'
  ) then
    raise exception 'AI conversation context is immutable'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_table_name = 'ai_knowledge_entries' and (
     to_jsonb(new)->>'project_id' is distinct from to_jsonb(old)->>'project_id'
     or to_jsonb(new)->>'service_key' is distinct from to_jsonb(old)->>'service_key'
     or to_jsonb(new)->>'verified_by' is distinct from to_jsonb(old)->>'verified_by'
     or to_jsonb(new)->>'source_conversation_id' is distinct from to_jsonb(old)->>'source_conversation_id'
     or to_jsonb(new)->>'source_message_id' is distinct from to_jsonb(old)->>'source_message_id'
  ) then
    raise exception 'Knowledge verification context is immutable'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger support_projects_context_guard before update on public.support_projects
  for each row execute function public.guard_ai_context_immutability();
create trigger ai_conversations_context_guard before update on public.ai_conversations
  for each row execute function public.guard_ai_context_immutability();
create trigger ai_knowledge_context_guard before update on public.ai_knowledge_entries
  for each row execute function public.guard_ai_context_immutability();

create or replace function public.can_use_ai_for_organization(
  p_organization_id uuid,
  p_write boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_organization_id is not null
     and (
       public.is_staff()
       or public.has_support_permission(
         case when p_write then 'tickets.write' else 'tickets.read' end,
         p_organization_id
       )
     );
$$;

create or replace function public.can_access_ai_conversation(
  p_conversation_id uuid,
  p_write boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.ai_conversations c
     where c.id = p_conversation_id
       and public.can_use_ai_for_organization(c.organization_id, p_write)
  );
$$;

grant execute on function public.can_use_ai_for_organization(uuid, boolean) to authenticated;
grant execute on function public.can_access_ai_conversation(uuid, boolean) to authenticated;

alter table public.support_projects enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_knowledge_entries enable row level security;
alter table public.ai_audit_events enable row level security;

-- Scoped technicians are not global staff. These additive policies expose only
-- their assigned organization and allow an explicitly confirmed AI ticket in
-- that same scope.
create policy organizations_select_ai_scope on public.organizations
  for select to authenticated
  using (public.has_org_support_access(id));

create policy tickets_insert_ai_scope on public.tickets
  for insert to authenticated
  with check (
    source = 'api'
    and external_channel = 'onarly-ai'
    and requester_id = auth.uid()
    and status_key = 'mottaget'
    and assignee_id is null
    and organization_id is not null
    and public.has_support_permission('tickets.write', organization_id)
  );

grant select, insert, update on public.support_projects to authenticated;
grant select, insert, update on public.ai_conversations to authenticated;
grant select, insert on public.ai_messages to authenticated;
grant select, insert, update on public.ai_knowledge_entries to authenticated;
grant select on public.ai_audit_events to authenticated;

grant all on public.support_projects, public.ai_conversations, public.ai_messages,
  public.ai_knowledge_entries, public.ai_audit_events to service_role;

create policy support_projects_select on public.support_projects
  for select to authenticated
  using (public.can_use_ai_for_organization(organization_id));

create policy support_projects_insert on public.support_projects
  for insert to authenticated
  with check (
    public.can_use_ai_for_organization(organization_id, true)
    and created_by = auth.uid()
  );

create policy support_projects_update on public.support_projects
  for update to authenticated
  using (public.can_use_ai_for_organization(organization_id, true))
  with check (public.can_use_ai_for_organization(organization_id, true));

create policy ai_conversations_select on public.ai_conversations
  for select to authenticated
  using (public.can_use_ai_for_organization(organization_id));

create policy ai_conversations_insert on public.ai_conversations
  for insert to authenticated
  with check (
    public.can_use_ai_for_organization(organization_id, true)
    and created_by = auth.uid()
  );

create policy ai_conversations_update on public.ai_conversations
  for update to authenticated
  using (public.can_use_ai_for_organization(organization_id, true))
  with check (public.can_use_ai_for_organization(organization_id, true));

create policy ai_messages_select on public.ai_messages
  for select to authenticated
  using (public.can_access_ai_conversation(conversation_id));

create policy ai_messages_insert_user on public.ai_messages
  for insert to authenticated
  with check (
    role = 'user'
    and actor_id = auth.uid()
    and public.can_access_ai_conversation(conversation_id, true)
  );

create policy ai_knowledge_select on public.ai_knowledge_entries
  for select to authenticated
  using (public.can_use_ai_for_organization(organization_id));

create policy ai_knowledge_insert on public.ai_knowledge_entries
  for insert to authenticated
  with check (
    public.can_use_ai_for_organization(organization_id, true)
    and verified_by = auth.uid()
  );

create policy ai_knowledge_update on public.ai_knowledge_entries
  for update to authenticated
  using (public.can_use_ai_for_organization(organization_id, true))
  with check (public.can_use_ai_for_organization(organization_id, true));

create policy ai_audit_select on public.ai_audit_events
  for select to authenticated
  using (
    public.has_support_permission('audit.read')
    and (
      organization_id is null
      or public.can_use_ai_for_organization(organization_id)
    )
  );

-- User messages update the conversation timestamp. Assistant messages use the
-- same trigger, but only the trusted adapter can insert those rows.
create or replace function public.touch_ai_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

create trigger ai_messages_touch_conversation after insert on public.ai_messages
  for each row execute function public.touch_ai_conversation();
