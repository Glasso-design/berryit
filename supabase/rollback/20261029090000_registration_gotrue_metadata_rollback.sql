-- ÅTERSTÄLLNING (DOWN) av supabase/migrations/20261029090000_registration_gotrue_metadata.sql
--
-- MASTER PASS 3 (2026-10-30): den vaktade DOWN-filen från migrationsrepetitionen
-- (audit/pass2 migration-rehearsal, fynd F-B7) ersätter den tidigare versionen,
-- som saknade vakt för roll och funktionskroppar och väntade 5 s på
-- AccessExclusiveLock (även läsande inloggningar stod still ~5 s per försök).
--
-- Ligger medvetet UTANFÖR supabase/migrations/, så att migrate.sh aldrig kan
-- råka applicera den. Körs bara efter beslut, som supabase_admin (superuser
-- eller ägare av auth.users). Filen har egen BEGIN/COMMIT och ON_ERROR_STOP:
--
--   docker exec -i berryit-support-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 -f - \
--     < supabase/rollback/20261029090000_registration_gotrue_metadata_rollback.sql
--
-- (Körs den ändå med --single-transaction blir resultatet detsamma; psql varnar
-- bara för den inre BEGIN/COMMIT.)
--
-- I EN transaktion:
--   1. Vakter: superuser eller ägare av auth.users; båda funktionskropparna är
--      exakt de repeterade (md5) eller redan det tidigare läget. Allt annat
--      avbryter innan något ändras.
--   2. Triggern auth_user_registration_metadata och dess funktion tas bort.
--   3. audit_support_registry_changes() får exakt sin version från
--      20261014235633_complete_support_workflow.sql rad 335-344 (create or
--      replace behåller ACL:en).
--   4. Raden i public.schema_migrations tas bort, så att migrate.sh kan
--      applicera framåtmigrationen igen. Ta bort eller återställ
--      migrationsfilen i releasen före nästa migrate.sh om den inte ska tillbaka.
--   5. Resultatet kontrolleras. En andra körning är ofarlig.
--
-- Lås: DROP TRIGGER tar AccessExclusiveLock på auth.users (även läsare väntar).
-- Därför högst 2 s väntan; en kortare lock_timeout som operatören redan satt
-- behålls. Slår gränsen till har ingenting ändrats: vänta och kör igen.
--
-- Data: ingenting raderas. Profiler och audit-rader från registreringar som
-- gjorts medan migrationen var aktiv ligger kvar (auditloggen är append-only).
-- Efter återställningen blir nya registreringar via GoTrue åter halva
-- (organisation saknas, ingen aktiveringsspärr, ingen audit): stoppa manuell
-- kundregistrering så länge, se docs/masterpass2-registration-check.md.

\set ON_ERROR_STOP 1
begin;

do $timeouts$
begin
  if (select s.setting::bigint from pg_catalog.pg_settings s where s.name = 'lock_timeout') not between 1 and 2000 then
    perform pg_catalog.set_config('lock_timeout', '2s', true);
  end if;
  if (select s.setting::bigint from pg_catalog.pg_settings s where s.name = 'statement_timeout') not between 1 and 60000 then
    perform pg_catalog.set_config('statement_timeout', '60s', true);
  end if;
end
$timeouts$;

do $guard$
declare v_reg text; v_aud text;
begin
  if not (select rolsuper from pg_catalog.pg_roles where rolname = current_user)
     and not pg_catalog.pg_has_role(current_user, (select relowner from pg_catalog.pg_class where oid = 'auth.users'::regclass), 'MEMBER') then
    raise exception 'role % cannot drop triggers on auth.users (needs superuser or the table owner); run as supabase_admin', current_user
      using errcode = '42501';
  end if;
  select md5(prosrc) into v_reg from pg_catalog.pg_proc where oid = pg_catalog.to_regprocedure('public.handle_auth_user_registration_metadata()');
  select md5(prosrc) into v_aud from pg_catalog.pg_proc where oid = pg_catalog.to_regprocedure('public.audit_support_registry_changes()');
  if v_reg is not null and v_reg <> 'a649e81446e3f4e3a05fb3bf85e8cf77' then
    raise exception 'handle_auth_user_registration_metadata() body (md5 %) is not the rehearsed body; stop and re-derive the rollback', v_reg;
  end if;
  if v_aud is null or v_aud not in ('0fb917c6bbc816a7841e1879991a7840', 'e4a80f219a0c9f7ed11d75fdcc66755e') then
    raise exception 'audit_support_registry_changes() body (md5 %) is neither the 20261029090000 body nor the 20261014235633 body; stop and re-derive the rollback', v_aud;
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
  if pg_catalog.to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where version = '20261029090000_registration_gotrue_metadata.sql';
  end if;
end
$ledger$;

do $assert$
begin
  if exists (select 1 from pg_catalog.pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'auth_user_registration_metadata') then
    raise exception 'trigger auth_user_registration_metadata still present';
  end if;
  if pg_catalog.to_regprocedure('public.handle_auth_user_registration_metadata()') is not null then
    raise exception 'function handle_auth_user_registration_metadata() still present';
  end if;
  if (select md5(prosrc) from pg_catalog.pg_proc where oid = 'public.audit_support_registry_changes()'::regprocedure) <> 'e4a80f219a0c9f7ed11d75fdcc66755e' then
    raise exception 'audit_support_registry_changes() was not restored to the 20261014235633 body';
  end if;
  if pg_catalog.to_regclass('public.schema_migrations') is not null
     and exists (select 1 from public.schema_migrations where version = '20261029090000_registration_gotrue_metadata.sql') then
    raise exception 'ledger row 20261029090000 still present';
  end if;
  raise notice 'ROLLBACK 20261029090000 OK: trigger and function removed, audit_support_registry_changes() restored, ledger row removed';
end
$assert$;

commit;
