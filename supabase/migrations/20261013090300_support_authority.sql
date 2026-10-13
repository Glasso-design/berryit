-- BERRYiT Helpdesk Support – PASS 1: central supportauktoritet (ägarbeslut 2026-10-13).
--
-- BERRYiT är supportauktoritet för BERRYiT och ONARLY-ekosystemet. Behörighet
-- bestäms av tilldelningar (grants) i databasen, aldrig av frontend:
--
--   support_permissions       vad som går att tillåta (scopes)
--   support_roles             roller, t.ex. BERRYIT_SUPPORT_SUPER_ADMIN
--   support_role_permissions  vilka scopes en roll ger
--   support_role_grants       vem som har vilken roll, globalt eller per kundorganisation
--   support_admin_audit       vem som gjorde vad, mot vem, i vilket scope och varför
--   onarly_support_entitlements  ONARLY DESK-rättigheter per kundorganisation
--
-- Återkallelse slår igenom direkt: varje behörighetskontroll läser aktiva grants
-- vid frågetillfället. En redan utfärdad JWT ger därför ingen kvarvarande åtkomst.
--
-- INTE implementerat här (medvetet, ingen attrapp): köer/eskaleringsmotor,
-- anrop mot ONARLY DESK och fjärrsessioner. Tabellerna nedan är auktoritetens
-- register – körtidsintegrationen kräver separat ägargodkännande.

-- ------------------------------------------------------------ scopes/roller

create table public.support_permissions (
  key text primary key,
  description text not null,
  constraint support_permissions_key_format check (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$')
);

create table public.support_roles (
  key text primary key,
  label text not null,
  rank smallint not null,
  is_system boolean not null default true,
  constraint support_roles_key_format check (key ~ '^[A-Z0-9_]{3,64}$')
);

create table public.support_role_permissions (
  role_key text not null references public.support_roles (key) on update cascade on delete cascade,
  permission_key text not null references public.support_permissions (key) on update cascade on delete cascade,
  primary key (role_key, permission_key)
);

insert into public.support_permissions (key, description) values
  ('tickets.read',               'Läsa supportärenden inom sitt scope'),
  ('tickets.write',              'Svara, ändra status/prioritet och tilldela inom sitt scope'),
  ('tickets.reassign',           'Flytta ärenden mellan tekniker och organisationer'),
  ('organizations.manage',       'Administrera kundorganisationer'),
  ('technicians.manage',         'Administrera tekniker och deras uppdrag'),
  ('roles.grant',                'Tilldela och återkalla supportroller'),
  ('onarly.entitlements.manage', 'Bevilja och återkalla ONARLY DESK-rättigheter'),
  ('escalation.configure',       'Konfigurera eskaleringsregler och servicekoer'),
  ('audit.read',                 'Läsa administrativ revisionshistorik');

insert into public.support_roles (key, label, rank) values
  ('BERRYIT_SUPPORT_SUPER_ADMIN', 'Support – superadministratör', 100),
  ('BERRYIT_SUPPORT_ADMIN',       'Support – administratör',       80),
  ('BERRYIT_SUPPORT_TECHNICIAN',  'Supporttekniker',               50);

insert into public.support_role_permissions (role_key, permission_key)
select 'BERRYIT_SUPPORT_SUPER_ADMIN', key from public.support_permissions;

insert into public.support_role_permissions (role_key, permission_key) values
  ('BERRYIT_SUPPORT_ADMIN', 'tickets.read'),
  ('BERRYIT_SUPPORT_ADMIN', 'tickets.write'),
  ('BERRYIT_SUPPORT_ADMIN', 'tickets.reassign'),
  ('BERRYIT_SUPPORT_ADMIN', 'organizations.manage'),
  ('BERRYIT_SUPPORT_ADMIN', 'technicians.manage'),
  ('BERRYIT_SUPPORT_ADMIN', 'audit.read'),
  ('BERRYIT_SUPPORT_TECHNICIAN', 'tickets.read'),
  ('BERRYIT_SUPPORT_TECHNICIAN', 'tickets.write');

-- ------------------------------------------------------------------ grants
-- scope = global (hela supportverksamheten) eller organization (en kund).

create type public.support_scope as enum ('global', 'organization');

create table public.support_role_grants (
  id uuid primary key default gen_random_uuid(),
  grantee_id uuid not null references public.profiles (id) on delete cascade,
  role_key text not null references public.support_roles (key) on update cascade on delete restrict,
  scope public.support_scope not null default 'global',
  organization_id uuid references public.organizations (id) on delete cascade,
  reason text not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  revoke_reason text,
  constraint support_role_grants_scope_org check (
    (scope = 'organization' and organization_id is not null)
    or (scope = 'global' and organization_id is null)
  ),
  constraint support_role_grants_reason_not_blank check (btrim(reason) <> ''),
  constraint support_role_grants_revoked_pair check (
    (revoked_at is null and revoke_reason is null)
    or (revoked_at is not null and btrim(coalesce(revoke_reason, '')) <> '')
  ),
  constraint support_role_grants_expiry_after_grant check (expires_at is null or expires_at > granted_at)
);

-- Samma roll ska inte kunna beviljas två gånger i samma scope samtidigt.
create unique index support_role_grants_active_global_idx
  on public.support_role_grants (grantee_id, role_key)
  where revoked_at is null and scope = 'global';
create unique index support_role_grants_active_org_idx
  on public.support_role_grants (grantee_id, role_key, organization_id)
  where revoked_at is null and scope = 'organization';
create index support_role_grants_grantee_idx on public.support_role_grants (grantee_id) where revoked_at is null;
create index support_role_grants_org_idx on public.support_role_grants (organization_id) where revoked_at is null;

-- ONARLY DESK-rättigheter per kundorganisation. Registret är auktoritativt för
-- BERRYiT:s beslut; ONARLY-produkternas egna åtkomstkontroller gäller fortsatt
-- för själva produktdriften.
create table public.onarly_support_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_key text not null,
  entitlement text not null,
  reason text not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  revoke_reason text,
  constraint onarly_entitlements_product_format check (product_key ~ '^[a-z0-9_]{2,40}$'),
  constraint onarly_entitlements_reason_not_blank check (btrim(reason) <> ''),
  constraint onarly_entitlements_revoked_pair check (
    (revoked_at is null and revoke_reason is null)
    or (revoked_at is not null and btrim(coalesce(revoke_reason, '')) <> '')
  )
);

