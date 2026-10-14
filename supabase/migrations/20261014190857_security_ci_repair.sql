-- Forward-only repair. Historical migrations remain unchanged; no data is deleted.
-- active_support_grants is an implementation helper, not a directory of users.
create or replace function public.active_support_grants(p_user uuid)
returns table (role_key text, scope public.support_scope, organization_id uuid)
language sql stable security definer set search_path = ''
as $$
  select g.role_key, g.scope, g.organization_id
  from public.support_role_grants g
  join public.profiles p on p.id = g.grantee_id and p.is_active
  where g.grantee_id = p_user
    and (
      p_user = auth.uid()
      or auth.role() = 'service_role'
      -- Direct maintenance SQL only. A SET ROLE/API caller cannot use this path.
      or (auth.role() is null and auth.uid() is null
          and session_user not in ('anon', 'authenticated', 'authenticator')
          and coalesce(current_setting('role', true), '') not in ('anon', 'authenticated', 'authenticator'))
    )
    and g.revoked_at is null and (g.expires_at is null or g.expires_at > now());
$$;
revoke all on function public.active_support_grants(uuid) from public, anon;
grant execute on function public.active_support_grants(uuid) to authenticated, service_role;
-- This wrapper must not provide an anonymous side door to the helper either.
revoke all on function public.max_support_rank(uuid) from public, anon;
grant execute on function public.max_support_rank(uuid) to authenticated, service_role;

create or replace function public.can_view_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.comm_conversations c where c.id = p_conversation_id and (
      public.is_staff() or public.has_support_permission('tickets.read', c.organization_id)
      or (not c.is_internal and c.organization_id = public.current_organization_id()
          and (public.is_org_contact() or exists (
            select 1 from public.comm_participants p
            where p.conversation_id = c.id and p.organization_id = c.organization_id
              and p.profile_id = auth.uid() and p.participant_role = 'customer'
          )))
    )
  );
$$;
create or replace function public.can_write_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.comm_conversations c where c.id = p_conversation_id and c.status <> 'closed' and (
      public.is_staff() or public.has_support_permission('tickets.write', c.organization_id)
      or (not c.is_internal and c.organization_id = public.current_organization_id() and exists (
        select 1 from public.comm_participants p
        where p.conversation_id = c.id and p.organization_id = c.organization_id
          and p.profile_id = auth.uid() and p.participant_role = 'customer'
      ))
    )
  );
$$;
revoke all on function public.can_view_conversation(uuid), public.can_write_conversation(uuid) from public, anon;
grant execute on function public.can_view_conversation(uuid), public.can_write_conversation(uuid) to authenticated, service_role;

-- Membership never grants staff authority. Validate new members even for adapters;
-- re-check current organisation on every read/write to contain old bad rows.
create function public.guard_comm_participant()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - 'last_read_at') is distinct from (to_jsonb(old) - 'last_read_at') then
      raise exception 'Only the read marker can change' using errcode = '42501';
    end if;
  elsif new.profile_id is not null and not exists (
    select 1 from public.profiles p where p.id = new.profile_id and p.is_active and (
      (p.organization_id = new.organization_id and new.participant_role = 'customer')
      or (new.participant_role = 'staff' and (
        p.role in ('technician', 'admin') or exists (
          select 1 from public.support_role_grants g
          join public.support_role_permissions rp on rp.role_key = g.role_key
          where g.grantee_id = p.id and g.revoked_at is null
            and (g.expires_at is null or g.expires_at > now())
            and (g.scope = 'global' or g.organization_id = new.organization_id)
            and rp.permission_key = 'tickets.read'
        )
      ))
    )
  ) then
    raise exception 'Participant identity outside organisation or support scope' using errcode = '42501';
  end if;
  if new.profile_id is null and new.participant_role <> 'external' then
    raise exception 'An address is an external participant' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_comm_participant() from public, anon, authenticated;
create trigger comm_participants_identity before insert or update on public.comm_participants
  for each row execute function public.guard_comm_participant();

drop policy comm_participants_insert on public.comm_participants;
create policy comm_participants_insert on public.comm_participants for insert to authenticated
  with check (public.can_write_conversation(conversation_id)
    and (public.is_staff() or public.has_support_permission('tickets.write', organization_id)));
revoke update on public.comm_participants from authenticated;
grant update (last_read_at) on public.comm_participants to authenticated;
drop policy comm_participants_update on public.comm_participants;
create policy comm_participants_update on public.comm_participants for update to authenticated
  using (profile_id = auth.uid() and public.can_view_conversation(conversation_id))
  with check (profile_id = auth.uid() and public.can_view_conversation(conversation_id));

drop policy comm_messages_select on public.comm_messages;
create policy comm_messages_select on public.comm_messages for select to authenticated
  using (public.can_view_conversation(conversation_id) and (
    direction <> 'internal' or public.is_staff() or public.has_support_permission('tickets.read', organization_id)
  ));
drop policy comm_messages_insert on public.comm_messages;
create policy comm_messages_insert on public.comm_messages for insert to authenticated
  with check (public.can_write_conversation(conversation_id) and author_id = auth.uid()
    and direction in ('outbound', 'internal') and delivery_status in ('draft', 'queued')
    and external_message_id is null
    and (direction <> 'internal' or public.is_staff() or public.has_support_permission('tickets.write', organization_id)));

