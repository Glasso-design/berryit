-- PASS 2G: manual ONARLY DESK register. No RustDesk connection is started or verified here.
-- A private customer's ticket has no organization_id in the existing model and is
-- intentionally ineligible until a separate customer/entitlement migration exists.

update public.connector_kinds set description = 'Saknar serverbaserat sessions-API; faktisk status är okänd'
  where key = 'onarly_desk';
update public.connector_integrations set status = 'not_configured', last_error = 'DESK saknar serverbaserat sessions-API'
  where connector_key = 'onarly_desk';

alter table public.support_role_grants
  add column is_external_consultant boolean not null default false,
  add column consultant_company text,
  add column commissioning_organization_id uuid references public.organizations(id);
alter table public.support_role_grants add constraint external_grant_scope check (
  not is_external_consultant or
  (scope = 'organization' and role_key = 'BERRYIT_SUPPORT_TECHNICIAN'
   and commissioning_organization_id is not null and expires_at is not null
   and length(btrim(coalesce(consultant_company, ''))) between 2 and 200)
);

create function public.guard_external_consultant_grant() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (
    new.is_external_consultant is distinct from old.is_external_consultant or
    new.consultant_company is distinct from old.consultant_company or
    new.commissioning_organization_id is distinct from old.commissioning_organization_id
  ) then
    raise exception 'External consultant identity is immutable; revoke and regrant' using errcode = '42501';
  end if;
  if new.is_external_consultant and (new.scope <> 'organization' or
      new.role_key <> 'BERRYIT_SUPPORT_TECHNICIAN') then
    raise exception 'External consultants may only hold an organization technician grant' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger support_external_consultant_guard before insert or update on public.support_role_grants
  for each row execute function public.guard_external_consultant_grant();

create function public.has_active_desk_entitlement(p_organization_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_organization_id is not null and exists (
    select 1 from public.onarly_support_entitlements e
    where e.organization_id = p_organization_id
      and e.product_key = 'onarly_desk' and e.entitlement = 'remote_support'
      and e.revoked_at is null and (e.expires_at is null or e.expires_at > now())
  ) and (public.is_staff() or public.has_org_support_access(p_organization_id)
    or p_organization_id = public.current_organization_id());
$$;
revoke all on function public.has_active_desk_entitlement(uuid) from public, anon;
grant execute on function public.has_active_desk_entitlement(uuid) to authenticated;

create table public.onarly_desk_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  label text not null check (length(btrim(label)) between 1 and 120),
  rustdesk_id text not null check (rustdesk_id ~ '^[0-9]{6,20}$'),
  registered_by uuid not null references public.profiles(id),
  registered_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (id, organization_id),
  unique (organization_id, rustdesk_id)
);
create index onarly_desk_devices_org_idx on public.onarly_desk_devices(organization_id);

create table public.onarly_desk_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  device_id uuid not null,
  technician_id uuid not null references public.profiles(id),
  requested_at timestamptz not null default now(),
  consent_method text check (consent_method in ('phone', 'chat', 'email', 'in_person', 'other')),
  consent_note text check (consent_note is null or length(btrim(consent_note)) between 1 and 1000),
  consent_recorded_at timestamptz,
  consent_recorded_by uuid references public.profiles(id),
  started_at timestamptz,
  started_by uuid references public.profiles(id),
  ended_at timestamptz,
  ended_by uuid references public.profiles(id),
  provenance text not null default 'manual' check (provenance = 'manual'),
  actual_connection_status text not null default 'unknown' check (actual_connection_status = 'unknown'),
  foreign key (device_id, organization_id) references public.onarly_desk_devices(id, organization_id),
  constraint desk_session_order check (
    (consent_recorded_at is null or consent_method is not null) and
    (started_at is null or consent_recorded_at is not null) and
    (ended_at is null or started_at is not null)
  )
);
create index onarly_desk_sessions_ticket_idx on public.onarly_desk_sessions(ticket_id, requested_at desc);

create table public.onarly_desk_session_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.onarly_desk_sessions(id) on delete restrict,
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references public.profiles(id),
  action text not null check (action in ('requested', 'consent_recorded', 'manual_start', 'manual_end')),
  created_at timestamptz not null default now(),
  provenance text not null default 'manual' check (provenance = 'manual')
);
create index onarly_desk_events_ticket_idx on public.onarly_desk_session_events(ticket_id, created_at desc);

