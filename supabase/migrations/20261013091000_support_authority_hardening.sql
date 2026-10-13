-- BERRYiT Helpdesk Support – PASS 1A: härdning av auktoritetsmodellen.
--
-- Tre brister från PASS 1 åtgärdas:
--
--  1. Rättighetshöjning: den som hade roles.grant för EN organisation kunde dela
--     ut vilken roll som helst, även global superadministratör. Nu får ingen dela
--     ut en roll med högre eller samma rang som sin egen, och endast en global
--     superadministratör kan dela ut globala roller.
--  2. Tilldelningar gick att ändra i efterhand (roll, scope, organisation,
--     giltighetstid). Nu är de oföränderliga – en uppdatering får bara återkalla.
--  3. Delegerad tekniker kunde ändra ärendet men varken svara, skriva intern
--     anteckning eller bifoga fil, eftersom de kontrollerna krävde global
--     behörighet. Nu styrs de av scope-medveten behörighet.

-- Får inloggad användare arbeta i ärendet (svara, anteckna, bifoga)?
create or replace function public.can_work_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.tickets t
     where t.id = p_ticket_id
       and (public.is_staff() or public.has_support_permission('tickets.write', t.organization_id))
  );
$$;

-- Högsta rang användaren själv innehar (via aktiva tilldelningar).
create or replace function public.max_support_rank(p_user uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(r.rank), 0)::smallint
    from public.active_support_grants(p_user) g
    join public.support_roles r on r.key = g.role_key;
$$;

-- --------------------------------------------- scope-medveten ärendehantering

drop policy ticket_messages_insert_staff on public.ticket_messages;
create policy ticket_messages_insert_staff on public.ticket_messages
  for insert to authenticated
  with check (public.can_work_ticket(ticket_id) and author_id = auth.uid() and is_from_staff = true);

drop policy ticket_internal_notes_staff_select on public.ticket_internal_notes;
create policy ticket_internal_notes_staff_select on public.ticket_internal_notes
  for select to authenticated
  using (public.can_work_ticket(ticket_id));

drop policy ticket_internal_notes_staff_insert on public.ticket_internal_notes;
create policy ticket_internal_notes_staff_insert on public.ticket_internal_notes
  for insert to authenticated
  with check (public.can_work_ticket(ticket_id) and author_id = auth.uid());

drop policy ticket_internal_notes_author_update on public.ticket_internal_notes;
create policy ticket_internal_notes_author_update on public.ticket_internal_notes
  for update to authenticated
  using (public.can_work_ticket(ticket_id) and author_id = auth.uid())
  with check (public.can_work_ticket(ticket_id) and author_id = auth.uid());

drop policy ticket_attachments_insert_staff on public.ticket_attachments;
create policy ticket_attachments_insert_staff on public.ticket_attachments
  for insert to authenticated
  with check (public.can_work_ticket(ticket_id) and uploaded_by = auth.uid());

drop policy ticket_attachments_delete_staff on public.ticket_attachments;
create policy ticket_attachments_delete_staff on public.ticket_attachments
  for delete to authenticated
  using (public.can_work_ticket(ticket_id));

-- Personal ser interna bilagor i sitt scope, kunden bara kundsynliga.
drop policy ticket_attachments_select on public.ticket_attachments;
create policy ticket_attachments_select on public.ticket_attachments
  for select to authenticated
  using (
    public.can_work_ticket(ticket_id)
    or (visibility = 'customer' and public.can_view_ticket(ticket_id))
  );

-- ------------------------------------------------- skydd mot rättighetshöjning

create or replace function public.guard_support_role_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  granter uuid := auth.uid();
  granter_rank smallint;
  target_rank smallint;
begin
  -- Ingen JWT = service_role eller direkt SQL (plattformsägaren). Dessa sätter
  -- den första superadministratören och kringgår RLS redan i dag.
  if granter is null then
    return new;
  end if;

  select r.rank into target_rank from public.support_roles r where r.key = new.role_key;
  granter_rank := public.max_support_rank(granter);

  if tg_op = 'INSERT' then
    -- Globala roller delas endast ut av en global superadministratör.
    if new.scope = 'global' and not public.is_support_super_admin() then
      raise exception 'Endast global superadministratör kan dela ut globala roller'
        using errcode = 'insufficient_privilege';
    end if;

    -- Man kan aldrig dela ut sin egen rang eller högre.
    if target_rank >= granter_rank and not public.is_support_super_admin() then
      raise exception 'Kan inte dela ut en roll med samma eller högre rang än den egna'
        using errcode = 'insufficient_privilege';
    end if;

    if new.granted_by is distinct from granter then
      raise exception 'granted_by måste vara den som utför tilldelningen'
        using errcode = 'insufficient_privilege';
    end if;

    return new;
  end if;

  -- UPDATE: endast återkallelse är tillåten, aldrig omskrivning av tilldelningen.
  if new.grantee_id is distinct from old.grantee_id
     or new.role_key is distinct from old.role_key
     or new.scope is distinct from old.scope
     or new.organization_id is distinct from old.organization_id
     or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at
     or new.expires_at is distinct from old.expires_at
     or new.reason is distinct from old.reason then
    raise exception 'En tilldelning kan inte ändras i efterhand – återkalla och skapa en ny'
      using errcode = 'insufficient_privilege';
  end if;

  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'En återkallad tilldelning kan inte återaktiveras'
      using errcode = 'insufficient_privilege';
  end if;

  if new.revoked_at is not null and new.revoked_by is distinct from granter then
    raise exception 'revoked_by måste vara den som utför återkallelsen'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger support_role_grants_guard before insert or update on public.support_role_grants
  for each row execute function public.guard_support_role_grant();

-- Samma princip för ONARLY-rättigheter: bevilja eller återkalla, inte skriva om.
create or replace function public.guard_onarly_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.granted_by is distinct from auth.uid() then
      raise exception 'granted_by måste vara den som utför beviljandet'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
     or new.product_key is distinct from old.product_key
     or new.entitlement is distinct from old.entitlement
     or new.granted_by is distinct from old.granted_by
     or new.granted_at is distinct from old.granted_at
     or new.reason is distinct from old.reason then
    raise exception 'En rättighet kan inte ändras i efterhand – återkalla och bevilja på nytt'
      using errcode = 'insufficient_privilege';
  end if;

  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'En återkallad rättighet kan inte återaktiveras'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger onarly_entitlements_guard before insert or update on public.onarly_support_entitlements
  for each row execute function public.guard_onarly_entitlement();

-- Revisionen är append-only även för den som har audit.read: inga skrivrättigheter
-- och inga policies för insert/update/delete finns för rollen authenticated.
revoke insert, update, delete on public.support_admin_audit from authenticated;
revoke insert, update, delete on public.ticket_events from authenticated;
