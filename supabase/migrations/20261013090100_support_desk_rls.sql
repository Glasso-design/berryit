-- BERRYiT Support Desk – PASS 1: roller, behörigheter och RLS-policies.
--
-- Roller:
--   customer   – ser endast sitt eget konto och sina egna ärenden. Organisationens
--                kontaktperson (is_org_admin) ser hela organisationens ärenden.
--   technician – ser och arbetar med alla ärenden.
--   admin      – som technician + administrerar profiler, organisationer och uppslag.
--
-- Interna anteckningar har INGEN policy för customer-rollen. Det finns alltså
-- ingen väg till dem via PostgREST oavsett vilket id som gissas.

-- --------------------------------------------------------- hjälpfunktioner
-- SECURITY DEFINER: slår upp den inloggades roll utan att trigga RLS på profiles
-- (vilket annars ger rekursion när profiles-policyn själv behöver rollen).

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('technician', 'admin'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

create or replace function public.is_org_contact()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_org_admin from public.profiles p where p.id = auth.uid() and p.is_active), false);
$$;

-- Ett ärende är synligt för: personal, ärendets beställare, eller organisationens
-- kontaktperson. Används av underordnade tabeller (meddelanden, bilagor, historik).
create or replace function public.can_view_ticket(p_ticket_id uuid)
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
       and (
         public.is_staff()
         or t.requester_id = auth.uid()
         or (
           public.is_org_contact()
           and t.organization_id is not null
           and t.organization_id = public.current_organization_id()
         )
       )
  );
$$;

-- Kunden får bara svara så länge ärendet inte är stängt.
create or replace function public.ticket_accepts_customer_reply(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t where t.id = p_ticket_id and t.status_key <> 'stangt'
  );
$$;

-- ------------------------------------------------------------- behörigheter

revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

grant select on public.ticket_statuses, public.ticket_priorities, public.ticket_categories to authenticated;
grant select on public.organizations, public.profiles, public.ticket_events to authenticated;
grant select, insert, update on public.tickets to authenticated;
grant select, insert on public.ticket_messages to authenticated;
grant select, insert, update, delete on public.ticket_internal_notes to authenticated;
grant select, insert, delete on public.ticket_attachments to authenticated;
grant update on public.profiles to authenticated;
grant insert, update on public.organizations to authenticated;
grant update, insert, delete on public.ticket_statuses, public.ticket_priorities, public.ticket_categories to authenticated;

-- --------------------------------------------------------------- uppslag
-- Alla inloggade läser listorna; endast admin ändrar dem.

create policy ticket_statuses_select on public.ticket_statuses
  for select to authenticated using (true);
create policy ticket_statuses_admin on public.ticket_statuses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy ticket_priorities_select on public.ticket_priorities
  for select to authenticated using (true);
create policy ticket_priorities_admin on public.ticket_priorities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy ticket_categories_select on public.ticket_categories
  for select to authenticated using (true);
create policy ticket_categories_admin on public.ticket_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --------------------------------------------------------- organisationer

create policy organizations_select on public.organizations
  for select to authenticated
  using (public.is_staff() or id = public.current_organization_id());

create policy organizations_admin_write on public.organizations
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- profiler

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_staff()
    or (
      public.is_org_contact()
      and organization_id is not null
      and organization_id = public.current_organization_id()
    )
  );

-- Egen profil får uppdateras; trigger nedan skyddar roll/organisation.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Rollbyte, organisationsbyte och org-admin kan bara sättas av admin.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Ingen JWT = service_role eller direkt SQL (administration) – dessa är redan
  -- betrodda och kringgår RLS. Inloggade användare måste vara admin.
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  new.role := old.role;
  new.organization_id := old.organization_id;
  new.is_org_admin := old.is_org_admin;
  new.is_active := old.is_active;
  return new;
end;
$$;

create trigger profiles_protect_privileges before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- Ny inloggad användare får automatiskt en kundprofil.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ----------------------------------------------------------------- ärenden

create policy tickets_select on public.tickets
  for select to authenticated
  using (
    public.is_staff()
    or requester_id = auth.uid()
    or (
      public.is_org_contact()
      and organization_id is not null
      and organization_id = public.current_organization_id()
    )
  );

-- Kunden skapar ärenden i eget namn, alltid som nytt och otilldelat.
create policy tickets_insert_customer on public.tickets
  for insert to authenticated
  with check (
    not public.is_staff()
    and requester_id = auth.uid()
    and status_key = 'mottaget'
    and assignee_id is null
    and source = 'portal'
    and external_id is null
    and (organization_id is null or organization_id = public.current_organization_id())
  );

create policy tickets_insert_staff on public.tickets
  for insert to authenticated
  with check (public.is_staff());

-- Endast personal ändrar status, prioritet, kategori och tilldelning.
create policy tickets_update_staff on public.tickets
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy tickets_delete_admin on public.tickets
  for delete to authenticated
  using (public.is_admin());

-- ------------------------------------------------------- kundkonversation

create policy ticket_messages_select on public.ticket_messages
  for select to authenticated
  using (public.can_view_ticket(ticket_id));

create policy ticket_messages_insert_customer on public.ticket_messages
  for insert to authenticated
  with check (
    not public.is_staff()
    and author_id = auth.uid()
    and is_from_staff = false
    and public.can_view_ticket(ticket_id)
    and public.ticket_accepts_customer_reply(ticket_id)
  );

create policy ticket_messages_insert_staff on public.ticket_messages
  for insert to authenticated
  with check (public.is_staff() and author_id = auth.uid() and is_from_staff = true);

-- Inga update/delete-policies: konversationen är oföränderlig.

-- ----------------------------------------------------- interna anteckningar
-- Endast personal. Customer-rollen saknar policy helt och ser därför ingenting.

create policy ticket_internal_notes_staff_select on public.ticket_internal_notes
  for select to authenticated using (public.is_staff());

create policy ticket_internal_notes_staff_insert on public.ticket_internal_notes
  for insert to authenticated with check (public.is_staff() and author_id = auth.uid());

create policy ticket_internal_notes_author_update on public.ticket_internal_notes
  for update to authenticated
  using (public.is_staff() and author_id = auth.uid())
  with check (public.is_staff() and author_id = auth.uid());

create policy ticket_internal_notes_admin_delete on public.ticket_internal_notes
  for delete to authenticated using (public.is_admin());

-- ----------------------------------------------------------------- bilagor

create policy ticket_attachments_select on public.ticket_attachments
  for select to authenticated
  using (
    public.is_staff()
    or (visibility = 'customer' and public.can_view_ticket(ticket_id))
  );

create policy ticket_attachments_insert_customer on public.ticket_attachments
  for insert to authenticated
  with check (
    not public.is_staff()
    and uploaded_by = auth.uid()
    and visibility = 'customer'
    and public.can_view_ticket(ticket_id)
    and public.ticket_accepts_customer_reply(ticket_id)
  );

create policy ticket_attachments_insert_staff on public.ticket_attachments
  for insert to authenticated
  with check (public.is_staff() and uploaded_by = auth.uid());

create policy ticket_attachments_delete_staff on public.ticket_attachments
  for delete to authenticated using (public.is_staff());

-- ---------------------------------------------------------------- historik
-- Kunden ser sin egen ärendehistorik, men inte att interna anteckningar finns.

create policy ticket_events_select on public.ticket_events
  for select to authenticated
  using (
    public.is_staff()
    or (
      public.can_view_ticket(ticket_id)
      and event_type in ('created', 'status_changed', 'customer_message', 'attachment_added')
    )
  );

-- Inga insert-policies: historik skrivs enbart av triggers (security definer).
