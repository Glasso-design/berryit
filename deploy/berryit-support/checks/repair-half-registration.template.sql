-- MASTER PASS 2 (M4) – MALL för manuell reparation av ETT halvregistrerat konto.
-- Körs ALDRIG automatiskt och aldrig utan beslut. Läs först
-- docs/masterpass2-registration-check.md.
--
-- Kräver uttryckliga värden för just detta konto:
--   docker exec -i berryit-support-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
--     --single-transaction \
--     -v user_id=<user_id från kontrollen> \
--     -v organization_id=<beslutad organisation, tom för privatkund> \
--     -v registrar_id=<registrar enligt markören> \
--     -v operator_id=<profil-id för den administratör som beslutar> \
--     -v reason='<ärende-/beslutsreferens, minst 10 tecken>' \
--     -v confirm=JA \
--     < deploy/berryit-support/checks/repair-half-registration.template.sql
--
-- Effekt (en transaktion, allt eller inget):
--   * profilen får organisation, aktiveringsspärr och registrar;
--   * en attribuerad audit-rad 'customer_registration_repaired' med operatören som aktör;
--   * triggern support_profiles_audit skriver dessutom 'profiles_update' utan aktör
--     ("Manuell registerändring"), eftersom ändringen görs med direkt SQL. Det är korrekt.
\if :{?confirm}
\else
  \echo 'Avbryter: -v confirm=JA saknas.'
  \quit
\endif
set local lock_timeout = '5s';
set local statement_timeout = '30s';
select set_config('berryit.repair_user', :'user_id', true),
       set_config('berryit.repair_org', :'organization_id', true),
       set_config('berryit.repair_registrar', :'registrar_id', true),
       set_config('berryit.repair_operator', :'operator_id', true),
       set_config('berryit.repair_reason', :'reason', true),
       set_config('berryit.repair_confirm', :'confirm', true) \g /dev/null
do $$
declare
  uid uuid := current_setting('berryit.repair_user')::uuid;
  org uuid := nullif(current_setting('berryit.repair_org'), '')::uuid;
  registrar uuid := current_setting('berryit.repair_registrar')::uuid;
  operator uuid := current_setting('berryit.repair_operator')::uuid;
  why text := btrim(current_setting('berryit.repair_reason'));
  marker jsonb; n int;
begin
  if current_setting('berryit.repair_confirm') <> 'JA' then raise exception 'confirm måste vara JA'; end if;
  if char_length(why) < 10 then raise exception 'reason måste referera beslutet (minst 10 tecken)'; end if;
  select u.raw_app_meta_data->'berryit_manual_customer' into marker from auth.users u where u.id = uid;
  if marker is null then raise exception 'kontot saknar registreringsmarkör'; end if;
  if (marker->>'actor_id')::uuid is distinct from registrar then raise exception 'registrar stämmer inte med markören'; end if;
  if org is not null and not exists (select 1 from public.organizations where id = org) then
    raise exception 'organisationen finns inte';
  end if;
  if not exists (select 1 from public.profiles where id = operator and role = 'admin') then
    raise exception 'operator_id måste vara en administratörsprofil';
  end if;
  perform 1 from public.profiles p
   where p.id = uid and p.role = 'customer' and p.registered_by is null and not p.login_activation_pending
   for update;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'kontot är inte (längre) halvregistrerat – ingenting ändrat'; end if;
  update public.profiles set organization_id = org, login_activation_pending = true, registered_by = registrar
   where id = uid and registered_by is null;
  insert into public.support_admin_audit(actor_id,action,target_type,target_id,scope,organization_id,reason,metadata)
  values(operator,'customer_registration_repaired','profile',uid::text,
    case when org is null then 'global'::public.support_scope else 'organization'::public.support_scope end,
    org, why, jsonb_build_object('original_registrar', registrar, 'marker', marker,
      'detected_by', 'deploy/berryit-support/registration-check.sh', 'login_activation_pending', true));
  raise notice 'reparerat: % (organisation %)', uid, coalesce(org::text, 'privatkund');
end;
$$;
