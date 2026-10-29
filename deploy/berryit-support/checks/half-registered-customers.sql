-- MASTER PASS 2 (M4) – SKRIVSKYDDAD kontroll. Ändrar ingenting.
--
-- Hittar konton som registrerades manuellt via /api/control/customers innan
-- 20261029090000_registration_gotrue_metadata.sql fanns: GoTrue skrev markören
-- berryit_manual_customer i raw_app_meta_data, men profilen blev en vanlig
-- kund utan organisation, utan aktiveringsspärr, utan registrar och utan
-- audit-rad. Sådana konton kan bara finnas där 20261014235633 applicerats och
-- registreringen använts före fixen (t.ex. staging- och teststackar).
--
-- Körs med deploy/berryit-support/registration-check.sh, eller i en SQL-konsol
-- som en skrivskyddad transaktion. Åtgärder görs ALDRIG automatiskt; se
-- docs/masterpass2-registration-check.md.
start transaction read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

select u.id as user_id,
       u.email,
       u.created_at as auth_created_at,
       u.raw_app_meta_data->'berryit_manual_customer'->>'actor_id' as marker_registrar_id,
       nullif(u.raw_app_meta_data->'berryit_manual_customer'->>'organization_id', '') as marker_organization_id,
       p.organization_id as profile_organization_id,
       p.login_activation_pending,
       p.registered_by,
       (select count(*) from public.support_admin_audit a
         where a.action in ('customer_registered', 'customer_registration_repaired') and a.target_type = 'profile' and a.target_id = u.id::text) as registration_audit_rows,
       array_remove(array[
         case when p.id is null then 'profil saknas' end,
         case when p.id is not null and p.registered_by is null then 'registrar saknas (registreringen applicerades aldrig)' end,
         case when p.id is not null and p.registered_by is null and not p.login_activation_pending then 'aktiveringsspärr saknas' end,
         case when nullif(u.raw_app_meta_data->'berryit_manual_customer'->>'organization_id', '') is not null
                   and p.organization_id is distinct from nullif(u.raw_app_meta_data->'berryit_manual_customer'->>'organization_id', '')::uuid
              then 'organisation skiljer sig från markören' end,
         case when not exists (select 1 from public.support_admin_audit a
                                where a.action in ('customer_registered', 'customer_registration_repaired') and a.target_type = 'profile' and a.target_id = u.id::text)
              then 'audit-rad customer_registered/customer_registration_repaired saknas' end
       ], null) as findings
  from auth.users u
  left join public.profiles p on p.id = u.id
 where u.raw_app_meta_data ? 'berryit_manual_customer'
   and (p.id is null
        or p.registered_by is null
        or (nullif(u.raw_app_meta_data->'berryit_manual_customer'->>'organization_id', '') is not null
            and p.organization_id is distinct from nullif(u.raw_app_meta_data->'berryit_manual_customer'->>'organization_id', '')::uuid)
        or not exists (select 1 from public.support_admin_audit a
                        where a.action in ('customer_registered', 'customer_registration_repaired') and a.target_type = 'profile' and a.target_id = u.id::text))
 order by u.created_at;

select 'MP2-REGISTRATION-CHECK: ' || count(*) || ' konto(n) att granska' as summary
  from auth.users u
  left join public.profiles p on p.id = u.id
 where u.raw_app_meta_data ? 'berryit_manual_customer'
   and (p.id is null
        or p.registered_by is null
        or (nullif(u.raw_app_meta_data->'berryit_manual_customer'->>'organization_id', '') is not null
            and p.organization_id is distinct from nullif(u.raw_app_meta_data->'berryit_manual_customer'->>'organization_id', '')::uuid)
        or not exists (select 1 from public.support_admin_audit a
                        where a.action in ('customer_registered', 'customer_registration_repaired') and a.target_type = 'profile' and a.target_id = u.id::text));

rollback;
