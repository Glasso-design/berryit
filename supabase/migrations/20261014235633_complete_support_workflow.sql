-- Manual workflow V1. Forward migration; existing profiles, tickets and grants
-- remain authoritative. A private customer has organization_id NULL.
create schema if not exists berryit_private;
revoke all on schema berryit_private from public, anon, authenticated;

alter table public.profiles
  add column login_activation_pending boolean not null default false,
  add column registered_by uuid references public.profiles(id) on delete set null;
alter table public.tickets add column reopen_reason text;
alter table public.ticket_attachments add column upload_completed_at timestamptz;

create function berryit_private.registration_admin(p_actor uuid, p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join auth.sessions s on s.user_id = p.id
    where p.id = p_actor and p.is_active and s.id = p_session and s.aal::text = 'aal2'
      and (s.not_after is null or s.not_after > now())
      and (p.role = 'admin' or exists (
        select 1 from public.support_role_grants g where g.grantee_id = p.id
          and g.role_key = 'BERRYIT_SUPPORT_SUPER_ADMIN' and g.scope = 'global'
          and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
      ))
  );
$$;
revoke all on function berryit_private.registration_admin(uuid, uuid) from public, anon, authenticated;

create function public.can_register_support_customer()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_aal() = 'aal2' and berryit_private.registration_admin(
    auth.uid(), nullif(auth.jwt()->>'session_id', '')::uuid
  );
$$;
create function public.support_registration_context(p_organization_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if public.can_register_support_customer() is not true or
     (p_organization_id is not null and not exists (select 1 from public.organizations where id = p_organization_id)) then
    raise exception 'Kundregistrering kräver aktiv administratör med MFA' using errcode = '42501';
  end if;
  return jsonb_build_object('actor_id', auth.uid(), 'session_id', auth.jwt()->>'session_id',
    'organization_id', p_organization_id);
end;
$$;

-- Only Auth admin can supply raw_app_meta_data. User-editable metadata never
-- selects a role or organisation. GoTrue creates user + profile + audit in one
-- transaction; a revoked/expired registrar aborts that NEW user transaction.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare registration jsonb := new.raw_app_meta_data->'berryit_manual_customer';
  actor uuid; sid uuid; org uuid; pending boolean := registration is not null;
begin
  if pending then
    actor := (registration->>'actor_id')::uuid;
    sid := (registration->>'session_id')::uuid;
    org := nullif(registration->>'organization_id', '')::uuid;
    if berryit_private.registration_admin(actor, sid) is not true then
      raise exception 'Registreringsbehörigheten har upphört' using errcode = '42501';
    end if;
  end if;
  insert into public.profiles(id,email,full_name,phone,organization_id,login_activation_pending,registered_by)
  values(new.id,new.email,nullif(btrim(new.raw_user_meta_data->>'full_name'),''),
    nullif(btrim(new.raw_user_meta_data->>'phone'),''),org,pending,actor)
  on conflict(id) do nothing;
  if pending then
    insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason,metadata)
    values(actor,'customer_registered','profile',new.id::text,
      case when org is null then 'global'::public.support_scope else 'organization'::public.support_scope end,
      org,'Manuell kundregistrering',jsonb_build_object('login_activation_pending',true));
  end if;
  return new;
end;
$$;

create or replace function public.protect_profile_privileges()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  new.role := old.role; new.organization_id := old.organization_id;
  new.is_org_admin := old.is_org_admin; new.is_active := old.is_active;
  new.is_machine := old.is_machine; new.login_activation_pending := old.login_activation_pending;
  new.registered_by := old.registered_by;
  return new;
end;
$$;

