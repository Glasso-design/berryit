-- MASTER PASS 1 (2026-10-29): manual customer registration through the real
-- GoTrue admin API.
--
-- Defect (REAL stack, CI run 40846671251): POST /api/control/customers created
-- the Auth user, but the profile became an ordinary customer without
-- organisation, without login_activation_pending, without registered_by and
-- without a support_admin_audit row. GoTrue's admin "create user" first
-- INSERTs auth.users with only the provider app_metadata and then UPDATEs
-- raw_app_meta_data with the caller's app_metadata in the same transaction.
-- handle_new_auth_user() (AFTER INSERT) therefore never saw
-- berryit_manual_customer. PGlite fixtures insert both in one statement, which
-- is why the earlier suites passed.
--
-- Fix (forward only, nothing deleted): apply the same verified registration
-- when the marker arrives by UPDATE in the transaction that created the
-- profile. The registrar is re-verified (live aal2 session, admin/Super Admin)
-- exactly like the INSERT path; any other attempt fails closed and aborts the
-- GoTrue transaction, so no half-registered account can exist.
--
-- MASTER PASS 2 (2026-10-29), changed IN PLACE. This file has never been
-- applied to a persistent or shared database (only throwaway CI runners and
-- local scratch clusters), so the reviewed manifest checksum is updated
-- instead of adding a second migration:
--   M1  The profile UPDATE below fired support_profiles_audit, which wrote an
--       extra 'profiles_update' row with actor_id NULL for every registration.
--       The audit log is append-only. The registration now writes its own
--       attributed customer_registered row first, and
--       audit_support_registry_changes() skips exactly that one internal
--       profile write. A registration leaves exactly ONE audit row, the same
--       as the INSERT path.
--   M2  lock_timeout/statement_timeout for this transaction. A migration that
--       waits for its lock on auth.users must not queue every login behind it.
--       create or replace trigger takes ShareRowExclusiveLock on auth.users.
--       The former "drop trigger if exists" took AccessExclusiveLock on
--       re-apply, which blocks even readers.
--       Retry procedure: deploy/berryit-support/README.md ("Migrering med låsgräns").
--   M3  The column list (after update of raw_app_meta_data) is intentionally
--       unchanged; see the runbook for the GoTrue upgrade rehearsal.

-- M2: never wait more than 5 s for a lock on auth.users (logins queue behind a
-- waiting lock request). SET LOCAL only applies inside a transaction, which
-- migrate.sh provides (psql --single-transaction); refuse to run without one.
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception 'Migrationen måste köras i en transaktion (deploy/berryit-support/migrate.sh), annars gäller inte lock_timeout'
      using errcode = '25P01';
  end if;
end;
$$;

create or replace function public.handle_auth_user_registration_metadata()
returns trigger language plpgsql security definer set search_path = '' as $$
declare registration jsonb := new.raw_app_meta_data->'berryit_manual_customer';
  actor uuid; sid uuid; org uuid; applied integer;
begin
  if registration is null or coalesce(old.raw_app_meta_data ? 'berryit_manual_customer', false) then
    return new;
  end if;
  actor := (registration->>'actor_id')::uuid;
  sid := (registration->>'session_id')::uuid;
  org := nullif(registration->>'organization_id', '')::uuid;
  if berryit_private.registration_admin(actor, sid) is not true then
    raise exception 'Registreringsbehörigheten har upphört' using errcode = '42501';
  end if;
  if org is not null and not exists (select 1 from public.organizations o where o.id = org) then
    raise exception 'Organisationen finns inte' using errcode = '23503';
  end if;
  -- The attributed audit row is written first: audit_support_registry_changes()
  -- recognises the profile write below by this row and does not add an
  -- anonymous 'profiles_update' row. If the update is refused, the exception
  -- rolls this row back together with the whole GoTrue transaction.
  insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason,metadata)
  values(actor,'customer_registered','profile',new.id::text,
    case when org is null then 'global'::public.support_scope else 'organization'::public.support_scope end,
    org,'Manuell kundregistrering',jsonb_build_object('login_activation_pending',true,'source','gotrue_admin_update'));
  -- Only the profile created by this very transaction (now() is the transaction
  -- timestamp) can be turned into a manual registration; existing accounts never.
  update public.profiles p
     set organization_id = org, login_activation_pending = true, registered_by = actor
   where p.id = new.id and p.role = 'customer' and p.registered_by is null
     and not p.login_activation_pending and p.created_at = now();
  get diagnostics applied = row_count;
  if applied <> 1 then
    raise exception 'Manuell kundregistrering kan bara göras när kontot skapas' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.handle_auth_user_registration_metadata() from public, anon, authenticated;

-- Same function as 20261014235633_complete_support_workflow.sql, plus one
-- narrowly bound exception (M1). A profile UPDATE is not audited again only when
-- all of these hold:
--   * it is the registration transition (registered_by NULL -> set, pending
--     false -> true), and nothing else changes except organisation/updated_at;
--   * the profile was created in this same transaction;
--   * this transaction already wrote the attributed customer_registered row for
--     this profile, by the same registrar and for the same organisation.
-- anon/authenticated cannot write support_admin_audit (insert is revoked), and
-- one API request cannot create a profile, an audit row and the update in a
-- single transaction, so a client cannot fake the condition. Every other
-- profile or organisation change is audited exactly as before.
create or replace function public.audit_support_registry_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'profiles' and tg_op = 'UPDATE' then
    if old.registered_by is null and new.registered_by is not null
       and not old.login_activation_pending and new.login_activation_pending
       and new.created_at = now()
       and (to_jsonb(old) - array['organization_id','login_activation_pending','registered_by','updated_at'])
         = (to_jsonb(new) - array['organization_id','login_activation_pending','registered_by','updated_at'])
       and exists (select 1 from public.support_admin_audit a
                    where a.action = 'customer_registered' and a.target_type = 'profile'
                      and a.target_id = new.id::text and a.actor_id = new.registered_by
                      and a.organization_id is not distinct from new.organization_id
                      and a.created_at = now()) then
      return new;
    end if;
  end if;
  insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason)
  values(auth.uid(),tg_table_name||'_'||lower(tg_op),tg_table_name,new.id::text,
    case when tg_table_name='organizations' then 'organization'::public.support_scope else 'global'::public.support_scope end,
    case when tg_table_name='organizations' then new.id else null end,'Manuell registerändring');
  return new;
end;
$$;
revoke all on function public.audit_support_registry_changes() from public, anon, authenticated;

-- create or replace (PostgreSQL 14+) takes ShareRowExclusiveLock whether or not
-- the trigger exists. Readers are never blocked; writers wait at most lock_timeout.
create or replace trigger auth_user_registration_metadata after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_auth_user_registration_metadata();
