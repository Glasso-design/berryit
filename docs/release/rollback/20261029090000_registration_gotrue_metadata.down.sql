-- ROLLBACK (DOWN) for supabase/migrations/20261029090000_registration_gotrue_metadata.sql
-- (version rehearsed: fix/masterpass1-berryit-20261029 @ 29307ef, file sha256
--  e4d58a22362c530b2501012e8f605a72d43da8e4031bab8bc488615d4611008b)
-- MASTER PASS 2 migration rehearsal, 2026-10-29. NOT a forward migration: never copy this file into
-- supabase/migrations/ (deploy/berryit-support/migrate.sh applies every *.sql there).
--
-- What the UP did: it only ADDED objects. New function public.handle_auth_user_registration_metadata()
-- (SECURITY DEFINER, EXECUTE revoked from public/anon/authenticated) and new trigger
-- auth_user_registration_metadata AFTER UPDATE OF raw_app_meta_data ON auth.users. It replaced no existing
-- function (handle_new_auth_user() and audit_support_registry_changes() are untouched), so there is no earlier
-- definition to restore. It changed no data.
--
-- What this DOWN does, in ONE transaction, with lock_timeout 2s (DROP TRIGGER takes ACCESS EXCLUSIVE on auth.users, so even logins that only READ queue behind it while it waits):
--   1. Guard: the caller must be able to drop a trigger on auth.users (superuser, or member of the table owner -
--      on the self-hosted stack run it as supabase_admin like migrate.sh; a role with only the TRIGGER privilege
--      gets "must be owner of relation users").
--   2. Guard: if the function exists, its body must be the rehearsed body (md5 81adfaef...). Anything else aborts:
--      the function was changed after the rehearsal and this rollback must be re-derived.
--   3. Drops the trigger, then the function.
--   4. Deletes the ledger row from public.schema_migrations so the ledger does not claim the version. As long as
--      the migration FILE is still in the deployed supabase/migrations, the next migrate.sh run re-applies it:
--      remove/revert the file in the deployed release before running migrate.sh again.
--   5. Asserts the result.
-- Running it a second time is harmless (everything is IF EXISTS; guard 2 only checks an existing function).
--
-- Data: nothing is deleted. Customers registered through the UPDATE path while the UP was active keep their
-- organisation, login_activation_pending, registered_by and their support_admin_audit rows (append-only and
-- correct). After the DOWN the pass-1 defect is back: a GoTrue admin-create through /api/control/customers again
-- produces a half-registered account (organisation NULL, not pending, no audit). Stop manual customer registration
-- in the Control Center for as long as the rollback is in force.
--
-- Run: psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -f 20261029090000_registration_gotrue_metadata.down.sql
--      (plain -f, not --single-transaction: the file has its own BEGIN/COMMIT)

\set ON_ERROR_STOP 1
begin;
set local lock_timeout = '2s';  -- DROP TRIGGER takes ACCESS EXCLUSIVE on auth.users: readers queue too; retry in a quiet window

do $guard$
declare v_md5 text;
begin
  if not (select rolsuper from pg_roles where rolname = current_user)
     and not pg_has_role(current_user, (select relowner from pg_class where oid = 'auth.users'::regclass), 'MEMBER') then
    raise exception 'role % cannot drop triggers on auth.users (needs superuser or the table owner); run as supabase_admin', current_user
      using errcode = '42501';
  end if;
  select md5(prosrc) into v_md5 from pg_proc where oid = to_regprocedure('public.handle_auth_user_registration_metadata()');
  if v_md5 is null then
    raise notice 'handle_auth_user_registration_metadata() does not exist: already rolled back or never applied';
  elsif v_md5 <> '81adfaef8fe1d8b81973953d279d85b9' then
    raise exception 'handle_auth_user_registration_metadata() body (md5 %) is not the rehearsed 29307ef body; stop and re-derive the rollback', v_md5;
  end if;
end
$guard$;

drop trigger if exists auth_user_registration_metadata on auth.users;
drop function if exists public.handle_auth_user_registration_metadata();

do $ledger$
begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where version = '20261029090000_registration_gotrue_metadata.sql';
  end if;
end
$ledger$;

do $assert$
begin
  if exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'auth_user_registration_metadata') then
    raise exception 'trigger auth_user_registration_metadata still present';
  end if;
  if to_regprocedure('public.handle_auth_user_registration_metadata()') is not null then
    raise exception 'function handle_auth_user_registration_metadata() still present';
  end if;
  if to_regclass('public.schema_migrations') is not null
     and exists (select 1 from public.schema_migrations where version = '20261029090000_registration_gotrue_metadata.sql') then
    raise exception 'ledger row 20261029090000 still present';
  end if;
  raise notice 'ROLLBACK 20261029090000 OK: trigger and function removed, ledger row removed, no data changed';
end
$assert$;

commit;
