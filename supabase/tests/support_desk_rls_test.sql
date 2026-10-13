-- BERRYiT Support Desk – säkerhetstester för PASS 1.
--
-- Körs mot en databas där migrationerna är applicerade:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/support_desk_rls_test.sql
-- Allt sker i en transaktion som rullas tillbaka – ingen testdata blir kvar.
--
-- Varje kontroll avbryter körningen med ett tydligt felmeddelande om den fallerar.

begin;

create or replace function pg_temp.assert(ok boolean, what text)
returns void language plpgsql as $$
begin
  if ok is not true then
    raise exception 'FAIL: %', what;
  end if;
  raise notice 'ok: %', what;
end;
$$;

-- Byt inloggad användare (motsvarar en JWT från Supabase Auth).
create or replace function pg_temp.login(uid uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.logout()
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ------------------------------------------------------------- testdata
-- Skapas som ägare (RLS kringgås), motsvarar service_role/administration.

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'kund.a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'kund.b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'tekniker@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'kollega@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'kontakt@example.com');

insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Exempelbolaget AB');

-- Profiler skapas av trigger på auth.users; här sätts roller och organisation.
update public.profiles set full_name = 'Kund A' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set full_name = 'Kund B' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set role = 'technician', full_name = 'Tekniker' where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set organization_id = 'aaaaaaaa-0000-0000-0000-000000000001', full_name = 'Kollega'
  where id = '44444444-4444-4444-4444-444444444444';
update public.profiles set organization_id = 'aaaaaaaa-0000-0000-0000-000000000001', is_org_admin = true, full_name = 'Kontaktperson'
  where id = '55555555-5555-5555-5555-555555555555';

do $$
declare
  ticket_a uuid;
  ticket_b uuid;
  ticket_org uuid;
  n int;
  ref text;
  msg_id uuid;
  ok boolean;
  err text;
