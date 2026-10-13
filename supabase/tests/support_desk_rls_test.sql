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
--
-- aal speglar GoTrues claim: aal1 efter lösenord, aal2 efter verifierad TOTP.
-- Förvalet är aal2, så att de befintliga testerna beskriver en fullt inloggad
-- användare. Nivån sätts uttryckligen i de test som handlar om MFA-kravet.
-- En inloggning motsvarar en rad i GoTrues auth.sessions plus en JWT som pekar
-- på den. Sessionen behövs för att privilegierade kontroller ska gå igenom:
-- databasen litar inte på signaturen ensam.
-- Sessionsraden ägs av GoTrue och skrivs därför med definer-rättighet. Rollbytet
-- måste ske utanför en sådan funktion, så det ligger kvar i login().
create or replace function pg_temp.ensure_session(uid uuid, aal text)
returns uuid language plpgsql security definer as $$
declare
  sid uuid;
begin
  select s.id into sid from auth.sessions s where s.user_id = uid limit 1;
  if sid is null then
    sid := gen_random_uuid();
    insert into auth.sessions (id, user_id, aal) values (sid, uid, aal);
  else
    update auth.sessions set aal = ensure_session.aal where id = sid;
  end if;
  return sid;
end;
$$;

create or replace function pg_temp.login(uid uuid, aal text default 'aal2')
returns void language plpgsql as $$
declare
  sid uuid := pg_temp.ensure_session(uid, aal);
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal, 'session_id', sid)::text,
    true
  );
  execute 'set local role authenticated';
end;
$$;

-- Utloggning server-side: GoTrue raderar sessionsraden. Token kan fortfarande
-- vara signerad och ogången – poängen är att den inte längre ska duga till
-- något privilegierat.
create or replace function pg_temp.revoke_session(uid uuid)
returns void language plpgsql security definer as $$
begin
  delete from auth.sessions where user_id = uid;
end;
$$;

-- GoTrue sätter not_after när en session ska sluta gälla. Hjälparna nedan
-- skriver den kolumnen, också med definer-rättighet.
create or replace function pg_temp.expire_session(uid uuid)
returns void language plpgsql security definer as $$
begin
  update auth.sessions set not_after = now() - interval '1 minute' where user_id = uid;
end;
$$;

create or replace function pg_temp.unexpire_session(uid uuid)
returns void language plpgsql security definer as $$
begin
  update auth.sessions set not_after = null where user_id = uid;
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

-- ============================================================================
-- PASS 2C: tvåfaktor som krav i databasen
--
-- Frågan som prövas här är inte vad gränssnittet visar, utan vad databasen
-- lämnar ut till någon som struntar i gränssnittet och anropar API:t direkt
-- med en giltig aal1-token.
-- ============================================================================

insert into auth.users (id, email) values
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'admin.profil@example.test'),
  ('cccccccc-0000-0000-0000-00000000000c', 'maskin@example.test'),
  ('dddddddd-0000-0000-0000-00000000000d', 'scoped.tekniker@example.test');

update public.profiles set role = 'admin', full_name = 'Admin via profilroll'
  where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
update public.profiles set is_machine = true, full_name = 'Infrastrukturagent'
  where id = 'cccccccc-0000-0000-0000-00000000000c';

insert into public.support_role_grants (grantee_id, role_key, scope, reason)
values ('cccccccc-0000-0000-0000-00000000000c', 'BERRYIT_SUPPORT_TECHNICIAN', 'global',
        'Maskinidentitet for infrastrukturrapportering');