create function public.create_support_organization(p_name text, p_org_no text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if public.can_register_support_customer() is not true then raise exception 'Administratör med MFA krävs' using errcode='42501'; end if;
  if length(btrim(p_name)) not between 2 and 200 or length(coalesce(p_org_no,'')) > 30 then
    raise exception 'Ogiltiga företagsuppgifter' using errcode='22023';
  end if;
  insert into public.organizations(name,org_no) values(btrim(p_name),nullif(btrim(p_org_no),'')) returning id into result;
  return result;
end;
$$;

create policy profiles_select_support_customers on public.profiles for select to authenticated
  using (role = 'customer' and organization_id is not null and public.has_org_support_access(organization_id));

create function berryit_private.technician_eligible(p_user uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=p_user and p.is_active and not p.login_activation_pending and (
    p.role in ('technician','admin') or exists(
      select 1 from public.support_role_grants g
      join public.support_role_permissions rp on rp.role_key=g.role_key and rp.permission_key='tickets.write'
      where g.grantee_id=p.id and g.revoked_at is null and (g.expires_at is null or g.expires_at>now())
        and (g.scope='global' or (p_org is not null and g.organization_id=p_org))
    )
  ));
$$;
revoke all on function berryit_private.technician_eligible(uuid,uuid) from public,anon,authenticated;

create or replace function public.can_view_ticket(p_ticket_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tickets t where t.id=p_ticket_id and (
    public.is_staff() or public.has_org_support_access(t.organization_id)
    or (public.current_app_role()='customer' and t.requester_id=auth.uid()
      and (t.organization_id is null or t.organization_id=public.current_organization_id()))
    or (public.is_org_contact() and t.organization_id=public.current_organization_id())
  ));
$$;
drop policy tickets_select on public.tickets;
-- Keep this predicate on the candidate row: a STABLE helper looking up the
-- ticket cannot see a new row during INSERT ... RETURNING.
create policy tickets_select on public.tickets for select to authenticated using(
  public.is_staff() or public.has_org_support_access(organization_id)
  or (public.current_app_role()='customer' and requester_id=auth.uid()
    and (organization_id is null or organization_id=public.current_organization_id()))
  or (public.is_org_contact() and organization_id=public.current_organization_id())
);
create policy tickets_insert_support_scope on public.tickets for insert to authenticated
  with check (organization_id is not null and public.has_support_permission('tickets.write',organization_id));

create function public.support_ticket_technicians(p_ticket_id uuid)
returns table(id uuid,label text,is_external boolean,expires_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id,coalesce(nullif(p.full_name,''),p.email,'Tekniker'),
    exists(select 1 from public.support_role_grants g where g.grantee_id=p.id and g.is_external_consultant
      and g.organization_id=t.organization_id and g.revoked_at is null and g.expires_at>now()),
    (select max(g.expires_at) from public.support_role_grants g where g.grantee_id=p.id and g.is_external_consultant
      and g.organization_id=t.organization_id and g.revoked_at is null and g.expires_at>now())
  from public.tickets t cross join public.profiles p
  where t.id=p_ticket_id and public.can_work_ticket(t.id) and berryit_private.technician_eligible(p.id,t.organization_id)
  order by 2,p.id;
$$;
create function public.support_ticket_people(p_ticket_id uuid)
returns table(id uuid,label text) language sql stable security definer set search_path = '' as $$
  select p.id,coalesce(nullif(p.full_name,''),'Kund / tekniker') from public.tickets t
  join public.profiles p on p.id in (t.requester_id,t.assignee_id)
  where t.id=p_ticket_id and public.can_view_ticket(t.id);
$$;

create function public.guard_support_ticket_workflow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare customer_org uuid;
begin
  if tg_op='UPDATE' then
    if new.id is distinct from old.id or new.reference is distinct from old.reference
      or new.requester_id is distinct from old.requester_id or new.organization_id is distinct from old.organization_id
      or new.source is distinct from old.source or new.external_id is distinct from old.external_id
      or new.description is distinct from old.description or new.subject is distinct from old.subject
      or new.contact_name is distinct from old.contact_name or new.contact_email is distinct from old.contact_email
      or new.contact_phone is distinct from old.contact_phone or new.created_at is distinct from old.created_at then
      raise exception 'Ärendets kundidentitet och originaluppgifter är oföränderliga' using errcode='42501';
    end if;
  else
    select p.organization_id into customer_org from public.profiles p where p.id=new.requester_id and p.is_active;
    if not found then raise exception 'Kunden saknas eller är inaktiv' using errcode='42501'; end if;
    -- AI/API may use the acting technician as requester in their delegated
    -- scope. This is not permission to select another customer's identity.
    if new.organization_id is distinct from customer_org and not (
      new.source='api' and (public.is_trusted_backend() or
        (new.requester_id=auth.uid() and (public.is_staff() or public.has_support_permission('tickets.write',new.organization_id))))
    ) then
      raise exception 'Ärende och kund tillhör olika organisationer' using errcode='42501';
    end if;
    if auth.uid() is not null then
      new.reference:=null; new.created_at:=clock_timestamp();
      new.first_response_at:=null; new.resolved_at:=null; new.closed_at:=null;
    end if;
  end if;
  if new.assignee_id is not null and (tg_op='INSERT' or new.assignee_id is distinct from old.assignee_id)
    and not berryit_private.technician_eligible(new.assignee_id,new.organization_id) then
    raise exception 'Teknikern saknar aktiv behörighet i ärendets scope' using errcode='42501';
  end if;
  if tg_op='UPDATE' and old.status_key in ('lost','stangt') and new.status_key not in ('lost','stangt') then
    if length(btrim(coalesce(new.reopen_reason,''))) not between 3 and 1000 then
      raise exception 'Ange en orsak till återöppningen' using errcode='22023';
    end if;
  else new.reopen_reason:=null; end if;
  return new;
end;
$$;
create trigger tickets_a_workflow before insert or update on public.tickets
  for each row execute function public.guard_support_ticket_workflow();

-- Extend the existing append-only event writer; no historical event is edited.
create or replace function public.log_ticket_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='INSERT' then
    insert into public.ticket_events(ticket_id,actor_id,event_type,to_value)
      values(new.id,auth.uid(),'created',new.status_key);
    return new;
  end if;
  if new.status_key is distinct from old.status_key then
    insert into public.ticket_events(ticket_id,actor_id,event_type,from_value,to_value,payload)
      values(new.id,auth.uid(),'status_changed',old.status_key,new.status_key,
        case when old.status_key in ('lost','stangt') and new.status_key not in ('lost','stangt')
          then jsonb_build_object('reopened',true,'reason',new.reopen_reason) else '{}'::jsonb end);
    if new.status_key='lost' then new.resolved_at:=coalesce(old.resolved_at,now()); new.closed_at:=null; end if;
    if new.status_key='stangt' then new.closed_at:=coalesce(old.closed_at,now()); end if;
    if new.status_key not in ('lost','stangt') then new.resolved_at:=null; new.closed_at:=null; end if;
  end if;
  if new.priority_key is distinct from old.priority_key then
    insert into public.ticket_events(ticket_id,actor_id,event_type,from_value,to_value) values(new.id,auth.uid(),'priority_changed',old.priority_key,new.priority_key);
  end if;
  if new.category_key is distinct from old.category_key then
    insert into public.ticket_events(ticket_id,actor_id,event_type,from_value,to_value) values(new.id,auth.uid(),'category_changed',old.category_key,new.category_key);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.ticket_events(ticket_id,actor_id,event_type,from_value,to_value) values(new.id,auth.uid(),'assigned',old.assignee_id::text,new.assignee_id::text);
  end if;
  return new;
end;
$$;
revoke update on public.tickets from authenticated;
grant update(status_key,priority_key,category_key,assignee_id,reopen_reason) on public.tickets to authenticated;

create function public.reopen_support_ticket(p_ticket_id uuid,p_reason text)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid;
begin
  update public.tickets set status_key='pagar',reopen_reason=p_reason
    where id=p_ticket_id and status_key in ('lost','stangt') and public.can_work_ticket(id) returning id into result;
  if result is null then raise exception 'Ärendet kan inte återöppnas' using errcode='42501'; end if;
  return result;
end;
$$;

create function public.guard_support_attachment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare object_exists boolean;
begin
  if tg_op='UPDATE' then
    if (to_jsonb(new)-'upload_completed_at') is distinct from (to_jsonb(old)-'upload_completed_at') then
      raise exception 'Bilagans identitet och synlighet är oföränderliga' using errcode='42501';
    end if;
    return new;
  end if;
  if new.storage_path !~ ('^tickets/'||new.ticket_id::text||'/[^/]+$')
    or split_part(new.storage_path,'/',3) in ('.','..')
    or (new.message_id is not null and not exists(select 1 from public.ticket_messages where id=new.message_id and ticket_id=new.ticket_id)) then
    raise exception 'Bilagans sökväg eller meddelande hör till ett annat ärende' using errcode='42501';
  end if;
  if auth.role()='authenticated' then
    new.upload_completed_at:=null;
    if to_regclass('storage.objects') is not null then
      execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into object_exists
        using 'ticket-attachments',new.storage_path;
      if object_exists then raise exception 'Registrera metadata före ny uppladdning' using errcode='42501'; end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger ticket_attachments_workflow before insert or update on public.ticket_attachments
  for each row execute function public.guard_support_attachment();

-- Also contain malformed historical metadata without deleting customer data.
create policy ticket_attachments_bound on public.ticket_attachments as restrictive for select to authenticated using (
  storage_path ~ ('^tickets/'||ticket_id::text||'/[^/]+$')
  and split_part(storage_path,'/',3) not in ('.','..')
  and (message_id is null or exists(select 1 from public.ticket_messages m where m.id=ticket_attachments.message_id and m.ticket_id=ticket_attachments.ticket_id))
);

create function public.complete_support_attachment(p_attachment_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare attachment public.ticket_attachments; object_exists boolean; completed timestamptz;
begin
  select * into attachment from public.ticket_attachments where id=p_attachment_id for update;
  if not found or attachment.uploaded_by is distinct from auth.uid()
    or attachment.storage_path !~ ('^tickets/'||attachment.ticket_id::text||'/[^/]+$')
    or split_part(attachment.storage_path,'/',3) in ('.','..')
    or (attachment.message_id is not null and not exists(select 1 from public.ticket_messages m where m.id=attachment.message_id and m.ticket_id=attachment.ticket_id))
    or not public.can_view_ticket(attachment.ticket_id)
    or (attachment.visibility='internal' and not public.can_work_ticket(attachment.ticket_id)) then
    raise exception 'Bilagan är inte tillgänglig' using errcode='42501';
  end if;
  if to_regclass('storage.objects') is null then raise exception 'Storage är inte ansluten' using errcode='55000'; end if;
  execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into object_exists
    using 'ticket-attachments',attachment.storage_path;
  if not object_exists then raise exception 'Uppladdningen är inte slutförd' using errcode='55000'; end if;
  completed:=coalesce(attachment.upload_completed_at,clock_timestamp());
  if attachment.upload_completed_at is null then
    update public.ticket_attachments set upload_completed_at=completed where id=attachment.id;
    insert into public.ticket_events(ticket_id,actor_id,event_type,payload)
      values(attachment.ticket_id,auth.uid(),'attachment_added',jsonb_build_object('attachment_id',attachment.id,'visibility',attachment.visibility,'phase','uploaded'));
  end if;
  return completed;
end;
$$;

create function public.audit_support_attachment_access(p_attachment_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare attachment public.ticket_attachments; org uuid;
begin
  select * into attachment from public.ticket_attachments where id=p_attachment_id;
  if not found or attachment.upload_completed_at is null or not public.can_view_ticket(attachment.ticket_id)
    or attachment.storage_path !~ ('^tickets/'||attachment.ticket_id::text||'/[^/]+$')
    or split_part(attachment.storage_path,'/',3) in ('.','..')
    or (attachment.message_id is not null and not exists(select 1 from public.ticket_messages m where m.id=attachment.message_id and m.ticket_id=attachment.ticket_id))
    or (attachment.visibility='internal' and not public.can_work_ticket(attachment.ticket_id)) then
    raise exception 'Bilagan är inte tillgänglig' using errcode='42501';
  end if;
  select organization_id into org from public.tickets where id=attachment.ticket_id;
  insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason)
    values(auth.uid(),'attachment_download_requested','ticket_attachment',attachment.id::text,
      case when org is null then 'global'::public.support_scope else 'organization'::public.support_scope end,org,'Begäran om behörig bilaga');
  return attachment.storage_path;
end;
$$;

revoke update,delete on public.ticket_internal_notes from authenticated;
drop policy ticket_events_select on public.ticket_events;
create policy ticket_events_select on public.ticket_events for select to authenticated using (
  public.can_work_ticket(ticket_id) or (public.can_view_ticket(ticket_id)
    and event_type in ('created','status_changed','customer_message','attachment_added')
    and (event_type<>'attachment_added' or payload->>'visibility'='customer'))
);

create function public.audit_support_registry_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason)
  values(auth.uid(),tg_table_name||'_'||lower(tg_op),tg_table_name,new.id::text,
    case when tg_table_name='organizations' then 'organization'::public.support_scope else 'global'::public.support_scope end,
    case when tg_table_name='organizations' then new.id else null end,'Manuell registerändring');
  return new;
end;
$$;
create trigger support_organizations_audit after insert or update on public.organizations
  for each row execute function public.audit_support_registry_changes();
create trigger support_profiles_audit after update on public.profiles
  for each row when(old is distinct from new) execute function public.audit_support_registry_changes();

-- Only metadata-owned new uploads; old valid objects retain their read policy.
do $$ begin
  if to_regclass('storage.objects') is null then return; end if;
  execute $policy$create policy support_ticket_upload_owned on storage.objects as restrictive for insert to authenticated
    with check(bucket_id<>'ticket-attachments' or name not like 'tickets/%' or exists(
      select 1 from public.ticket_attachments a where a.storage_path=storage.objects.name
        and a.uploaded_by=auth.uid() and a.storage_path like 'tickets/'||a.ticket_id::text||'/%'
        and public.can_view_ticket(a.ticket_id) and (a.visibility='customer' or public.can_work_ticket(a.ticket_id))
    ))$policy$;
  -- Existing object presence is observed now; do not invent its upload time.
  execute 'update public.ticket_attachments a set upload_completed_at=coalesce(a.upload_completed_at,clock_timestamp())
    where exists(select 1 from storage.objects o where o.bucket_id=''ticket-attachments'' and o.name=a.storage_path)';
end; $$;

revoke all on function public.can_register_support_customer(),public.support_registration_context(uuid),
  public.create_support_organization(text,text),public.support_ticket_technicians(uuid),public.support_ticket_people(uuid),
  public.reopen_support_ticket(uuid,text),public.complete_support_attachment(uuid),public.audit_support_attachment_access(uuid)
  from public,anon;
grant execute on function public.can_register_support_customer(),public.support_registration_context(uuid),
  public.create_support_organization(text,text),public.support_ticket_technicians(uuid),public.support_ticket_people(uuid),
  public.reopen_support_ticket(uuid,text),public.complete_support_attachment(uuid),public.audit_support_attachment_access(uuid)
  to authenticated;
revoke all on function public.guard_support_ticket_workflow(),public.guard_support_attachment(),
  public.audit_support_registry_changes() from public,anon,authenticated;