-- Bind metadata to its actual conversation and message, not just their organisation.
create function public.comm_attachment_matches(p_path text, p_conversation uuid, p_message uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (auth.role() = 'service_role' or public.can_view_conversation(p_conversation))
    and p_path ~ ('^conversations/' || p_conversation::text || '/[^/]+$')
    and split_part(p_path, '/', 3) not in ('.', '..')
    and (p_message is null or exists (
      select 1 from public.comm_messages m where m.id = p_message and m.conversation_id = p_conversation
        and (m.direction <> 'internal' or auth.role() = 'service_role' or public.is_staff()
          or public.has_support_permission('tickets.read', m.organization_id))
    ));
$$;
revoke all on function public.comm_attachment_matches(text, uuid, uuid) from public, anon;
grant execute on function public.comm_attachment_matches(text, uuid, uuid) to authenticated, service_role;

drop policy comm_attachments_select on public.comm_attachments;
create policy comm_attachments_select on public.comm_attachments for select to authenticated
  using (public.can_view_conversation(conversation_id)
    and public.comm_attachment_matches(storage_path, conversation_id, message_id)
    and (public.is_staff() or public.has_support_permission('tickets.read', organization_id)
      or (visibility = 'customer' and (message_id is null or exists (
        select 1 from public.comm_messages m where m.id = message_id
          and m.conversation_id = comm_attachments.conversation_id and m.direction <> 'internal'
      )))));
drop policy comm_attachments_insert on public.comm_attachments;
create policy comm_attachments_insert on public.comm_attachments for insert to authenticated
  with check (public.can_write_conversation(conversation_id) and uploaded_by = auth.uid()
    and public.comm_attachment_matches(storage_path, conversation_id, message_id)
    and (public.is_staff() or public.has_support_permission('tickets.write', organization_id)
      or (visibility = 'customer' and (message_id is null or exists (
        select 1 from public.comm_messages m where m.id = message_id
          and m.conversation_id = comm_attachments.conversation_id and m.direction <> 'internal'
      )))));

-- Client metadata must precede upload. Otherwise a customer could claim a
-- pre-existing orphan object whose path they know. Trusted importers retain
-- their explicit backend path; no object is deleted or reclassified here.
create function public.guard_comm_attachment_upload()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare object_exists boolean;
begin
  if auth.role() = 'authenticated' and to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2)'
      into object_exists using 'ticket-attachments', new.storage_path;
    if object_exists then
      raise exception 'Register attachment metadata before uploading a new object' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_comm_attachment_upload() from public, anon, authenticated;
create trigger comm_attachments_upload_identity before insert on public.comm_attachments
  for each row execute function public.guard_comm_attachment_upload();

-- Private object reads require visible metadata, including for staff. No orphan
-- object or customer-labelled alias can expose an internal message's attachment.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'Storage absent: validate these policies in the isolated Storage fixture';
    return;
  end if;
  execute 'drop policy if exists ticket_attachments_read on storage.objects';
  execute 'drop policy if exists ticket_attachments_upload on storage.objects';
  execute 'drop policy if exists ticket_attachments_staff_delete on storage.objects';
  -- Restrictive policies also constrain any older permissive platform policy.
  -- Other buckets keep their own permissions; service_role keeps BYPASSRLS.
  execute $policy$
    create policy ticket_attachments_access on storage.objects for all to authenticated
    using (bucket_id = 'ticket-attachments') with check (bucket_id = 'ticket-attachments')
  $policy$;
  execute $policy$
    create policy ticket_attachments_read on storage.objects as restrictive for select to authenticated
    using (bucket_id <> 'ticket-attachments' or (
      exists (select 1 from public.ticket_attachments a where a.storage_path = storage.objects.name
        and a.storage_path like 'tickets/' || a.ticket_id::text || '/%')
      or exists (select 1 from public.comm_attachments a where a.storage_path = storage.objects.name)
    ))
  $policy$;
  execute $policy$
    create policy ticket_attachments_upload on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'ticket-attachments' or (
      exists (select 1 from public.tickets t
        where name like 'tickets/' || t.id::text || '/%'
          and public.can_view_ticket(t.id))
      or exists (select 1 from public.comm_attachments a
        where a.storage_path = storage.objects.name and a.uploaded_by = auth.uid()
          and public.can_write_conversation(a.conversation_id))
    ))
  $policy$;
  execute $policy$
    create policy ticket_attachments_staff_delete on storage.objects as restrictive for delete to authenticated
    using (bucket_id <> 'ticket-attachments' or (
      exists (select 1 from public.ticket_attachments a where a.storage_path = storage.objects.name
        and public.can_work_ticket(a.ticket_id))
      or exists (select 1 from public.comm_attachments a where a.storage_path = storage.objects.name
        and public.can_write_conversation(a.conversation_id)
        and (public.is_staff() or public.has_support_permission('tickets.write', a.organization_id)))
    ))
  $policy$;
  execute $policy$
    create policy ticket_attachments_no_overwrite on storage.objects as restrictive for update to authenticated
    using (bucket_id <> 'ticket-attachments') with check (bucket_id <> 'ticket-attachments')
  $policy$;
  execute $policy$
    create policy ticket_attachments_no_anonymous on storage.objects as restrictive for all to anon
    using (bucket_id <> 'ticket-attachments') with check (bucket_id <> 'ticket-attachments')
  $policy$;
end;
$$;

create index comm_messages_page_idx on public.comm_messages (conversation_id, created_at, id);