create unique index onarly_entitlements_active_idx
  on public.onarly_support_entitlements (organization_id, product_key, entitlement)
  where revoked_at is null;

-- --------------------------------------------------------------- revision
-- Append-only: inga update/delete-policies och inga grants för klienter.

create table public.support_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  scope public.support_scope,
  organization_id uuid references public.organizations (id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index support_admin_audit_created_idx on public.support_admin_audit (created_at desc);
create index support_admin_audit_actor_idx on public.support_admin_audit (actor_id, created_at desc);
create index support_admin_audit_target_idx on public.support_admin_audit (target_type, target_id);

-- -------------------------------------------------------- behörighetslogik

-- Aktiva (ej återkallade, ej utgångna) tilldelningar för en användare.
create or replace function public.active_support_grants(p_user uuid)
returns table (role_key text, scope public.support_scope, organization_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select g.role_key, g.scope, g.organization_id
    from public.support_role_grants g
   where g.grantee_id = p_user
     and g.revoked_at is null
     and (g.expires_at is null or g.expires_at > now());
$$;

-- Har inloggad användare ett scope? p_organization_id = null betyder "globalt".
create or replace function public.has_support_permission(p_permission text, p_organization_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.active_support_grants(auth.uid()) g
      join public.support_role_permissions rp on rp.role_key = g.role_key
     where rp.permission_key = p_permission
       and (
         g.scope = 'global'
         or (p_organization_id is not null and g.organization_id = p_organization_id)
       )
  );
$$;

create or replace function public.is_support_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.active_support_grants(auth.uid()) g
     where g.role_key = 'BERRYIT_SUPPORT_SUPER_ADMIN' and g.scope = 'global'
  );
$$;

-- Personal = global supportbehörighet (profilroll eller global grant).
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('technician', 'admin'), false)
      or public.has_support_permission('tickets.read');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'admin', false)
      or public.is_support_super_admin();
$$;

-- Delegerad support: tekniker med grant på en specifik kundorganisation.
create or replace function public.has_org_support_access(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_organization_id is not null
     and public.has_support_permission('tickets.read', p_organization_id);
$$;

-- Ärenden: lägg till organisationsdelegerad åtkomst utöver tidigare regler.
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
         or public.has_org_support_access(t.organization_id)
         or (
           public.is_org_contact()
           and t.organization_id is not null
           and t.organization_id = public.current_organization_id()
         )
       )
  );
$$;

drop policy tickets_select on public.tickets;
create policy tickets_select on public.tickets
  for select to authenticated
  using (
    public.is_staff()
    or requester_id = auth.uid()
    or public.has_org_support_access(organization_id)
    or (
      public.is_org_contact()
      and organization_id is not null
      and organization_id = public.current_organization_id()
    )
  );

drop policy tickets_update_staff on public.tickets;
create policy tickets_update_staff on public.tickets
  for update to authenticated
  using (
    public.is_staff()
    or public.has_support_permission('tickets.write', organization_id)
  )
  with check (
    public.is_staff()
    or public.has_support_permission('tickets.write', organization_id)
  );

-- --------------------------------------------------- revision via triggers

