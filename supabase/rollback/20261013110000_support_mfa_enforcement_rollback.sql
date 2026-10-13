-- ÅTERSTÄLLNING av 20261013110000_support_mfa_enforcement.sql
--
-- Återför behörighetslogiken till PASS 2B, där tvåfaktor kontrollerades i
-- klienterna men inte i databasen. Används bara om MFA-kravet visar sig stänga
-- ute någon som behöver komma in, och bara efter beslut – efter körningen ger
-- en Super Admin med enbart lösenord full administrativ åtkomst igen.
--
-- Ligger medvetet UTANFÖR supabase/migrations/, så att migrate.sh aldrig kan
-- råka applicera den.
--
-- Vad som återställs
-- ------------------
--   has_support_permission, is_support_super_admin, is_staff, is_admin,
--   guard_support_role_grant, guard_onarly_entitlement,
--   protect_profile_privileges  → exakt PASS 2B-versionerna
--
-- Vad som lämnas kvar, avsiktligt
-- ------------------------------
--   profiles.is_machine, support_permissions.requires_mfa  (kolumnerna)
--   current_aal(), is_trusted_backend(), is_machine_identity(),
--   session_is_live(), mfa_satisfied()
--
-- Kolumnerna innehåller data som någon har satt medvetet, och att släppa dem
-- vore att förstöra information under en incident. Efter återställningen är de
-- verkningslösa: ingen funktion läser dem längre. Att applicera framåtmigrationen
-- igen aktiverar dem direkt, utan att något behöver sättas om.
--
-- Kunddata (organisationer, profiler, ärenden, meddelanden, bilagor,
-- tilldelningar, revision) rörs inte av vare sig framåt- eller bakåtmigrationen.

-- --------------------------------------------------------- behörighetsfunktioner

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

-- ----------------------------------------------------------------- triggers

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

-- is_machine skyddas inte längre här, eftersom kolumnen inte längre styr något.
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