begin
  -- 1. Kund skapar ärende via portalen.
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  insert into public.tickets (requester_id, subject, description, category_key)
  values ('11111111-1111-1111-1111-111111111111', 'Datorn startar inte',
          'Datorn startar inte efter senaste uppdateringen.', 'dator')
  returning id, reference into ticket_a, ref;
  perform pg_temp.assert(ticket_a is not null, 'kund kan skapa ärende');
  perform pg_temp.assert(ref ~ '^BIT-[0-9]{4}-[0-9]{4}$', 'ärendet får läsbart ID (' || ref || ')');

  select count(*) into n from public.tickets where id = ticket_a and status_key = 'mottaget';
  perform pg_temp.assert(n = 1, 'nytt ärende får status Mottaget');

  -- 2. Kund kan inte skapa ärende i någon annans namn.
  begin
    insert into public.tickets (requester_id, subject, description, category_key)
    values ('22222222-2222-2222-2222-222222222222', 'Falskt ärende', 'Skapat i annans namn.', 'ovrigt');
    perform pg_temp.assert(false, 'kund ska inte kunna skapa ärende åt annan kund');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'kund kan inte skapa ärende åt annan kund');
  end;

  -- 3. Kund kan inte tilldela sig prioritet/tekniker vid skapandet.
  begin
    insert into public.tickets (requester_id, subject, description, category_key, status_key)
    values ('11111111-1111-1111-1111-111111111111', 'Fel status', 'Försöker skapa som löst direkt.', 'ovrigt', 'lost');
    perform pg_temp.assert(false, 'kund ska inte kunna välja status vid skapande');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'kund kan inte välja status vid skapande');
  end;

  -- Kund B skapar ett eget ärende.
  perform pg_temp.login('22222222-2222-2222-2222-222222222222');
  insert into public.tickets (requester_id, subject, description, category_key)
  values ('22222222-2222-2222-2222-222222222222', 'Skrivaren svarar inte',
          'Skrivaren hittar inte nätverket längre.', 'skrivare')
  returning id into ticket_b;

  -- 4. Kund A ser bara sitt eget ärende (inkl. direkt uppslag på id = IDOR).
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  select count(*) into n from public.tickets;
  perform pg_temp.assert(n = 1, 'kund A ser endast sitt eget ärende i listan');
  select count(*) into n from public.tickets where id = ticket_b;
  perform pg_temp.assert(n = 0, 'kund A kan inte öppna kund B:s ärende via id (IDOR)');

  -- 5. Tekniker ser båda ärendena.
  perform pg_temp.login('33333333-3333-3333-3333-333333333333');
  select count(*) into n from public.tickets;
  perform pg_temp.assert(n = 2, 'tekniker ser alla ärenden');

  -- 6. Konversation: kundmeddelande syns för tekniker, svar syns för kund.
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  insert into public.ticket_messages (ticket_id, author_id, body, is_from_staff)
  values (ticket_a, '11111111-1111-1111-1111-111111111111', 'Skärmen är helt svart.', false);

  perform pg_temp.login('33333333-3333-3333-3333-333333333333');
  select count(*) into n from public.ticket_messages where ticket_id = ticket_a;
  perform pg_temp.assert(n = 1, 'tekniker ser kundens meddelande');
  insert into public.ticket_messages (ticket_id, author_id, body, is_from_staff)
  values (ticket_a, '33333333-3333-3333-3333-333333333333', 'Testa att hålla in strömknappen i 10 sekunder.', true)
  returning id into msg_id;

  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  select count(*) into n from public.ticket_messages where ticket_id = ticket_a and is_from_staff;
  perform pg_temp.assert(n = 1, 'kund ser teknikerns svar');

  -- Kund kan inte skriva i teknikerns namn.
  begin
    insert into public.ticket_messages (ticket_id, author_id, body, is_from_staff)
    values (ticket_a, '11111111-1111-1111-1111-111111111111', 'Låtsas vara personal.', true);
    perform pg_temp.assert(false, 'kund ska inte kunna skriva som personal');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'kund kan inte skriva meddelande som personal');
  end;

  -- 7. Interna anteckningar: personal ser dem, kunden ser dem aldrig.
  perform pg_temp.login('33333333-3333-3333-3333-333333333333');
  insert into public.ticket_internal_notes (ticket_id, author_id, body)
  values (ticket_a, '33333333-3333-3333-3333-333333333333', 'Kunden har haft samma fel i våras.');
  select count(*) into n from public.ticket_internal_notes where ticket_id = ticket_a;
  perform pg_temp.assert(n = 1, 'tekniker ser intern anteckning');

  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  select count(*) into n from public.ticket_internal_notes;
  perform pg_temp.assert(n = 0, 'kund ser INGA interna anteckningar');
  select count(*) into n from public.ticket_internal_notes where ticket_id = ticket_a;
  perform pg_temp.assert(n = 0, 'kund ser ingen intern anteckning ens på sitt eget ärende');

  begin
    insert into public.ticket_internal_notes (ticket_id, author_id, body)
    values (ticket_a, '11111111-1111-1111-1111-111111111111', 'Kund försöker skriva intern anteckning.');
    perform pg_temp.assert(false, 'kund ska inte kunna skapa intern anteckning');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'kund kan inte skapa intern anteckning');
  end;

  -- 8. Statusflöde: Mottaget → Pågår → Väntar på kund → Löst → Stängt.
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  update public.tickets set status_key = 'pagar' where id = ticket_a;
  get diagnostics n = row_count;
  perform pg_temp.assert(n = 0, 'kund kan inte ändra status');

  perform pg_temp.login('33333333-3333-3333-3333-333333333333');
  update public.tickets set status_key = 'pagar', assignee_id = '33333333-3333-3333-3333-333333333333' where id = ticket_a;
  update public.tickets set status_key = 'vantar_pa_kund' where id = ticket_a;
  update public.tickets set status_key = 'lost' where id = ticket_a;
  select count(*) into n from public.tickets where id = ticket_a and resolved_at is not null;
  perform pg_temp.assert(n = 1, 'resolved_at sätts när ärendet blir Löst');
  update public.tickets set status_key = 'stangt' where id = ticket_a;
  select count(*) into n from public.tickets where id = ticket_a and closed_at is not null;
  perform pg_temp.assert(n = 1, 'closed_at sätts när ärendet blir Stängt');

  select count(*) into n from public.ticket_events
   where ticket_id = ticket_a and event_type = 'status_changed';
  perform pg_temp.assert(n = 4, 'alla fyra statusändringar finns i historiken');

  select count(*) into n from public.tickets where id = ticket_a and first_response_at is not null;
  perform pg_temp.assert(n = 1, 'first_response_at sätts vid personalens första svar');

  -- 9. Kunden kan inte svara på ett stängt ärende.
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  begin
    insert into public.ticket_messages (ticket_id, author_id, body, is_from_staff)
    values (ticket_a, '11111111-1111-1111-1111-111111111111', 'Svar på stängt ärende.', false);
    perform pg_temp.assert(false, 'kund ska inte kunna svara på stängt ärende');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'kund kan inte svara på stängt ärende');
  end;

  -- 10. Historik: kunden ser sin egen historik men inte interna anteckningar.
  select count(*) into n from public.ticket_events where ticket_id = ticket_a;
  perform pg_temp.assert(n > 0, 'kund ser sin ärendehistorik');
  select count(*) into n from public.ticket_events where ticket_id = ticket_a and event_type = 'internal_note';
  perform pg_temp.assert(n = 0, 'kund ser inte att interna anteckningar finns');
  perform pg_temp.login('33333333-3333-3333-3333-333333333333');
  select count(*) into n from public.ticket_events where ticket_id = ticket_a and event_type = 'internal_note';
  perform pg_temp.assert(n = 1, 'tekniker ser internal_note i historiken');

  -- 11. Bilagor.
  perform pg_temp.login('22222222-2222-2222-2222-222222222222');
  insert into public.ticket_attachments (ticket_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  values (ticket_b, '22222222-2222-2222-2222-222222222222',
          'tickets/' || ticket_b || '/skarmbild.png', 'skarmbild.png', 'image/png', 15000);
  select count(*) into n from public.ticket_attachments where ticket_id = ticket_b;
  perform pg_temp.assert(n = 1, 'kund kan ladda upp bilaga på eget ärende');

  perform pg_temp.login('33333333-3333-3333-3333-333333333333');
  insert into public.ticket_attachments (ticket_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, visibility)
  values (ticket_b, '33333333-3333-3333-3333-333333333333',
          'tickets/' || ticket_b || '/intern-logg.txt', 'intern-logg.txt', 'text/plain', 2048, 'internal');

  perform pg_temp.login('22222222-2222-2222-2222-222222222222');
  select count(*) into n from public.ticket_attachments where ticket_id = ticket_b;
  perform pg_temp.assert(n = 1, 'kund ser inte personalens interna bilaga');

  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  select count(*) into n from public.ticket_attachments where ticket_id = ticket_b;
  perform pg_temp.assert(n = 0, 'annan kund ser inga bilagor på ärendet');

  -- 12. Organisation: kontaktpersonen ser organisationens ärenden, kollegan bara sina egna.
  perform pg_temp.login('44444444-4444-4444-4444-444444444444');
  insert into public.tickets (requester_id, organization_id, subject, description, category_key)
  values ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000001',
          'E-post fastnar i utkorgen', 'Utgående e-post fastnar i utkorgen sedan i morse.', 'epost')
  returning id into ticket_org;

  perform pg_temp.login('55555555-5555-5555-5555-555555555555');
  select count(*) into n from public.tickets where id = ticket_org;
  perform pg_temp.assert(n = 1, 'organisationens kontaktperson ser kollegans ärende');
  select count(*) into n from public.tickets where id = ticket_a;
  perform pg_temp.assert(n = 0, 'kontaktpersonen ser inte privatkunders ärenden');

  perform pg_temp.login('44444444-4444-4444-4444-444444444444');
  select count(*) into n from public.tickets;
  perform pg_temp.assert(n = 1, 'vanlig medarbetare ser bara sitt eget ärende');

  -- 13. Rollhöjning är inte möjlig för kunden.
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
  perform pg_temp.logout();
  select count(*) into n from public.profiles
   where id = '11111111-1111-1111-1111-111111111111' and role = 'customer';
  perform pg_temp.assert(n = 1, 'kund kan inte höja sin egen roll');

  -- 14. Oinloggad (anon) når ingenting.
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    select count(*) into n from public.tickets;
    perform pg_temp.assert(n = 0, 'oinloggad ser inga ärenden');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'oinloggad saknar behörighet till ärenden helt');
  end;
  reset role;

  -- 15. Sökning mot riktig data (fritext + filter).
  perform pg_temp.login('33333333-3333-3333-3333-333333333333');
  select count(*) into n from public.tickets
   where to_tsvector('swedish', reference || ' ' || subject || ' ' || description)
         @@ plainto_tsquery('swedish', 'skrivaren');
  perform pg_temp.assert(n = 1, 'fritextsökning hittar rätt ärende');
  select count(*) into n from public.tickets where status_key = 'stangt' and priority_key = 'normal';
  perform pg_temp.assert(n = 1, 'filter på status och prioritet fungerar');
  perform pg_temp.logout();

  raise notice 'ALLA SÄKERHETSTESTER GICK IGENOM';
