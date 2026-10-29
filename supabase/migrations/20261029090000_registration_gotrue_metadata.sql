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
  insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason,metadata)
  values(actor,'customer_registered','profile',new.id::text,
    case when org is null then 'global'::public.support_scope else 'organization'::public.support_scope end,
    org,'Manuell kundregistrering',jsonb_build_object('login_activation_pending',true,'source','gotrue_admin_update'));
  return new;
end;
$$;
revoke all on function public.handle_auth_user_registration_metadata() from public, anon, authenticated;

drop trigger if exists auth_user_registration_metadata on auth.users;
create trigger auth_user_registration_metadata after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_auth_user_registration_metadata();
