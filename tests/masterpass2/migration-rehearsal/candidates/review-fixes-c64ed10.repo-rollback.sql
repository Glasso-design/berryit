-- ÅTERSTÄLLNING av 20261029090000_registration_gotrue_metadata.sql
--
-- Ligger medvetet UTANFÖR supabase/migrations/, så att migrate.sh aldrig kan
-- råka applicera den. Körs bara efter beslut, i samma form som migrate.sh:
--
--   docker exec -i berryit-support-db psql -v ON_ERROR_STOP=1 -U supabase_admin \
--     -d postgres --single-transaction \
--     < supabase/rollback/20261029090000_registration_gotrue_metadata_rollback.sql
--
-- Vad som återställs
--   * triggern auth_user_registration_metadata och dess funktion tas bort;
--   * audit_support_registry_changes() får exakt sin version från
--     20261014235633_complete_support_workflow.sql (utan undantaget för
--     registreringens egen profilskrivning, M1);
--   * raden i public.schema_migrations tas bort i SAMMA transaktion, så att
--     migrate.sh kan applicera framåtmigrationen igen. (Detta skiljer sig från
--     MFA-återställningen, som lämnar ledgern orörd.)
--
-- Vad som lämnas kvar, avsiktligt
--   Profiler och audit-rader från registreringar som redan gjorts via
--   UPDATE-vägen. Det är riktiga registreringar; auditloggen är append-only.
--   Efter återställningen blir nya registreringar via GoTrue åter halva
--   (organisation saknas, ingen aktiveringsspärr, ingen audit). Se
--   docs/masterpass2-registration-check.md för upptäckt.
--
-- Låsning: DROP TRIGGER tar AccessExclusiveLock på auth.users (blockerar även
-- läsare). Därför samma tidsgränser som framåtmigrationen; slår gränsen till
-- har ingenting ändrats och körningen kan göras om (se runbooken).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
begin
  if current_setting('lock_timeout') <> '5s' then
    raise exception 'Återställningen måste köras i en transaktion (psql --single-transaction)'
      using errcode = '25P01';
  end if;
end;
$$;

drop trigger if exists auth_user_registration_metadata on auth.users;
drop function if exists public.handle_auth_user_registration_metadata();

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
revoke all on function public.audit_support_registry_changes() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    delete from public.schema_migrations where version = '20261029090000_registration_gotrue_metadata.sql';
  end if;
end;
$$;