insert into public.support_role_grants (grantee_id, role_key, scope, organization_id, reason)
values ('dddddddd-0000-0000-0000-00000000000d', 'BERRYIT_SUPPORT_TECHNICIAN', 'organization',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Levande uppdrag hos kunden');

-- Konsulten fran auktoritetstesterna har bade en aterkallad och en utgangen
-- tilldelning. PASS 2C behover en levande scoped tekniker, sa en egen skapas.

do $BLOCK2C$
declare
  org uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  superadmin uuid := '66666666-6666-6666-6666-666666666666';
  scoped uuid := 'dddddddd-0000-0000-0000-00000000000d';
  kund uuid := '11111111-1111-1111-1111-111111111111';
  tekniker uuid := '33333333-3333-3333-3333-333333333333';
  adminprofil uuid := 'bbbbbbbb-0000-0000-0000-00000000000b';
  maskin uuid := 'cccccccc-0000-0000-0000-00000000000c';
  ticket_org uuid;
  n int;
begin
  select id into ticket_org from public.tickets where organization_id = org limit 1;

  -- 74-77. Superadmin med enbart losenord far inga privilegier.
  perform pg_temp.login(superadmin, 'aal1');
  perform pg_temp.assert(public.current_aal() = 'aal1', 'aal-claim lases ur JWT');
  perform pg_temp.assert(not public.mfa_satisfied(), 'aal1 uppfyller inte MFA-kravet');
  perform pg_temp.assert(not public.is_support_super_admin(), 'superadmin med aal1 raknas inte som superadmin');
  perform pg_temp.assert(not public.is_admin(), 'superadmin med aal1 raknas inte som admin');

  -- 78-80. De kansliga behorigheterna ar stangda utan aal2.
  perform pg_temp.assert(not public.has_support_permission('roles.grant'),
    'roles.grant nekas utan aal2');
  perform pg_temp.assert(not public.has_support_permission('audit.read'),
    'audit.read nekas utan aal2');
  perform pg_temp.assert(not public.has_support_permission('onarly.entitlements.manage'),
    'onarly.entitlements.manage nekas utan aal2');

  -- 81. Revisionen gar inte att lasa utan aal2 (direkt mot tabellen).
  select count(*) into n from public.support_admin_audit;
  perform pg_temp.assert(n = 0, 'revisionsloggen ar tom for aal1 trots giltig token');

  -- 82. ONARLY-registret ar operativ information som personal far lasa aven
  --     utan MFA (oforandrat sedan PASS 1D). Det kansliga ar att andra i det,
  --     vilket provas i 84.
  select count(*) into n from public.onarly_support_entitlements;
  perform pg_temp.assert(n >= 0, 'ONARLY-registret ar lasbart for personal utan MFA');

  -- 83-84. Behorighet kan inte delas ut utan aal2 - varken via policy eller trigger.
  begin
    insert into public.support_role_grants (grantee_id, role_key, scope, organization_id, reason, granted_by)
    values (kund, 'BERRYIT_SUPPORT_TECHNICIAN', 'organization', org, 'Forsok utan MFA', superadmin);
    perform pg_temp.assert(false, 'tilldelning utan aal2 ska nekas');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'tilldelning utan aal2 nekas');
  end;

  begin
    insert into public.onarly_support_entitlements (organization_id, product_key, entitlement, reason, granted_by)
    values (org, 'onarly_desk', 'remote_support', 'Forsok utan MFA', superadmin);
    perform pg_temp.assert(false, 'ONARLY-rattighet utan aal2 ska nekas');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'ONARLY-rattighet utan aal2 nekas');
  end;

  -- 85. Superadmin med aal1 behaller personalatkomst till arenden
  --     (tickets.read kraver inte MFA) - arendearbetet far inte stanna.
  perform pg_temp.assert(public.is_staff(), 'superadmin med aal1 ar fortfarande personal');
  select count(*) into n from public.tickets where id = ticket_org;
  perform pg_temp.assert(n = 1, 'superadmin med aal1 kan fortsatta arbeta med arenden');

  -- 86-89. Med aal2 ar allt pa plats igen.
  perform pg_temp.login(superadmin, 'aal2');
  perform pg_temp.assert(public.mfa_satisfied(), 'aal2 uppfyller MFA-kravet');
  perform pg_temp.assert(public.is_support_super_admin(), 'superadmin med aal2 far sina privilegier');
  perform pg_temp.assert(public.has_support_permission('roles.grant'), 'roles.grant tillats med aal2');
  select count(*) into n from public.support_admin_audit;
  perform pg_temp.assert(n > 0, 'revisionsloggen lases med aal2');

  -- 90. Och tilldelningen gar igenom nar kravet ar uppfyllt.
  insert into public.support_role_grants (grantee_id, role_key, scope, organization_id, reason, granted_by)
  values (kund, 'BERRYIT_SUPPORT_TECHNICIAN', 'organization', org, 'Tillatet med MFA', superadmin);
  select count(*) into n from public.support_role_grants
   where grantee_id = kund and revoked_at is null;
  perform pg_temp.assert(n = 1, 'tilldelning med aal2 gar igenom');

  -- 91-93. Scoped tekniker paverkas inte av kravet.
  perform pg_temp.login(scoped, 'aal1');
  perform pg_temp.assert(public.has_support_permission('tickets.read', org),
    'scoped tekniker behaller tickets.read utan MFA');
  select count(*) into n from public.tickets where id = ticket_org;
  perform pg_temp.assert(n = 1, 'scoped tekniker ser fortfarande sin organisations arende');
  perform pg_temp.assert(not public.has_support_permission('roles.grant'),
    'scoped tekniker far anda inte dela ut behorigheter');

  -- 94-95. Tekniker (profilroll) och kund arbetar som forut.
  perform pg_temp.login(tekniker, 'aal1');
  perform pg_temp.assert(public.is_staff(), 'tekniker ar personal utan MFA');
  select count(*) into n from public.tickets;
  perform pg_temp.assert(n > 1, 'tekniker ser arenden utan MFA');

  perform pg_temp.login(kund, 'aal1');
  select count(*) into n from public.tickets where requester_id = kund;
  perform pg_temp.assert(n > 0, 'kund ser sina egna arenden utan MFA');

  -- 96-97. Profilrollen admin kraver ocksa aal2 for administration,
  --        men behaller sin personalatkomst.
  perform pg_temp.login(adminprofil, 'aal1');
  perform pg_temp.assert(not public.is_admin(), 'profilrollen admin kraver aal2 for administration');
  perform pg_temp.assert(public.is_staff(), 'profilrollen admin ar fortfarande personal utan MFA');
  perform pg_temp.login(adminprofil, 'aal2');
  perform pg_temp.assert(public.is_admin(), 'profilrollen admin far sina rattigheter med aal2');

  -- 98-99. Maskinidentitet last ute vore ett driftstopp - den ar undantagen,
  --        men bara for det den redan har behorighet till.
  perform pg_temp.login(maskin, 'aal1');
  perform pg_temp.assert(public.mfa_satisfied(), 'maskinidentitet uppfyller kravet utan TOTP');
  perform pg_temp.assert(public.is_staff(), 'maskinidentitet behaller sin personalatkomst');
  perform pg_temp.assert(not public.is_support_super_admin(),
    'maskinidentitet far inte superadmin-rattigheter pa kopet');

  -- 100. En vanlig anvandare kan inte gora sig sjalv till maskinidentitet.
  perform pg_temp.login(kund, 'aal2');
  update public.profiles set is_machine = true where id = kund;
  select count(*) into n from public.profiles where id = kund and is_machine;
  perform pg_temp.assert(n = 0, 'kund kan inte satta is_machine pa sig sjalv');

  -- 101. Token helt utan aal-claim (aldre session) ger inga privilegier.
  perform set_config('request.jwt.claims',
    json_build_object('sub', superadmin, 'role', 'authenticated')::text, true);
  perform pg_temp.assert(not public.mfa_satisfied(), 'token utan aal-claim uppfyller inte kravet');
  perform pg_temp.assert(not public.is_support_super_admin(), 'token utan aal-claim ger inga privilegier');

  -- 102. Service_role ar betrodd backend och last inte ute.
  perform set_config('request.jwt.claims',
    json_build_object('sub', null, 'role', 'service_role')::text, true);
  perform pg_temp.assert(public.is_trusted_backend(), 'service_role raknas som betrodd backend');
  perform pg_temp.assert(public.mfa_satisfied(), 'service_role omfattas inte av MFA-kravet');


  -- ------------------------------------------------------------------
  -- Hotmodell (driftsattningsgrind PASS 2C)
  -- ------------------------------------------------------------------

  -- 103. Ett anonymt API-anrop ar inte en betrodd backend. PostgREST satter
  --      alltid en roll-claim, sa avsaknad av anvandare racker inte.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform pg_temp.assert(not public.is_trusted_backend(), 'anon-nyckel raknas inte som betrodd backend');
  perform pg_temp.assert(not public.mfa_satisfied(), 'anon uppfyller inte MFA-kravet');
  perform pg_temp.assert(not public.is_support_super_admin(), 'anon far inga superadmin-rattigheter');
  perform pg_temp.assert(not public.is_admin(), 'anon far inga adminrattigheter');
  perform pg_temp.assert(not public.is_staff(), 'anon raknas inte som personal');

  -- 104. Ett internt anrop helt utan claims (trigger, migration, psql) ar det.
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.assert(public.is_trusted_backend(), 'internt anrop utan claims ar betrodd backend');

  -- 105. En anvandare som pastar sig vara service_role i sin payload far inga
  --      rattigheter utan tilldelning. (Signaturen skulle aldrig halla i
  --      verkligheten - kontrollen ska anda inte vila pa payloaden.)
  perform set_config('request.jwt.claims',
    json_build_object('sub', kund, 'role', 'service_role')::text, true);
  perform pg_temp.assert(not public.is_admin(), 'pastadd service_role-claim ger inga adminrattigheter');
  perform pg_temp.assert(not public.is_support_super_admin(), 'pastadd service_role-claim ger inte superadmin');

  -- 106. aal-varden som inte ar exakt "aal2" accepteras inte.
  perform pg_temp.login(superadmin, 'AAL2');
  perform pg_temp.assert(not public.mfa_satisfied(), 'aal-varde i versaler accepteras inte');
  perform pg_temp.login(superadmin, 'aal3');
  perform pg_temp.assert(not public.mfa_satisfied(), 'okant aal-varde accepteras inte');
  perform pg_temp.login(superadmin, '');
  perform pg_temp.assert(not public.mfa_satisfied(), 'tomt aal-varde accepteras inte');

  -- 107. Maskinidentitet kan inte sattas av personal utan adminratt.
  perform pg_temp.login(tekniker, 'aal2');
  update public.profiles set is_machine = true where id = kund;
  perform pg_temp.logout();
  select count(*) into n from public.profiles where id = kund and is_machine;
  perform pg_temp.assert(n = 0, 'tekniker kan inte gora nagon annan till maskinidentitet');

  -- 108. En maskinidentitet som avaktiveras tappar sitt undantag omedelbart.
  update public.profiles set is_active = false where id = maskin;
  perform pg_temp.login(maskin, 'aal1');
  perform pg_temp.assert(not public.mfa_satisfied(), 'avaktiverad maskinidentitet uppfyller inte kravet');
  perform pg_temp.logout();
  update public.profiles set is_active = true where id = maskin;


  -- 122-126. Levande session kravs for allt privilegierat.
  --
  -- En signerad token sager bara att den en gang utfardades. Loggar nagon ut
  -- raderar GoTrue sessionsraden, medan PostgREST fortsatter att acceptera
  -- samma token tills den gar ut. Darfor kontrolleras sessionen separat.
  perform pg_temp.login(superadmin, 'aal2');
  perform pg_temp.assert(public.session_is_live(), 'levande session kanns igen');
  perform pg_temp.assert(public.is_support_super_admin(), 'superadmin med levande session har sina rattigheter');

  perform pg_temp.revoke_session(superadmin);
  perform pg_temp.assert(not public.session_is_live(), 'raderad session kanns igen som dod');
  perform pg_temp.assert(not public.mfa_satisfied(), 'utloggad session uppfyller inte MFA-kravet');
  perform pg_temp.assert(not public.is_support_super_admin(),
    'samma token ger inga privilegier efter utloggning');
  perform pg_temp.assert(not public.has_support_permission('roles.grant'),
    'roles.grant nekas efter utloggning trots giltig signatur');

  -- 127. Men arendearbetet stoppas inte av sessionskontrollen - den galler
  --      bara det privilegierade. En tekniker som nyss loggat ut har anda en
  --      token som gar ut inom kort, och ska inte mota ett trasigt granssnitt.
  perform pg_temp.login(tekniker, 'aal1');
  perform pg_temp.revoke_session(tekniker);
  select count(*) into n from public.tickets;
  perform pg_temp.assert(n > 1, 'arendearbete paverkas inte av sessionskontrollen');

  -- 128. Utgangen session (not_after passerad) raknas inte som levande.
  perform pg_temp.login(superadmin, 'aal2');
  perform pg_temp.expire_session(superadmin);
  perform pg_temp.assert(not public.session_is_live(), 'session med passerad not_after ar inte levande');
  perform pg_temp.unexpire_session(superadmin);

  -- 129. Token utan session_id duger inte heller.
  perform set_config('request.jwt.claims',
    json_build_object('sub', superadmin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform pg_temp.assert(not public.session_is_live(), 'token utan session_id raknas inte som levande');
  perform pg_temp.assert(not public.is_support_super_admin(), 'token utan session_id ger inga privilegier');

  -- 130. Pahittat session_id ger ingenting.
  perform set_config('request.jwt.claims',
    json_build_object('sub', superadmin, 'role', 'authenticated', 'aal', 'aal2',
                      'session_id', '00000000-0000-0000-0000-0000000000ff')::text, true);
  perform pg_temp.assert(not public.session_is_live(), 'okant session_id raknas inte som levande');

  -- 131. Betrodd backend har ingen session och ska inte krava nagon.
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  perform pg_temp.assert(public.session_is_live(), 'service_role kraver ingen sessionsrad');
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.logout();

  raise notice 'PASS 2C-TESTER GICK IGENOM';
end;
$BLOCK2C$;

-- ============================================================================
-- PASS 2D: systemregister och Connector Engine
--
-- Frågorna här är desamma som i resten av sviten: vad lamnar databasen ut till
-- den som struntar i granssnittet? Registret vet var kundernas system kor och
-- under vilken identitet vi ar inne i dem - det far inte lacka.
-- ============================================================================

insert into auth.users (id, email) values
  ('eeeeeeee-0000-0000-0000-00000000000e', 'kund.c@example.com');

insert into public.organizations (id, name, is_internal) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Kund B AB', false),
  ('aaaaaaaa-0000-0000-0000-00000000000b', 'BERRYiT (intern)', true);

update public.profiles
   set organization_id = 'aaaaaaaa-0000-0000-0000-000000000002', full_name = 'Kund C'
 where id = 'eeeeeeee-0000-0000-0000-00000000000e';

-- Projekt, nod och tjanst i tva olika kundorganisationer plus ett internt.
insert into public.support_projects (id, organization_id, name, created_by) values
  ('bbbb0000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Kundportal', '33333333-3333-3333-3333-333333333333'),
  ('bbbb0000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'Webbshop', '33333333-3333-3333-3333-333333333333'),
  ('bbbb0000-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-00000000000b',
   'BERRYiT Control Center', '33333333-3333-3333-3333-333333333333');

insert into public.infra_nodes (id, organization_id, name, hostname, node_kind) values
  ('cccc0000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'kund-a-vps', 'a.example.test', 'server'),
  ('cccc0000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'kund-b-vps', 'b.example.test', 'server');

insert into public.infra_services (id, organization_id, project_id, node_id, name, service_kind, url) values
  ('dddd0000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbb0000-0000-0000-0000-000000000001', 'cccc0000-0000-0000-0000-000000000001',
   'portal-web', 'web', 'https://portal.example.test'),
  ('dddd0000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'bbbb0000-0000-0000-0000-000000000002', 'cccc0000-0000-0000-0000-000000000002',
   'shop-api', 'api', 'https://shop.example.test');

insert into public.connector_integrations
  (id, organization_id, connector_key, display_name, scope_kind, service_id, config, secret_ref, is_enabled, status)
values
  ('ffff0000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'http_health', 'Portalens halsa', 'service', 'dddd0000-0000-0000-0000-000000000001',
   '{"url": "https://portal.example.test/health"}'::jsonb, null, true, 'connected'),
  ('ffff0000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'github', 'Webbshoppens repo', 'service', 'dddd0000-0000-0000-0000-000000000002',
   '{"repository": "kundb/webbshop"}'::jsonb, 'github_kundb', true, 'connected');

insert into public.service_status_checks (organization_id, service_id, status_key, source, latency_ms) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-000000000001', 'ok', 'http_health', 120),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dddd0000-0000-0000-0000-000000000002', 'down', 'github', null);

insert into public.incidents (organization_id, service_id, title, severity) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'dddd0000-0000-0000-0000-000000000002', 'Webbshoppen svarar inte', 'major');

insert into public.connector_activity_log (organization_id, actor_kind, connector_key, action) values
  ('aaaaaaaa-0000-0000-0000-000000000002', 'connector', 'github', 'check');

do $BLOCK2D$
declare
  org_a uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  org_b uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  org_intern uuid := 'aaaaaaaa-0000-0000-0000-00000000000b';
  kund uuid := '11111111-1111-1111-1111-111111111111';
  kund_c uuid := 'eeeeeeee-0000-0000-0000-00000000000e';
  tekniker uuid := '33333333-3333-3333-3333-333333333333';
  superadmin uuid := '66666666-6666-6666-6666-666666666666';
  scoped uuid := 'dddddddd-0000-0000-0000-00000000000d';
  svc_a uuid := 'dddd0000-0000-0000-0000-000000000001';
  svc_b uuid := 'dddd0000-0000-0000-0000-000000000002';
  n int;
begin
  -- 134-138. Kunden ser ingenting av registret. Det finns ingen policy for
  --          customer-rollen, alltsa ingen vag dit genom PostgREST alls.
  --
  -- Kund C anvands har, inte kund A: kund A fick en supporttilldelning i
  -- MFA-testerna ovan och ar darfor inte langre en ren kund. Ett isoleringstest
  -- som kors med fel fixtur bevisar ingenting.
  perform pg_temp.login(kund_c, 'aal2');
  select count(*) into n from public.infra_nodes;
  perform pg_temp.assert(n = 0, 'kund ser inga noder');
  select count(*) into n from public.infra_services;
  perform pg_temp.assert(n = 0, 'kund ser inga tjanster');
  select count(*) into n from public.connector_integrations;
  perform pg_temp.assert(n = 0, 'kund ser inga integrationer');
  select count(*) into n from public.service_status_checks;
  perform pg_temp.assert(n = 0, 'kund ser ingen driftstatus');
  select count(*) into n from public.connector_activity_log;
  perform pg_temp.assert(n = 0, 'kund ser ingen aktivitetslogg');

  -- 139. Inte heller med ett gissat id - RLS filtrerar rader, inte kolumner.
  select count(*) into n from public.infra_services where id = svc_a;
  perform pg_temp.assert(n = 0, 'manipulerat tjanste-id ger kunden ingenting');
  select count(*) into n from public.incidents;
  perform pg_temp.assert(n = 0, 'kund ser inga incidenter');

  -- 140-143. Personal ser registret och kan arbeta med det.
  perform pg_temp.login(tekniker, 'aal1');
  select count(*) into n from public.infra_nodes;
  perform pg_temp.assert(n = 2, 'tekniker ser bada kundernas noder');
  select count(*) into n from public.infra_services;
  perform pg_temp.assert(n = 2, 'tekniker ser bada kundernas tjanster');
  select count(*) into n from public.service_status_checks;
  perform pg_temp.assert(n = 2, 'tekniker ser driftstatus');
  perform pg_temp.assert(public.can_view_infrastructure(org_a), 'tekniker far lasa infrastruktur utan MFA');

  -- 144-145. Men inte integrationerna: de visar vilka system vi ar inne i och
  --          under vilken identitet. Det kraver connectors.manage.
  select count(*) into n from public.connector_integrations;
  perform pg_temp.assert(n = 0, 'tekniker utan connectors.manage ser inga integrationer');
  select count(*) into n from public.connector_activity_log;
  perform pg_temp.assert(n = 0, 'tekniker utan connectors.manage ser ingen aktivitetslogg');

  -- 146-148. Superadmin utan tvafaktor far lasa registret men inte roja
  --          integrationerna - connectors.manage ar markt requires_mfa.
  perform pg_temp.login(superadmin, 'aal1');
  select count(*) into n from public.infra_services;
  perform pg_temp.assert(n = 2, 'superadmin med aal1 kan lasa registret');
  perform pg_temp.assert(not public.can_manage_connectors(org_a), 'connectors.manage kraver aal2');
  select count(*) into n from public.connector_integrations;
  perform pg_temp.assert(n = 0, 'integrationerna ar stangda utan aal2');

  -- 149-150. Med aal2 oppnas de.
  perform pg_temp.login(superadmin, 'aal2');
  perform pg_temp.assert(public.can_manage_connectors(org_a), 'connectors.manage tillats med aal2');
  select count(*) into n from public.connector_integrations;
  perform pg_temp.assert(n = 2, 'superadmin med aal2 ser integrationerna');

  -- 151. Lasläge gar inte att slå av fran en klient.
  begin
    update public.connector_integrations
       set access_mode = 'read_write'
     where id = 'ffff0000-0000-0000-0000-000000000001';
    perform pg_temp.assert(false, 'access_mode skulle inte ga att andra');
  exception when check_violation or insufficient_privilege then
    perform pg_temp.assert(true, 'access_mode kan inte andras fran read_only');
  end;

  -- 152. Och en ny integration kan inte skapas i skrivlage.
  begin
    insert into public.connector_integrations
      (organization_id, connector_key, display_name, access_mode)
    values (org_a, 'http_health', 'Skrivande', 'read_write');
    perform pg_temp.assert(false, 'skrivande integration skulle nekas');
  exception when check_violation or insufficient_privilege then
    perform pg_temp.assert(true, 'skrivande integration kan inte skapas');
  end;

  -- 153. En hemlighet som klistras in i secret_ref avvisas - det ska vara ett
  --      namn, inte ett varde.
  begin
    insert into public.connector_integrations
      (organization_id, connector_key, display_name, secret_ref)
    values (org_a, 'github', 'Fel nyckel', 'ghp_0123456789abcdefghijklmnop');
    perform pg_temp.assert(false, 'en token i secret_ref skulle nekas');
  exception when check_violation then
    perform pg_temp.assert(true, 'en token i secret_ref avvisas');
  end;

  -- 154. En post kan inte flyttas till en annan kund i efterhand.
  begin
    update public.infra_services set organization_id = org_b where id = svc_a;
    perform pg_temp.assert(false, 'tjansten skulle inte ga att flytta till annan kund');
  exception when insufficient_privilege or foreign_key_violation or unique_violation then
    perform pg_temp.assert(true, 'tjansten kan inte flyttas till en annan organisation');
  end;

  -- 155. En tjanst kan inte hangas under ett projekt i en annan organisation.
  begin
    insert into public.infra_services (organization_id, project_id, name)
    values (org_a, 'bbbb0000-0000-0000-0000-000000000002', 'stulen-tjanst');
    perform pg_temp.assert(false, 'tjanst under annans projekt skulle nekas');
  exception when foreign_key_violation then
    perform pg_temp.assert(true, 'tjanst kan inte hangas under en annan kunds projekt');
  end;

  -- 156-157. Matpunkter och aktivitetslogg ar ofranderliga.
  begin
    update public.service_status_checks set status_key = 'ok' where organization_id = org_b;
    perform pg_temp.assert(false, 'matpunkt skulle inte ga att skriva om');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'matpunkter kan inte skrivas om');
  end;
  begin
    delete from public.connector_activity_log where organization_id = org_b;
    perform pg_temp.assert(false, 'aktivitetsrad skulle inte ga att radera');
  exception when insufficient_privilege then
    perform pg_temp.assert(true, 'aktivitetsloggen kan inte raderas');
  end;

  -- 158-161. Scoped tekniker ser bara sin egen kunds del av registret.
  --          (Tilldelningen ligger pa org_a.)
  perform pg_temp.login(scoped, 'aal1');
  perform pg_temp.assert(public.can_view_infrastructure(org_a), 'scoped tekniker far lasa sin kunds register');
  perform pg_temp.assert(not public.can_view_infrastructure(org_b), 'scoped tekniker far inte lasa annan kunds register');
  select count(*) into n from public.infra_services;
  perform pg_temp.assert(n = 1, 'scoped tekniker ser bara sin kunds tjanst');
  select count(*) into n from public.infra_services where id = svc_b;
  perform pg_temp.assert(n = 0, 'gissat id hos annan kund ger ingenting');
  select count(*) into n from public.incidents;
  perform pg_temp.assert(n = 0, 'scoped tekniker ser inte annan kunds incidenter');

  -- 162. Kund A har en organisationsbunden supporttilldelning sedan tidigare
  --      test. Den ger insyn i den egna organisationen - och ingen annans.
  perform pg_temp.login(kund, 'aal2');
  select count(*) into n from public.infra_services where organization_id = org_b;
  perform pg_temp.assert(n = 0, 'tilldelning i en organisation ger ingen insyn i en annan');

  -- 163. Internt och externt gar att skilja at, och skillnaden ligger pa
  --      organisationen sa att den inte kan glida isar per projekt.
  perform pg_temp.login(tekniker, 'aal1');
  select count(*) into n from public.support_projects p
    join public.organizations o on o.id = p.organization_id
   where o.is_internal;
  perform pg_temp.assert(n = 1, 'interna projekt gar att skilja fran kundprojekt');
  select count(*) into n from public.organizations where is_internal and id = org_intern;
  perform pg_temp.assert(n = 1, 'den interna organisationen ar markt som intern');

  perform pg_temp.logout();

  raise notice 'PASS 2D-TESTER GICK IGENOM';
end;
$BLOCK2D$;

rollback;
