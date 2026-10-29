-- ROLLBACK (DOWN) for supabase/migrations/20261029090000_registration_gotrue_metadata.sql
-- version: fix/masterpass2-berryit-review-fixes-20261029 (migration file sha256
--  90d8e3473f746bdf2c72db4247e50c5413fe795dc320b68435902d7ea8b2646f, first in 902bea5)
-- MASTER PASS 2 migration rehearsal, 2026-10-29. NOT a forward migration: never copy into supabase/migrations/.
--
-- What this UP version does: adds handle_auth_user_registration_metadata() + trigger
-- auth_user_registration_metadata (create or replace trigger), and REPLACES the existing
-- public.audit_support_registry_changes() (from 20261014235633_complete_support_workflow.sql) with a version that
-- skips the one internal profile write of a registration (M1). Its "revoke all ... from public, anon, authenticated"
-- is already the state since 20261014235633:373, so the ACL does not change. No data is changed.
--
-- This DOWN, in ONE transaction, lock_timeout 2s (DROP TRIGGER takes ACCESS EXCLUSIVE on auth.users):
--   1. Guards: superuser or owner of auth.users; both function bodies are the rehearsed fix bodies
--      (or already the previous state); anything else aborts.
--   2. Drops the trigger and handle_auth_user_registration_metadata().
--   3. Restores audit_support_registry_changes() byte-for-byte from 20261014235633_complete_support_workflow.sql
--      lines 335-344 (file sha256 60b1ddc6d6d0f53c1746d74dd8c054f3f5e67439f38077f966cc876eee335bb1).
--   4. Deletes the migrate.sh ledger row. Remove/revert the migration file before the next migrate.sh run.
--   5. Asserts the result. A second run is harmless.
-- Data: nothing is deleted; registrations made while UP was active keep their profile data and single audit row.
-- After the DOWN the pass-1 defect is back; stop manual customer registration while it is in force.
-- Run: docker exec -i berryit-support-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f - < <this file>

\set ON_ERROR_STOP 1
begin;
set local lock_timeout = '2s';

do $guard$
declare v_reg text; v_aud text;
begin
  if not (select rolsuper from pg_roles where rolname = current_user)
     and not pg_has_role(current_user, (select relowner from pg_class where oid = 'auth.users'::regclass), 'MEMBER') then
    raise exception 'role % cannot drop triggers on auth.users (needs superuser or the table owner); run as supabase_admin', current_user
      using errcode = '42501';
  end if;
  select md5(prosrc) into v_reg from pg_proc where oid = to_regprocedure('public.handle_auth_user_registration_metadata()');
  select md5(prosrc) into v_aud from pg_proc where oid = to_regprocedure('public.audit_support_registry_changes()');
  if v_reg is not null and v_reg <> 'a649e81446e3f4e3a05fb3bf85e8cf77' then
    raise exception 'handle_auth_user_registration_metadata() body (md5 %) is not the rehearsed review-fixes body; re-derive the rollback', v_reg;
  end if;
  if v_aud not in ('0fb917c6bbc816a7841e1879991a7840', 'e4a80f219a0c9f7ed11d75fdcc66755e') then
    raise exception 'audit_support_registry_changes() body (md5 %) is neither the review-fixes body nor the 20261014235633 body; re-derive the rollback', v_aud;
  end if;
  if v_reg is null and v_aud = 'e4a80f219a0c9f7ed11d75fdcc66755e' then
    raise notice 'already rolled back (or never applied): nothing to do';
  end if;
end
$guard$;

drop trigger if exists auth_user_registration_metadata on auth.users;
drop function if exists public.handle_auth_user_registration_metadata();

-- Exact previous definition (20261014235633_complete_support_workflow.sql lines 335-344); CREATE OR REPLACE keeps the ACL.
create or replace function public.audit_support_registry_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason)
  values(auth.uid(),tg_table_name||'_'||lower(tg_op),tg_table_name,new.id::text,
    case when tg_table_name='organizations' then 'organization'::public.support_scope else 'global'::public.support_scope end,
    case when tg_table_name='organizations' then new.id else null end,'Manuell registerändring');
  return new;
end;
$$;

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
  if (select md5(prosrc) from pg_proc where oid = 'public.audit_support_registry_changes()'::regprocedure) <> 'e4a80f219a0c9f7ed11d75fdcc66755e' then
    raise exception 'audit_support_registry_changes() was not restored to the 20261014235633 body';
  end if;
  if to_regclass('public.schema_migrations') is not null
     and exists (select 1 from public.schema_migrations where version = '20261029090000_registration_gotrue_metadata.sql') then
    raise exception 'ledger row 20261029090000 still present';
  end if;
  raise notice 'ROLLBACK 20261029090000 (review-fixes) OK: trigger and function removed, audit_support_registry_changes() restored, ledger row removed';
end
$assert$;

commit;