create function public.guard_desk_device() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.registered_by is distinct from auth.uid() then
      raise exception 'Device registrar must be the actor' using errcode = '42501';
    end if;
    if not public.has_active_desk_entitlement(new.organization_id) then
      raise exception 'Active ONARLY DESK entitlement required' using errcode = '42501';
    end if;
    new.registered_at := now();
  else
    if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id or
       new.rustdesk_id is distinct from old.rustdesk_id or new.label is distinct from old.label or
       new.registered_by is distinct from old.registered_by or new.registered_at is distinct from old.registered_at or
       old.is_active = false or new.is_active <> false then
      raise exception 'Device records may only be deactivated' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger onarly_desk_device_guard before insert or update on public.onarly_desk_devices
  for each row execute function public.guard_desk_device();

create function public.guard_desk_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ticket_org uuid;
  device_active boolean;
  transitions integer := 0;
begin
  select t.organization_id into ticket_org from public.tickets t where t.id = new.ticket_id;
  if ticket_org is null or ticket_org is distinct from new.organization_id then
    raise exception 'Session must belong to the ticket organization' using errcode = '42501';
  end if;
  select d.is_active into device_active from public.onarly_desk_devices d
   where d.id = new.device_id and d.organization_id = new.organization_id;
  if (tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.started_at is distinct from old.started_at))
     and device_active is not true then
    raise exception 'Device is unavailable for this organization' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.technician_id is distinct from auth.uid() then
      raise exception 'Technician must be the actor' using errcode = '42501';
    end if;
    if not public.has_active_desk_entitlement(new.organization_id) then
      raise exception 'Active ONARLY DESK entitlement required' using errcode = '42501';
    end if;
    if new.consent_method is not null or new.consent_note is not null or new.consent_recorded_at is not null or
       new.consent_recorded_by is not null or new.started_at is not null or new.started_by is not null or
       new.ended_at is not null or new.ended_by is not null then
      raise exception 'Request must precede consent and manual session events' using errcode = '42501';
    end if;
    new.requested_at := now();
    return new;
  end if;
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id or
     new.ticket_id is distinct from old.ticket_id or new.device_id is distinct from old.device_id or
     new.technician_id is distinct from old.technician_id or new.requested_at is distinct from old.requested_at or
     new.provenance is distinct from old.provenance or new.actual_connection_status is distinct from old.actual_connection_status then
    raise exception 'Session identity and provenance are immutable' using errcode = '42501';
  end if;
  transitions := (new.consent_recorded_at is distinct from old.consent_recorded_at)::int +
                 (new.started_at is distinct from old.started_at)::int +
                 (new.ended_at is distinct from old.ended_at)::int;
  if transitions <> 1 then
    raise exception 'Record exactly one session transition at a time' using errcode = '42501';
  end if;
  if new.consent_recorded_at is distinct from old.consent_recorded_at then
    if old.consent_recorded_at is not null or new.consent_recorded_at is null or
       new.consent_method is null or new.consent_note is null or old.started_at is not null or
       not public.has_active_desk_entitlement(new.organization_id) then
      raise exception 'Consent record requires a method, note and active entitlement' using errcode = '42501';
    end if;
    new.consent_recorded_at := now();
    new.consent_recorded_by := auth.uid();
    if new.started_by is distinct from old.started_by or new.ended_by is distinct from old.ended_by then
      raise exception 'Only consent may change in this transition' using errcode = '42501';
    end if;
  elsif new.started_at is distinct from old.started_at then
    if old.started_at is not null or new.started_at is null or old.consent_recorded_at is null or
       not public.has_active_desk_entitlement(new.organization_id) then
      raise exception 'Manual start requires recorded consent and active entitlement' using errcode = '42501';
    end if;
    new.started_at := now();
    new.started_by := auth.uid();
    if new.consent_recorded_by is distinct from old.consent_recorded_by or
       new.ended_by is distinct from old.ended_by then
      raise exception 'Only start may change in this transition' using errcode = '42501';
    end if;
  else
    if old.ended_at is not null or new.ended_at is null or old.started_at is null then
      raise exception 'Manual end requires a prior start' using errcode = '42501';
    end if;
    new.ended_at := now();
    new.ended_by := auth.uid();
    if new.consent_recorded_by is distinct from old.consent_recorded_by or
       new.started_by is distinct from old.started_by then
      raise exception 'Only end may change in this transition' using errcode = '42501';
    end if;
  end if;
  if new.consent_method is distinct from old.consent_method or new.consent_note is distinct from old.consent_note then
    if old.consent_recorded_at is not null or new.consent_recorded_at is null then
      raise exception 'Consent details cannot be rewritten' using errcode = '42501';
    end if;
  end if;
  if (new.consent_recorded_by is distinct from old.consent_recorded_by and new.consent_recorded_by is distinct from auth.uid()) or
     (new.started_by is distinct from old.started_by and new.started_by is distinct from auth.uid()) or
     (new.ended_by is distinct from old.ended_by and new.ended_by is distinct from auth.uid()) then
    raise exception 'Actor cannot be forged' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger onarly_desk_session_guard before insert or update on public.onarly_desk_sessions
  for each row execute function public.guard_desk_session();

