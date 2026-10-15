# BERRYiT Support Desk – databas (PASS 1 + 1A)

Datamodell, behörigheter och säkerhetstester för BERRYiT Helpdesk Support.
**Ingen UI och ingen körtidsintegration ingår.** Inget är applicerat mot något
Supabase-projekt – migrationerna är verifierade lokalt mot PostgreSQL.

## Innehåll

| Fil | Syfte |
|---|---|
| `migrations/20261013090000_support_desk_core.sql` | Organisationer, profiler, uppslagstabeller, ärenden, meddelanden, interna anteckningar, bilagor, historik, index, triggers |
| `migrations/20261013090100_support_desk_rls.sql` | Hjälpfunktioner, behörigheter (grants) och RLS-policies |
| `migrations/20261013090200_support_desk_storage.sql` | Privat bucket `ticket-attachments` + storage-policies |
| `migrations/20261013090300_support_authority.sql` | Central supportauktoritet: scopes, roller, grant/revoke, revision, ONARLY-register |
| `migrations/20261013091000_support_authority_hardening.sql` | PASS 1A: skydd mot rättighetshöjning, oföränderliga tilldelningar, scope-medvetet arbete i ärenden |
| `tests/support_desk_rls_test.sql` | 73 säkerhetskontroller (transaktion som rullas tillbaka) |
| `tests/run-local.mjs` | Kör migrationer från tom databas + testsviten mot PGlite |
| `tests/local_bootstrap.sql` | **Endast lokal körning**: roller, `auth.users`, `auth.uid()` |

Migrationerna är ordningsberoende och körs i filnamnsordning (tidsstämpel).
Ordningen verifieras av `npm run db:test`, som alltid startar från en tom databas.

## Köra testerna

Lokalt, utan Docker/Supabase:

```bash
npm run db:test
```