create or replace function public.audit_support_role_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.support_admin_audit
      (actor_id, action, target_type, target_id, scope, organization_id, reason, metadata)
    values (coalesce(new.granted_by, auth.uid()), 'role.granted', 'profile', new.grantee_id::text,
            new.scope, new.organization_id, new.reason,
            jsonb_build_object('grant_id', new.id, 'role_key', new.role_key, 'expires_at', new.expires_at));
    return new;
  end if;

  if old.revoked_at is null and new.revoked_at is not null then
    insert into public.support_admin_audit
      (actor_id, action, target_type, target_id, scope, organization_id, reason, metadata)
    values (coalesce(new.revoked_by, auth.uid()), 'role.revoked', 'profile', new.grantee_id::text,
            new.scope, new.organization_id, new.revoke_reason,
            jsonb_build_object('grant_id', new.id, 'role_key', new.role_key));
  end if;
  return new;
end;
$$;

create trigger support_role_grants_audit after insert or update on public.support_role_grants
  for each row execute function public.audit_support_role_grant();

create or replace function public.audit_onarly_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.support_admin_audit
      (actor_id, action, target_type, target_id, scope, organization_id, reason, metadata)
    values (coalesce(new.granted_by, auth.uid()), 'onarly_entitlement.granted', 'organization',
            new.organization_id::text, 'organization', new.organization_id, new.reason,
            jsonb_build_object('product_key', new.product_key, 'entitlement', new.entitlement));
    return new;
  end if;

  if old.revoked_at is null and new.revoked_at is not null then
    insert into public.support_admin_audit
      (actor_id, action, target_type, target_id, scope, organization_id, reason, metadata)
    values (coalesce(new.revoked_by, auth.uid()), 'onarly_entitlement.revoked', 'organization',
            new.organization_id::text, 'organization', new.organization_id, new.revoke_reason,
            jsonb_build_object('product_key', new.product_key, 'entitlement', new.entitlement));
  end if;
  return new;
end;
$$;

create trigger onarly_entitlements_audit after insert or update on public.onarly_support_entitlements
  for each row execute function public.audit_onarly_entitlement();

-- Rollbyte på profilen loggas också – det är en behörighetsändring.
create or replace function public.audit_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
    insert into public.support_admin_audit (actor_id, action, target_type, target_id, metadata)
    values (auth.uid(), 'profile.role_changed', 'profile', new.id::text,
            jsonb_build_object('from_role', old.role, 'to_role', new.role,
                               'from_active', old.is_active, 'to_active', new.is_active));
  end if;
  return new;
end;
$$;

create trigger profiles_audit_role_change after update on public.profiles
  for each row execute function public.audit_profile_role_change();

-- ----------------------------------------------------- behörigheter och RLS

alter table public.support_permissions enable row level security;
alter table public.support_roles enable row level security;
alter table public.support_role_permissions enable row level security;
alter table public.support_role_grants enable row level security;
alter table public.onarly_support_entitlements enable row level security;
alter table public.support_admin_audit enable row level security;

grant select on public.support_permissions, public.support_roles, public.support_role_permissions to authenticated;
grant select, insert, update on public.support_role_grants to authenticated;
grant select, insert, update on public.onarly_support_entitlements to authenticated;
grant select on public.support_admin_audit to authenticated;

-- Rollkatalogen är läsbar för personal, inte för kunder.
create policy support_permissions_select on public.support_permissions
  for select to authenticated using (public.is_staff());
create policy support_roles_select on public.support_roles
  for select to authenticated using (public.is_staff());
create policy support_role_permissions_select on public.support_role_permissions
  for select to authenticated using (public.is_staff());

-- Tilldelningar: den berörda ser sina egna; endast roles.grant får bevilja/återkalla.
create policy support_role_grants_select on public.support_role_grants
  for select to authenticated
  using (grantee_id = auth.uid() or public.has_support_permission('roles.grant') or public.is_staff());

create policy support_role_grants_insert on public.support_role_grants
  for insert to authenticated
  with check (
    public.has_support_permission('roles.grant', organization_id)
    and granted_by = auth.uid()
    and grantee_id <> auth.uid()
  );

create policy support_role_grants_update on public.support_role_grants
  for update to authenticated
  using (public.has_support_permission('roles.grant', organization_id))
  with check (public.has_support_permission('roles.grant', organization_id));

create policy onarly_entitlements_select on public.onarly_support_entitlements
  for select to authenticated
  using (public.is_staff() or organization_id = public.current_organization_id());

create policy onarly_entitlements_write on public.onarly_support_entitlements
  for insert to authenticated
  with check (public.has_support_permission('onarly.entitlements.manage', organization_id) and granted_by = auth.uid());

create policy onarly_entitlements_revoke on public.onarly_support_entitlements
  for update to authenticated
  using (public.has_support_permission('onarly.entitlements.manage', organization_id))
  with check (public.has_support_permission('onarly.entitlements.manage', organization_id));

-- Revisionshistoriken läses av den som har audit.read. Ingen klient får skriva.
create policy support_admin_audit_select on public.support_admin_audit
  for select to authenticated using (public.has_support_permission('audit.read'));