create function public.audit_desk_session() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  action_name text;
begin
  action_name := case when tg_op = 'INSERT' then 'requested'
    when new.consent_recorded_at is distinct from old.consent_recorded_at then 'consent_recorded'
    when new.started_at is distinct from old.started_at then 'manual_start'
    else 'manual_end' end;
  insert into public.onarly_desk_session_events(session_id, ticket_id, organization_id, actor_id, action)
    values(new.id, new.ticket_id, new.organization_id, auth.uid(), action_name);
  insert into public.support_admin_audit(actor_id, action, target_type, target_id, scope, organization_id, metadata)
    values(auth.uid(), 'onarly_desk.' || action_name, 'onarly_desk_session', new.id::text,
      'organization', new.organization_id,
      jsonb_build_object('ticket_id', new.ticket_id, 'device_id', new.device_id, 'provenance', 'manual'));
  return new;
end;
$$;
create trigger onarly_desk_session_audit after insert or update on public.onarly_desk_sessions
  for each row execute function public.audit_desk_session();

create function public.audit_desk_device() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.support_admin_audit(actor_id, action, target_type, target_id, scope, organization_id, metadata)
    values(auth.uid(), case when tg_op = 'INSERT' then 'onarly_desk.device_registered'
      else 'onarly_desk.device_deactivated' end, 'onarly_desk_device', new.id::text,
      'organization', new.organization_id, jsonb_build_object('provenance', 'manual'));
  return new;
end;
$$;
create trigger onarly_desk_device_audit after insert or update on public.onarly_desk_devices
  for each row execute function public.audit_desk_device();

alter table public.onarly_desk_devices enable row level security;
alter table public.onarly_desk_sessions enable row level security;
alter table public.onarly_desk_session_events enable row level security;
grant select, insert, update on public.onarly_desk_devices, public.onarly_desk_sessions to authenticated;
grant select on public.onarly_desk_session_events to authenticated;
create policy desk_entitlements_scoped_read on public.onarly_support_entitlements
  for select to authenticated using (public.has_org_support_access(organization_id));
create policy desk_devices_read on public.onarly_desk_devices for select to authenticated
  using (public.has_org_support_access(organization_id) or public.is_staff() or
         organization_id = public.current_organization_id());
create policy desk_devices_insert on public.onarly_desk_devices for insert to authenticated
  with check (registered_by = auth.uid() and
    (public.is_staff() or public.has_support_permission('tickets.write', organization_id)) and
    public.has_active_desk_entitlement(organization_id));
create policy desk_devices_deactivate on public.onarly_desk_devices for update to authenticated
  using (public.is_staff() or public.has_support_permission('tickets.write', organization_id))
  with check (public.is_staff() or public.has_support_permission('tickets.write', organization_id));
create policy desk_sessions_read on public.onarly_desk_sessions for select to authenticated
  using (public.can_view_ticket(ticket_id));
create policy desk_sessions_insert on public.onarly_desk_sessions for insert to authenticated
  with check (technician_id = auth.uid() and public.can_work_ticket(ticket_id) and
    public.has_active_desk_entitlement(organization_id));
create policy desk_sessions_update on public.onarly_desk_sessions for update to authenticated
  using (public.can_work_ticket(ticket_id)) with check (public.can_work_ticket(ticket_id));
create policy desk_events_read on public.onarly_desk_session_events for select to authenticated
  using (public.can_view_ticket(ticket_id));
revoke all on function public.guard_external_consultant_grant(), public.guard_desk_device(),
  public.guard_desk_session(), public.audit_desk_session(), public.audit_desk_device()
  from public, anon, authenticated;