Mot ett riktigt Supabase-projekt (efter `supabase db push`):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/support_desk_rls_test.sql
```

`local_bootstrap.sql` ska **inte** köras mot Supabase – där finns `auth`, rollerna
och `auth.uid()` redan.

## Säkerhetsmodell

- **Kund** ser endast sina egna ärenden, meddelanden och kundsynliga bilagor.
  Organisationens kontaktperson (`profiles.is_org_admin`) ser hela organisationens ärenden.
- **Interna anteckningar** ligger i egen tabell. Kundrollen har ingen policy alls mot den.
- **Personal** = global behörighet via `profiles.role` eller global grant.
- **Delegerad support** = grant med `scope = 'organization'`: läsa, svara, anteckna,
  bifoga och ändra ärenden i exakt den organisationen – ingenting utanför.
- **Rättighetshöjning blockeras**: ingen kan dela ut sin egen eller högre rang, och
  globala roller delas bara ut av en global superadministratör.
- **Tilldelningar är oföränderliga**: en uppdatering får bara återkalla. Roll, scope,
  organisation och giltighetstid kan inte skrivas om, och en återkallelse kan inte ångras.
- **Återkallelse gäller omedelbart** – varje kontroll läser aktiva grants vid
  frågetillfället, så en redan utfärdad JWT ger ingen kvarvarande åtkomst.
- **Revision**: `support_admin_audit` skrivs av databasen (aktör, mål, scope, skäl, tid)
  och är append-only; `authenticated` saknar insert/update/delete.
- **Bilagor** ligger i privat bucket och nås via signed URLs.

## Roller

| Roll | Rang | Scopes |
|---|---|---|
| `BERRYIT_SUPPORT_SUPER_ADMIN` | 100 | samtliga, inkl. `roles.grant`, `onarly.entitlements.manage`, `escalation.configure`, `audit.read` |
| `BERRYIT_SUPPORT_ADMIN` | 80 | ärenden, organisationer, tekniker, revision |
| `BERRYIT_SUPPORT_TECHNICIAN` | 50 | läsa och arbeta med ärenden i sitt scope |

Första superadministratören sätts av ägaren via `service_role`/SQL-konsolen, eftersom
`roles.grant` krävs för alla andra tilldelningar:

```sql
insert into public.support_role_grants (grantee_id, role_key, scope, reason)
values ('<auth.users.id>', 'BERRYIT_SUPPORT_SUPER_ADMIN', 'global', 'Ägarbeslut: supportauktoritet');
```

## Supabase: så ska projektet konfigureras

Ingenting av detta är utfört – det kräver ägarens Supabase-projekt.

1. **Projekt**: eget projekt för Support Desk (inte AuroraPark-projektet), region EU.
2. **Miljövariabler**: se `.env.example`. `SUPABASE_SERVICE_ROLE_KEY` används endast
   server-side och läggs i Vercel som en icke-publik variabel.
3. **Migrationer**: `supabase init` (om `config.toml` saknas), `supabase link --project-ref <ref>`,
   därefter `supabase db push`.
4. **Auth**:
   - E-postinloggning (magisk länk eller lösenord) för kundportalen.
   - Stäng av publik självregistrering om portalen ska vara inbjudningsbaserad;
     profilen skapas automatiskt av triggern `auth_user_created`.
   - Site URL och redirect-URL:er sätts till portalens domän.
   - Nya användare får rollen `customer`. Personal får sin behörighet via grants.
5. **Storage**:
   - Bucketen `ticket-attachments` skapas av migrationen: privat, max 25 MB,
     vitlistade MIME-typer.
   - Filer serveras via signed URLs från servern – aldrig publika länkar.
   - Sökväg: `tickets/<ticket_id>/<fil>`; policyn kontrollerar att ärendet får ses.
6. **Starkare autentisering** för administration (MFA för superadministratörer) ställs in
   i Supabase Auth. Det är en plattformsinställning, inte en migration.

## PGlite kontra riktig Supabase

`npm run db:test` kör riktig PostgreSQL (PGlite = Postgres i WASM) i en ny
isolerad minnesdatabas. Kommandot kräver explicit testmiljö, vägrar extern
databaskonfiguration och har ingen cleanup-funktion. Negativa skyddstester körs
med `npm run db:safety-test`. De äldre filerna `seed-users.mjs` och `seed.mjs`
finns inte i repositoryt eller dess Git-historik; deras tidigare säkerhet kan
inte verifieras här. PGlite omfattar inte hela Supabase-plattformen.
Skillnader att känna till:

| Område | Lokalt (PGlite) | Supabase |
|---|---|---|
| `auth`-schemat | Stubbe i `local_bootstrap.sql`: `auth.users` + `auth.uid()` | GoTrue med fullständigt schema, `auth.jwt()`, MFA, sessioner |
| Roller | `anon`, `authenticated`, `service_role` skapas av bootstrap | Finns redan, med plattformens rättigheter |
| JWT | Simuleras med `set_config('request.jwt.claims', …)` + `set role` | PostgREST sätter claims från en verifierad JWT |
| API | Inget – policies testas direkt mot SQL | PostgREST/supabase-js ovanpå samma policies |
| `storage`-schemat | Syntetisk katalog i `local_storage_bootstrap.sql` för `db:test` och `db:repair-test`; riktiga RLS-policyer appliceras | Fullständig Storage-katalog och HTTP-tjänst |
| Realtime/Edge Functions | Saknas | Finns (används inte i denna pass) |
| Tillägg | `pgcrypto` laddas explicit | Förinstallerat |

Konsekvens: RLS-logiken, triggers, constraints och index är verifierade. Det som
**inte** verifieras av PGlite är Storage HTTP/signed URL-flödet,
GoTrue-inställningar och PostgREST-exponeringen. SQL/RLS för objekt testas nu
även med manipulerade sökvägar och extra permissiva plattformspolicyer.

## Säkerhetsreparation 2026-10-14

Den framåtriktade migrationen `20261014190857_security_ci_repair.sql` härdar
Communications, `active_support_grants(uuid)` och Storage. Historiska migrationer
ändras inte. `npm run db:repair-test` kör uppgradering från tidigare schema med
syntetiska befintliga deltagare och kontrollerar att inga deltagare raderas.
Communications-bilagor registreras av klienten före objektuppladdning; meddelande,
konversation och sökväg måste matcha. Befintliga felkopplade poster blir
otillgängliga, inte raderade. Betrodda importörer använder fortsatt service_role.
Se [verifiering och kvarstående driftfrågor](../docs/security-ci-repair-2026-10-14.md).

## Lokalt manuellt supportflöde, 2026-10-15

`20261014235633_complete_support_workflow.sql` utökar befintliga profiler och
tickets för manuell kundregistrering, tilldelning, återöppningsorsak och säkra
ärendebilagor. Privatkund har fortsatt `organization_id IS NULL`; ingen separat
kundmodell behövs för det manuella flödet. Privatkunders ONARLY DESK-rättighet
kräver fortfarande ett separat framtida databasbeslut.

`npm run test:support-workflow` kör den gemensamma UI-resan med isolerad PGlite
och syntetisk Auth/Storage-transport. Installera först webbens och Desktops
beroenden samt `npx playwright install chromium`. Inga serveradresser accepteras.
Testet verifierar SQL/RLS och klientbeteende, inte GoTrue eller Storage HTTP.
Se [arbetsrapport och verifieringsgränser](../docs/complete-support-workflow-v1.md).
Nedan kvarstår äldre miljöuppgifter som historiskt underlag; aktuellt driftläge
har inte kontrollerats eller ändrats i detta uppdrag.

## Inte implementerat (medvetet, ingen attrapp)

- Köer och eskaleringsmotor (registret finns, regelverket är inte byggt)
- Notifieringar (ingen e-postleverantör vald)
- ONARLY DESK-integration: `onarly_support_entitlements` är BERRYiT:s beslutsregister.
  Inga API-anrop mot ONARLY finns och ingen integration är aktiverad.
- Discord/bug report-inflöde: `tickets.source`, `external_id`, `external_channel`,
  `external_metadata` är förberedda fält – ingen integration är byggd.

## Blockerare

1. Supabase-projektet är inte skapat; inga migrationer är applicerade någonstans.
2. Nycklar saknas (`.env.example` visar vilka som behövs).
3. `portal.berryit.se` är inte uppsatt (domän/DNS).
4. Storage-policies och signed URLs kan inte verifieras lokalt – kräver projektet.