end;
$$;


-- ============================================================================
-- Central supportauktoritet (ägarbeslut 2026-10-13)
-- ============================================================================

insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'superadmin@example.test'),
  ('77777777-7777-7777-7777-777777777777', 'konsult@example.test');

-- Superadministratören tilldelas globalt av plattformsägaren (service_role).
insert into public.support_role_grants (grantee_id, role_key, scope, reason)
values ('66666666-6666-6666-6666-666666666666', 'BERRYIT_SUPPORT_SUPER_ADMIN', 'global', 'Ägarbeslut: supportauktoritet');

do $$
declare
  org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  ticket_org uuid;
  ticket_private uuid;
  grant_id uuid;
  n int;
begin
  select id into ticket_org from public.tickets where organization_id = org limit 1;
  select id into ticket_private from public.tickets where requester_id = '11111111-1111-1111-1111-111111111111' limit 1;

  -- 1. Superadmin har alla scopes och ses som personal.
  perform pg_temp.login('66666666-6666-6666-6666-666666666666');
  perform pg_temp.assert(public.is_support_super_admin(), 'superadmin känns igen av auktoritetslagret');
  perform pg_temp.assert(public.has_support_permission('roles.grant'), 'superadmin har roles.grant');
  perform pg_temp.assert(public.has_support_permission('onarly.entitlements.manage'), 'superadmin kan hantera ONARLY-rättigheter');

  -- 2. Superadmin delegerar support för EN kundorganisation.
  insert into public.support_role_grants (grantee_id, role_key, scope, organization_id, reason, granted_by)
  values ('77777777-7777-7777-7777-777777777777', 'BERRYIT_SUPPORT_TECHNICIAN', 'organization', org,
          'Tillfälligt uppdrag hos kunden', '66666666-6666-6666-6666-666666666666')
  returning id into grant_id;
  perform pg_temp.assert(grant_id is not null, 'superadmin kan delegera support per organisation');

  -- 3. Den delegerade ser organisationens ärende – men inte privatkundens.
  perform pg_temp.login('77777777-7777-7777-7777-777777777777');
  select count(*) into n from public.tickets where id = ticket_org;
  perform pg_temp.assert(n = 1, 'delegerad tekniker ser organisationens ärende');
  select count(*) into n from public.tickets where id = ticket_private;
  perform pg_temp.assert(n = 0, 'delegerad tekniker ser INTE ärenden utanför sitt scope');
  select count(*) into n from public.ticket_internal_notes;
  perform pg_temp.assert(n = 0, 'delegerad tekniker ser inga interna anteckningar utanför sitt scope');

  update public.tickets set status_key = 'pagar' where id = ticket_org;
  get diagnostics n = row_count;
  perform pg_temp.assert(n = 1, 'delegerad tekniker får arbeta i sitt scope');

  -- 4. Den delegerade kan inte dela ut behörighet vidare.
  begin
    insert into public.support_role_grants (grantee_id, role_key, scope, reason, granted_by)
    values ('22222222-2222-2222-2222-222222222222', 'BERRYIT_SUPPORT_SUPER_ADMIN', 'global',
            'Försök till rättighetshöjning', '77777777-7777-7777-7777-777777777777');
    perform pg_temp.assert(false, 'tekniker ska inte kunna dela ut roller');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'tekniker utan roles.grant kan inte dela ut roller');
  end;

  -- 5. Återkallelse slår igenom omedelbart.
  perform pg_temp.login('66666666-6666-6666-6666-666666666666');
  update public.support_role_grants
     set revoked_at = now(), revoked_by = '66666666-6666-6666-6666-666666666666', revoke_reason = 'Uppdraget avslutat'
   where id = grant_id;

  perform pg_temp.login('77777777-7777-7777-7777-777777777777');
  select count(*) into n from public.tickets where id = ticket_org;
  perform pg_temp.assert(n = 0, 'återkallad behörighet ger omedelbart ingen åtkomst');
  update public.tickets set status_key = 'lost' where id = ticket_org;
  get diagnostics n = row_count;
  perform pg_temp.assert(n = 0, 'återkallad tekniker kan inte längre ändra ärendet');

  -- 6. Utgången tilldelning ger ingen åtkomst.
  perform pg_temp.logout();
  insert into public.support_role_grants (grantee_id, role_key, scope, organization_id, reason, granted_at, expires_at)
  values ('77777777-7777-7777-7777-777777777777', 'BERRYIT_SUPPORT_TECHNICIAN', 'organization', org,
          'Utgånget uppdrag', now() - interval '2 days', now() - interval '1 day');
  perform pg_temp.login('77777777-7777-7777-7777-777777777777');
  select count(*) into n from public.tickets where id = ticket_org;
  perform pg_temp.assert(n = 0, 'utgången tilldelning ger ingen åtkomst');

  -- 7. ONARLY DESK-rättighet beviljas och återkallas av superadmin.
  perform pg_temp.login('66666666-6666-6666-6666-666666666666');
  insert into public.onarly_support_entitlements (organization_id, product_key, entitlement, reason, granted_by)
  values (org, 'onarly_desk', 'remote_support', 'Kundavtal', '66666666-6666-6666-6666-666666666666');
  select count(*) into n from public.onarly_support_entitlements where organization_id = org and revoked_at is null;
  perform pg_temp.assert(n = 1, 'superadmin kan bevilja ONARLY DESK-rättighet');

  -- 8. Revision: aktör, mål, scope och skäl loggas för varje behörighetsändring.
  select count(*) into n from public.support_admin_audit
   where action = 'role.granted'
     and target_id = '77777777-7777-7777-7777-777777777777'
     and actor_id = '66666666-6666-6666-6666-666666666666'
     and scope = 'organization'
     and reason = 'Tillfälligt uppdrag hos kunden';
  perform pg_temp.assert(n = 1, 'tilldelning loggas med aktör, mål, scope och skäl');
  select count(*) into n from public.support_admin_audit
   where action = 'role.revoked' and reason = 'Uppdraget avslutat';
  perform pg_temp.assert(n = 1, 'återkallelse loggas med skäl');
  select count(*) into n from public.support_admin_audit where action = 'onarly_entitlement.granted';
  perform pg_temp.assert(n = 1, 'ONARLY-rättighet loggas');

  -- 9. Kunden når varken rollkatalog eller revisionshistorik.
  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  select count(*) into n from public.support_admin_audit;
  perform pg_temp.assert(n = 0, 'kund kan inte läsa administrativ revisionshistorik');
  select count(*) into n from public.support_role_grants;
  perform pg_temp.assert(n = 0, 'kund ser inga behörighetstilldelningar');
  select count(*) into n from public.support_roles;
  perform pg_temp.assert(n = 0, 'kund ser inte rollkatalogen');
  perform pg_temp.logout();

  raise notice 'AUKTORITETSTESTER GICK IGENOM';
end;
$$;


-- ============================================================================
-- PASS 1A: härdad auktoritet – delegation, rättighetshöjning, oföränderlighet
-- ============================================================================

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888888', 'orgadmin@example.test'),
  ('99999999-9999-9999-9999-999999999999', 'nyteknik@example.test');

do $BLOCK$
declare
  org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  ticket_org uuid;
  grant_id uuid;
  audit_id bigint;
  ent_id uuid;
  n int;
begin
  select id into ticket_org from public.tickets where organization_id = org limit 1;

  -- Ny delegerad tekniker för organisationen (superadmin delar ut).
  perform pg_temp.login('66666666-6666-6666-6666-666666666666');
  insert into public.support_role_grants (grantee_id, role_key, scope, organization_id, reason, granted_by)
  values ('99999999-9999-9999-9999-999999999999', 'BERRYIT_SUPPORT_TECHNICIAN', 'organization', org,
          'Uppdrag hos kunden', '66666666-6666-6666-6666-666666666666')
  returning id into grant_id;

  -- 1. Delegerad tekniker kan faktiskt arbeta i sitt scope.
  perform pg_temp.login('99999999-9999-9999-9999-999999999999');
  insert into public.ticket_messages (ticket_id, author_id, body, is_from_staff)
  values (ticket_org, '99999999-9999-9999-9999-999999999999', 'Vi tittar på e-postkon nu.', true);
  perform pg_temp.assert(true, 'delegerad tekniker kan svara kunden i sitt scope');

  insert into public.ticket_internal_notes (ticket_id, author_id, body)
  values (ticket_org, '99999999-9999-9999-9999-999999999999', 'Kontrollera utgående kö på servern.');
  select count(*) into n from public.ticket_internal_notes where ticket_id = ticket_org;
  perform pg_temp.assert(n = 1, 'delegerad tekniker kan skriva och läsa intern anteckning i sitt scope');

  insert into public.ticket_attachments (ticket_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, visibility)
  values (ticket_org, '99999999-9999-9999-9999-999999999999',
          'tickets/' || ticket_org || '/kologg.txt', 'kologg.txt', 'text/plain', 1024, 'internal');
  perform pg_temp.assert(true, 'delegerad tekniker kan bifoga intern fil i sitt scope');

  -- 2. Kunden i organisationen ser svaret men inte det interna.
  perform pg_temp.login('44444444-4444-4444-4444-444444444444');
  select count(*) into n from public.ticket_messages where ticket_id = ticket_org and is_from_staff;
  perform pg_temp.assert(n = 1, 'kunden ser den delegerade teknikerns svar');
  select count(*) into n from public.ticket_internal_notes;
  perform pg_temp.assert(n = 0, 'kunden ser inte den delegerade teknikerns interna anteckning');
  select count(*) into n from public.ticket_attachments where ticket_id = ticket_org;
  perform pg_temp.assert(n = 0, 'kunden ser inte den interna bilagan');

  -- 3. Rättighetshöjning är blockerad i tre riktningar.
  perform pg_temp.login('66666666-6666-6666-6666-666666666666');
  insert into public.support_role_grants (grantee_id, role_key, scope, organization_id, reason, granted_by)
  values ('88888888-8888-8888-8888-888888888888', 'BERRYIT_SUPPORT_ADMIN', 'organization', org,
          'Kundansvarig', '66666666-6666-6666-6666-666666666666');

  perform pg_temp.login('88888888-8888-8888-8888-888888888888');
  begin
    insert into public.support_role_grants (grantee_id, role_key, scope, reason, granted_by)
    values ('99999999-9999-9999-9999-999999999999', 'BERRYIT_SUPPORT_SUPER_ADMIN', 'global',
            'Forsok till global hojning', '88888888-8888-8888-8888-888888888888');
    perform pg_temp.assert(false, 'org-admin ska inte kunna dela ut globala roller');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'org-admin kan inte dela ut globala roller');
  end;

  begin
    insert into public.support_role_grants (grantee_id, role_key, scope, organization_id, reason, granted_by)
    values ('99999999-9999-9999-9999-999999999999', 'BERRYIT_SUPPORT_SUPER_ADMIN', 'organization', org,
            'Forsok till hojning i scope', '88888888-8888-8888-8888-888888888888');
    perform pg_temp.assert(false, 'org-admin ska inte kunna dela ut superadmin i sitt scope');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'org-admin kan inte dela ut en roll over sin egen rang');
  end;

  begin
    insert into public.support_role_grants (grantee_id, role_key, scope, organization_id, reason, granted_by)
    values ('99999999-9999-9999-9999-999999999999', 'BERRYIT_SUPPORT_ADMIN', 'organization', org,
            'Forsok till samma rang', '88888888-8888-8888-8888-888888888888');
    perform pg_temp.assert(false, 'org-admin ska inte kunna dela ut sin egen rang');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'org-admin kan inte dela ut sin egen rang');
  end;

  -- 4. Tilldelningar är oföränderliga – bara återkallelse är tillåten.
  perform pg_temp.login('66666666-6666-6666-6666-666666666666');
  begin
    update public.support_role_grants set role_key = 'BERRYIT_SUPPORT_SUPER_ADMIN' where id = grant_id;
    perform pg_temp.assert(false, 'tilldelning ska inte kunna skrivas om');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'tilldelningens roll kan inte andras i efterhand');
  end;

  begin
    update public.support_role_grants set expires_at = now() + interval '10 years' where id = grant_id;
    perform pg_temp.assert(false, 'giltighetstid ska inte kunna forlangas i efterhand');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'giltighetstid kan inte forlangas i efterhand');
  end;

  update public.support_role_grants
     set revoked_at = now(), revoked_by = '66666666-6666-6666-6666-666666666666', revoke_reason = 'Uppdraget klart'
   where id = grant_id;
  begin
    update public.support_role_grants set revoked_at = null, revoke_reason = null where id = grant_id;
    perform pg_temp.assert(false, 'aterkallad tilldelning ska inte kunna reaktiveras');
  exception when insufficient_privilege or check_violation then
    perform pg_temp.assert(true, 'aterkallad tilldelning kan inte reaktiveras');
  end;

  -- 5. Revisionen är append-only även för den som får läsa den.
  perform pg_temp.assert(public.has_support_permission('audit.read'), 'superadmin far lasa revisionen');
  select id into audit_id from public.support_admin_audit order by id limit 1;
  begin
    update public.support_admin_audit set reason = 'omskriven' where id = audit_id;
    perform pg_temp.assert(false, 'revisionen ska inte kunna andras');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'revisionen kan inte andras');
  end;
  begin
    delete from public.support_admin_audit where id = audit_id;
    perform pg_temp.assert(false, 'revisionen ska inte kunna raderas');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'revisionen kan inte raderas');
  end;
  begin
    insert into public.support_admin_audit (action, target_type) values ('fejkad.rad', 'profile');
    perform pg_temp.assert(false, 'revisionsrader ska inte kunna skrivas av klient');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'revisionsrader kan inte skrivas av klient');
  end;

  -- 6. Ärendehistoriken kan inte heller skrivas av klient.
  begin
    insert into public.ticket_events (ticket_id, event_type) values (ticket_org, 'status_changed');
    perform pg_temp.assert(false, 'arendehistorik ska inte kunna skrivas av klient');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'arendehistorik kan inte skrivas av klient');
  end;

  -- 7. ONARLY-rättigheter: oföränderliga, återkallelse loggas, kund ser bara sin egen.
  select id into ent_id from public.onarly_support_entitlements where organization_id = org limit 1;
  begin
    update public.onarly_support_entitlements set entitlement = 'full_access' where id = ent_id;
    perform pg_temp.assert(false, 'ONARLY-rattighet ska inte kunna skrivas om');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'ONARLY-rattighet kan inte skrivas om');
  end;

  update public.onarly_support_entitlements
     set revoked_at = now(), revoked_by = '66666666-6666-6666-6666-666666666666', revoke_reason = 'Avtal avslutat'
   where id = ent_id;
  select count(*) into n from public.support_admin_audit
   where action = 'onarly_entitlement.revoked' and reason = 'Avtal avslutat';
  perform pg_temp.assert(n = 1, 'aterkallad ONARLY-rattighet loggas med skal');

  perform pg_temp.login('11111111-1111-1111-1111-111111111111');
  select count(*) into n from public.onarly_support_entitlements;
  perform pg_temp.assert(n = 0, 'privatkund ser inga ONARLY-rattigheter for andra organisationer');
  perform pg_temp.logout();

  raise notice 'PASS 1A-TESTER GICK IGENOM';
end;
$BLOCK$;

rollback;
