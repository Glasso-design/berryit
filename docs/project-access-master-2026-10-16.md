# Projekt och dynamiska roller — lokal arbetsrapport 2026-10-16

Bas: feat/support-desk, 0357a64e7d0284a30259cbf7b78b6c7a1e155b91.
Tidigare opublicerade PASS 1- och Desktop-ändringar bevaras.

## Gap-matris före implementation

| Område | Befintligt | Lucka / planerad ändring |
|---|---|---|
| Projekt | support_projects, organisation, beskrivning, repository, RLS | Skyddad administration, status/miljö/arkiv, kontakt, kopplingar, historik |
| Systemträd | infra_nodes, infra_services, connector_integrations, monitoring/incidents | Projektstyrd läsning, explicit hantering av relationer |
| Upptäckt | Läsande GitHub/Vercel-adaptrar | Stabil extern identitet, dubblettskydd, bevara manuella fält |
| Roller | Centrala kataloger, grants, rank, organisation, expiry/revocation | Egna roller, projektbegränsning, ändringspreview, serverkontrollerad delegering |
| Identitet | Auth, profiles.is_active, session/MFA | Ta bort profilroll som löpande källa till systemägarrättighet |
| Support | Ärenden, meddelanden, interna anteckningar, bilagor, audit | Bevara flödet; projektroller får inte bli generell supportpersonal |
| Klient | Läsande Projekt/Integrationer/Infrastruktur, lokalt beräknad presentation | Skyddade RPC och serverberäknade presentationsförmågor |
| GitHub | Serveradapter läser senaste commit | Behörighetskontrollerad granskning av registrerat repository; ingen klienttoken |
| Test | PGlite/RLS, MFA, services, Desktop, workflow, builds | Negativa roll-/projekt-/importtester; riktiga Supabase HTTP/MFA BLOCKED |

## Säkerhetsprinciper

Ingen historisk migration ändras. Projekt är kvar i support_projects och roller
i befintliga support-tabeller. Projektscope representeras som en ytterligare
begränsning project_id på en organisationsgrant, med sammansatt tenant-FK.
En sådan grant får aldrig räknas som organisationsomfattande av äldre hjälpare.
Rollkatalogens permissions är serverdefinierade; formulär kan inte skapa dem.
Kundidentitet förblir separat från personalens dynamiska tilldelningar.

Ingen migration/deployment, serverändring, installation, commit eller push är
godkänd. PGlite verifierar PostgreSQL/RLS men ersätter inte GoTrue/JWT/Storage-
HTTP eller native Windows-MFA. Dessa kräver en separat godkänd isolerad stack.

## Implementerat lokalt

### Gemensamma projekt

- `support_projects` används för manuella projekt, BerryIT-skapade projekt och
  upptäckta GitHub-/Vercel-projekt. Ingen parallell projekttabell införs.
- Namn, beskrivning, organisation, kontakt, status, miljö, repository/webb-URL,
  källa, revisionsnummer och arkivering/återaktivering finns i skyddad RPC.
  Ett projekt utan tjänster, servrar eller integrationer fungerar.
- Internt/kund läses från `organizations.is_internal`. Ett `is_internal`-fält i
  projektbegäran avvisas. Organisation/skapare är oföränderliga; revision krävs
  vid redigering. Projektarkivering ändrar en tidsstämpel, inga resurser raderas.
- Befintliga `infra_services`, `infra_nodes` och `connector_integrations`
  återanvänds. Tjänster kan registreras på en befintlig server inom samma tenant.
  Kopplingar kräver både projekt- och connectorpermission på berörda resurser,
  även tidigare projekt vid omkoppling. Ingen tjänst startas eller driftsätts.
- `tickets.project_id` är valfri och har sammansatt tenant-FK. Projektuppdrag
  kan läsa/arbeta med sina ärenden utan organisationsomfattande ticketåtkomst.
  Skapa-formuläret i befintlig Desktop/portal har valfri projektkoppling.
  Administratör kan koppla befintligt ärende till projekt; flytt kräver separat
  `tickets.reassign` och behörighet i båda projektscopen.
- Gränssnittet visar aktuella tilldelningar, registrerad status, tjänster,
  projektets behöriga ärenden, källidentiteter och revisionshändelser.
  Registrerad projektstatus framställs inte som en verifierad driftmätning.
  Befintlig tjänstestatus bevaras med mätkälla, tidpunkt och freshness. Den
  projektbegränsade status-RPC:n lämnar inte ut andra projekts eller rå noddetalj.

### Upptäckt och GitHub-granskning

- Connector Engine har uttryckligt opt-in `config.discovery_enabled=true`.
  Den läser provider-metadata med GET och kontrollerar ett pinnat stabilt
  `provider_project_id` före registrering. Inget aktiverades i detta pass.
- `project_external_identities` håller provider-ID → befintligt projekt, med
  unikt `(provider, external_id)` och tenant-FK. RPC är endast för service_role.
  Upprepad upptäckt ger samma projekt. Matchning görs aldrig bara på namn/URL.
- En redan registrerad identitet ändrar inga projektfält. En ny identitet kan
  kopplas till projektet som en behörig administratör valt på integrationen.
  Namnkollisioner utan säker identitet stoppas för manuell hantering.
- Administratören kan ta bort felaktig registeridentitet och koppla om en
  godkänd integration. Inget repository eller annan extern resurs raderas.
- `/api/control/repository` verifierar användaren genom befintlig serverauth
  och kontrollerar `repository_read_context` med dennes JWT. Databasen kräver
  aktuell `repositories.read` på projektet och aktiverad, pinnad GitHub-koppling.
- Servern kräver dessutom en separat repository-allowlist i
  `BERRYIT_GITHUB_READ_CONNECTIONS`, med lästoken och exakt provider-ID per repo.
  Variabeln är server-only; ingen faktisk token skrevs till kod eller klient.
- Läsaren tillåter branches, commits, pull requests och filer/kataloger. Endast
  GET till `https://api.github.com`, inga följda redirects, fria URL:er eller
  skrivkommandon. Metadata-ID kontrolleras före innehåll. Storleksgräns är 2 MB
  per providersvar. Textfiler avkodas; binära/stora filer visas som begränsning.
  Listor är sidindelade; stora Contents-kataloger markeras som möjliga att ha
  fler poster i stället för att hävdas kompletta.
- Den äldre GitHub-/Vercel-adaptern får inte längre skicka sin token till ett
  klientvalt `api_base`. Andra providerorigins kräver separat servergranskning.
- Kodförslag sparas som privata `repository_review_notes` i BerryIT efter
  `repositories.review` + `repositories.read` på projektet. De skickas inte till
  GitHub och körs inte. Revisionsloggen lagrar note-ID, aldrig rå kodtext.
  `repositories.write` är separat/reserverad; ingen skrivadapter eller produktions-
  deployment har aktiverats, även om permissionen uttryckligen tilldelas.

API-kontrakt kontrollerades mot primärkällor:
[GitHub repository](https://docs.github.com/en/rest/repos/repos#get-a-repository),
[GitHub Contents](https://docs.github.com/en/rest/repos/contents#get-repository-content),
[Vercel project metadata](https://vercel.com/docs/rest-api/projects/find-a-project-by-id-or-name).
Riktiga provideranrop med kundernas tokens kördes inte; lokala tester använder
syntetiska svar. Ingen repositoryanslutning är aktiverad genom denna rapport.

### Dynamiska roller och användare

- Befintliga fyra support-tabeller är enda roll-/permissionmodellen. ADMIN,
  IT SUPPORT och DEVELOPER är skyddade standardmallar, inte en sluten rollista.
- Administratören kan skapa, redigera, kopiera och inaktivera egna roller,
  välja befintliga serverpermissions, tilldela flera roller och återkalla grants.
  Servern skapar rollnyckel och låg mallrang; formulär kan inte välja rank,
  systemflagga eller nya permissions.
- Egna rollmallar kan vara globala eller organisationsbundna. Tilldelningar
  begränsas globalt, till organisation eller till projekt inom organisation.
  En projektgrant får inte bli organisationsgrant genom en äldre helper.
- Före redigering/inaktivering visas berörda aktiva tilldelningar. Revision,
  fingerprint och separat assignment-version kontrolleras under rollradslås.
  Nytillkommen mottagare efter preview ger avslag och ny preview krävs.
- Delegering kräver faktisk `roles.grant`, aktuell aal2, levande session,
  aktivt konto/roll, rätt scope, lägre rang och att VARJE målpermission finns
  hos anroparen i exakt mål-scope. `roles.manage` krävs för rollmallar.
  Rang från ett annat organisationsscope kan inte höja delegeringsnivån här.
- Systemroller kan kopieras som vanliga begränsade mallar men inte ändras eller
  inaktiveras genom formulär/RPC. Ingen normal grant-RPC kan ge Super Admin.
  Standard-ADMIN med rang 80 kan inte delegera standard-ADMIN/ägare på samma
  eller högre rang; behöriga lägre egna mallar kontrolleras permission för permission.
- Externa tilldelningar kräver organisation, sluttid, konsultföretag och
  uppdragsgivare. Även egna externa roller stöds, men de får inte innehålla
  personal-/rolladministration. Samma spärr gäller vid senare mallredigering.
- Behörig administratör kan inaktivera/återaktivera befintligt konto inom scope.
  Självinaktivering och inaktivering av skyddad systemägare nekas. Databasens
  `is_active` slår igenom för gamla sessioner genom restriktiv RLS på alla
  aktuella applikationstabeller. Detta är inte samma sak som att spärra ett
  Auth-lösenord/refresh-token hos GoTrue.
- Registrering av nya personer återanvänder tidigare säkert kundregistrerings-
  flöde med spärrad inloggning. Separat aktivering kvarstår enligt tidigare
  användarbeslut. En väntande profil kan inte få aktiv personalgrant.

## Slutlig standardmatris

Alla rättigheter nedan gäller bara aktuellt beviljat scope. Kundidentiteten
bevaras separat; en kund blir inte personal genom profilmetadata.

| Förmåga | ADMIN | IT SUPPORT | DEVELOPER | Egen roll |
|---|---|---|---|---|
| Projekt läsa/administrera | Ja / ja, skrivning MFA | Läsa inom uppdrag | Läsa inom uppdrag | Exakta beviljade permissions |
| Ärenden läsa/arbeta | Ja | Ja inom organisation/projektuppdrag | Nej, utöver egen kundidentitet | Separata tickets.read/write |
| Tilldela ärenden | tickets.reassign | Inte i standardrollen | Nej | Separat tickets.reassign |
| Kund-/kontoadministration | Inom tillåtet scope, MFA | Nej | Nej | Bara uttrycklig serverkontrollerad rättighet |
| Rollmallar/grants | roles.manage/roles.grant, MFA och delegeringstak | Nej | Nej | Separat rättighet + samma skydd |
| GitHub-läsning | repositories.read + godkänd koppling | Nej | Tilldelade projekt + godkänd koppling | Separat repositories.read |
| Kodförslag i BerryIT | repositories.review | Nej | Ja inom tilldelade projekt | Separat repositories.review |
| Repositoryskrivning | Ingen aktiv skrivväg | Nej | Nej | Reserverad permission öppnar ingen skrivväg |
| Infra/connectorregister | infrastructure.read/connectors.manage, hantering MFA | Kräver ytterligare explicit permission | Nej | Separat inom scope |
| ONARLY DESK | Befintliga ticket-/entitlement-/samtyckesspärrar | Kräver separat tillåten organisationsåtkomst | Ingen automatisk rätt | Befintliga spärrar kvar |
| Fria kommandon/produktionsdeploy | Ingen ny sådan funktion | Nej | Nej | Inte tillgängligt genom rollformulär |

Skyddad `BERRYIT_SUPPORT_SUPER_ADMIN` behålls som intern systemägare/återställning.
Ägarens MFA och övriga produktionsgodkännanden kringgås inte.

## Backend/RLS och bakåtkompatibilitet

- `has_resource_permission(permission, org, project)` är databasens aktuella
  uppslag. Den kombinerar aktiva grants utan att flytta permissions mellan scopes.
  Okända roller/permissions ger ingenting. Inaktiverad roll, utgång eller
  återkallelse märks vid nästa kontroll, utan klientomstart/tokenförnyelse.
- MFA för nya administrativa kontroller kräver signerad current_aal='aal2',
  levande session för SAMMA auth.uid och aktiv mänsklig identitet. Ett
  maskinkonto får inte administrera roller genom det äldre MFA-undantaget.
- `profile.role=admin` ger inte längre löpande administrativa rättigheter.
  Klient-PATCH kan inte ändra profilroll, organisation, org-admin, maskinflagga
  eller aktiveringsmarkering. Betrodd underhålls-SQL behåller bootstrapvägen.
- **Viktig uppgraderingsgrind:** migrationen omvandlar endast redan existerande
  aktiva legacy-admin/technician-profiler till explicita grants en gång.
  Legacy-admin blir ADMIN, inte Super Admin. Befintlig global legacy-tekniker-
  åtkomst bevaras som en synlig, auditerad global grant för kompatibilitet.
  Dessa befintliga breda grants måste inventeras och vid behov ersättas med
  godkända kund-/projektscope före produktionsbeslut. Det sker inte automatiskt
  eller mot verkliga konton här. Nya profilrolländringar skapar inga grants.
  Äldre teknikers tidigare infrastrukturläsning får en separat, uttrycklig
  `BERRYIT_LEGACY_INFRA_READ`-grant, så att nya IT SUPPORT-uppdrag inte automatiskt
  får infrastrukturåtkomst. Detta är en skyddad kompatibilitetsmall i samma
  rollregister, inte en fjärde huvudsaklig personalroll. Den ska också scopas
  eller återkallas efter granskning före drift.
- Äldre `is_staff`-skrivpolicyer kan inte göra en egen roll med enbart
  tickets.read till skribent. Ärendearbete kräver tickets.write, tilldelning
  separat tickets.reassign. Infrastruktur kräver sin egen permission.
- Alla nya privilegierade funktioner har tom, låst search_path, kvalificerade
  tabeller och uttryckliga EXECUTE-grants. PUBLIC/anon saknar EXECUTE på de nya
  privilegierade RPC:erna;
  privata hjälpare/triggerfunktioner är inte klientendpoints. CREATE på public
  återkallas för PUBLIC/anon/authenticated. Alla nya tabeller har RLS.
- `perform_access_request` låter databasen rulla tillbaka nekad skrivning och
  därefter logga `access.denied` i en yttre transaktion. Klienten får ett avslag.
  Direkt SQL/RPC som kastar fel skyddas likadant men kan inte bevara en audit-rad
  i samma återställda transaktion; dessa försök behöver driftens DB/API-loggar.
- Projekt-/roll-/grant-/konto-/kopplingsändringar loggas server-side i befintlig
  append-only audit med aktör, resurs, tid och orsak. Ingen klient får ändra loggen.
- Frontend visar serverns `support_access_context`, aldrig egna rollbeslut från
  profilflaggor eller localStorage. Knappar är presentation. Manipulerade klienter
  prövas ändå av RPC och RLS. Saknad ny backendfunktion ger tydligt schemafel,
  ingen återgång till lokal ADMIN-beräkning.

Säkerhetsmönstren har även kontrollerats mot
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
och [database functions](https://supabase.com/docs/guides/database/functions).
Supabase CLI/advisors mot riktig stack kördes inte; ingen stack installerades.

## Migration och uppgraderingsväg

Ny fil: `supabase/migrations/20261016090000_project_access.sql`.
De 14 historiska migrationerna är orörda. Nya relationstabeller är endast
`project_external_identities` och `repository_review_notes`.
Enumen support_scope ändras inte; projekt är en ytterligare begränsning på
befintlig organisationstilldelning. Befintliga rader behålls, tickets får NULL
project_id och projekt får bakåtkompatibla standardvärden.

`supabase/upgrade-plan.mjs` behåller den tidigare åttamigrationskedjan separat
och lägger till den lokala förlängningen uttryckligen. Det finns alltså nio
planerade steg efter tidigare verifierade sex i drift; inget steg applicerades
på server. `docs/master-integration-pass1-migrations.json` bevarar tidigare 14
hashar; `docs/project-access-migrations.json` kontrollerar alla 15 aktuella filer.

## Faktiskt genomförd verifiering

| Kontroll | Resultat |
|---|---|
| Ny projekt-/rollsäkerhet, full 15-migrationskedja i ny PGlite | **40/40 PASS** |
| Full tidigare RLS/MFA/AI/Communications/Monitoring/DESK-regression på aktuell kedja | **272 kontroller PASS** |
| Historisk MFA-uppgradering/rollback på egen fixture | **22 kontroller PASS** |
| Historisk 6→14-uppgradering med bevarad fixture och pilot | **29/29 PASS**; den nya migrationen testas separat ovan |
| Security Repair, direkt SQL/RLS och Storage-katalog | **22/22 PASS** |
| Testmiljöskydd | **5/5 PASS** |
| Connector/Monitoring/Pilot/Discovery/Repository + AI/Communications + manifest/HTTP-preflight-enheter | **133/133 PASS** |
| Desktop-enheter inklusive Communications/anslutningsskydd | **138/138 PASS** |
| Projekt/roller: transport + browser, 1 201 projekt, verklig isolerad RLS | **2/2 PASS** |
| Befintlig Support Desk-/kundportalhelresa | **3/3 PASS** |
| Byggd Desktop: anslutning, offline/retry och inställningar med syntetisk backend | **3/3 PASS** |
| Rust/Credential Manager, offline, egna syntetiska poster | **8/8 PASS** |
| Lint och båda TypeScript-kontrollerna | PASS |
| Webpack-produktionsbygge | PASS i vanlig Windows-kontext |
| Desktop Vite + Tauri native release utan bundle | PASS, offline; ingen installation |
| Riktiga isolerade Supabase HTTP/JWT/Auth/Storage och native login/MFA | **BLOCKED**; preflight exit 2, ingen separat miljö |

Nya negativa tester täcker faktiska IT SUPPORT-/DEVELOPER-grants, egna roller,
permissionändring i gammal session, inaktivering, expiry/revocation, MFA, annan
användares session-ID, rank/scope/delegering, manipulerade profil/JWT-liknande
klientfält, direkta RPC/SQL-anrop, tenant-FK, felaktig kontakt/server/project-ID,
externa konsulter, stale impact-preview, read-only utan implicit skrivning,
projektbegränsade ärenden, arkivering utan dataradering, dubblettupptäckt,
manuella fält, serverallowlist, tokenmaskering, GET-only och redirect-/pathspärrar.
Browsern använder syntetisk transport + PostgreSQL/RLS, inte riktig GoTrue.

En gammal regression förlitade sig på profilrollen technician och implicit
tilldelningsrätt. Fixtures använder nu uttryckliga grants; ett nytt negativt
test verifierar att tickets.write inte ersätter tickets.reassign. Inga
säkerhetsgrindar stängdes av. Första lokala Webpackförsöket misslyckades med
sandbox-EPERM vid mkdir i .next; samma kommando passerade normalt. Befintlig
Chromium användes efter att sandboxprofilen saknade dess cache; inget installerades.

Kvarvarande byggvarningar: befintlig Zod PURE-kommentar och stor Desktop-chunk.
Ingen oplanerad beroendeuppgradering gjordes. Visuell kontroll gjordes av
projektformulär och rollpåverkan med syntetiska data och befintliga designtokens.

## Artefakter och återstående driftsgrind

Native lokal fil:
`desktop/src-tauri/target/release/berryit-control-center.exe`.
Installeraren från tidigare pass ersattes inte; native-filen är inte installerad,
signerad eller en verifierad release till användare. Versionen är fortsatt 0.1.1.

Före produktion krävs:

1. Separat godkänd isolerad Linuxstack med egna portar/databas/volymer och
   syntetiska Auth-identiteter. Ingen ändring på befintliga servrar är gjord.
2. Verkliga HTTP-tester av PostgREST, JWT-signatur/claims, login/refresh/logout,
   MFA, Storage, RPC-ACL samt riktiga fleranslutnings-/låstester för IAM-ändringar.
   PGlite verifierar SQL-logiken; den bevisar inte samtidighet i produktionsstacken.
   Körplanen finns i `docs/project-access-http-gate.md`.
3. Granskning av legacy-profiler/grants, skyddad ägaridentitet och återställning.
   Godkänn exakt eventuell scopesanering; ingen befintlig data rensas automatiskt.
4. Testa nya klienten mot samma isolerade schema. Nuvarande produktionsbackend
   saknar enligt tidigare läsning åtta steg plus denna nya lokala migration.
   Nya klienten ska därför inte distribueras före godkänd uppgraderingsgrind.
5. Separat godkänd serverkonfiguration för connectorrunner, secret store,
   per-repo read-token/allowlist och provideridentiteter; riktiga läsanrop och
   revocation behöver verifieras med dessa identiteter. Inget är anslutet här.
   Projektbegränsade tekniker kan använda ärendets kundmeddelanden/anteckningar/
   bilagor. Communications organisationskanaler och DESK:s organisationsrättighet
   kräver fortfarande separat rätt organisationsscope; projektgrants öppnar inte
   automatiskt dessa bredare kanaler.
6. Tidigare dokumenterade backup-/restore-grind: återställ verifierat DB+Storage+
   konfiguration till separat miljö, kontrollera kunddata/RLS/Auth/MFA och besluta
   rollbackpunkt/RPO/RTO. Ingen destruktiv down-migration eller automatisk start.
7. Separat kodgranskning, commit/push/CI-godkännande och därefter separat beslut
   om produktionsmigration/deployment. GitHub Actions kördes inte i detta pass.

**Disposition:** lokalt verifierat enligt ovan. Verklig Supabase-/Windows-MFA-
driftsverifiering är BLOCKED. Ingen produktionsberedskap eller deployment hävdas.

## Filer i detta tillägg

Nya: `shared/project-access.ts`, `shared/ui/ProjectAccessWorkspace.tsx`,
`src/app/api/control/access/route.ts`, `src/app/api/control/repository/route.ts`,
`src/components/control/ProjectAccessClient.tsx`,
`services/connector-engine/project-discovery.mjs` och `.test.mjs`,
`services/connector-engine/repository-access.mjs` och `.test.mjs`,
`supabase/migrations/20261016090000_project_access.sql`,
`supabase/tests/project-access.test.mjs`, `tests/access/*`, denna rapport och
`docs/project-access-migrations.json` samt `docs/project-access-http-gate.md`.

Befintliga filer utökade: `shared/domain.ts`, `shared/nav.ts`,
`shared/support-actions.ts`, `shared/support-workflow.ts`,
`shared/ui/SupportWorkspace.tsx`, Desktop Projekt/auth/session/Login/Shell/
registry, `desktop/tests/shared.test.ts`, webbens auth/layout/projekt,
`tests/support/database.ts`, `supabase/tests/run-local.mjs` och RLS-testfixture,
Connector Engine/adapters, paketets scripts och Verify-workflow.
Tidigare lokala filer för upgrade-plan/manifesttester och dokumentation utökades.
Andra tidigare Desktop-/PASS 1-ändringar behölls; de ingår inte som ny funktion här.

## Slutlig arbetsyta

- Branch: `feat/support-desk`.
- HEAD: `0357a64e7d0284a30259cbf7b78b6c7a1e155b91`, oförändrad.
- 44 modifierade och 37 nya filer, inklusive tidigare opublicerat arbete.
  Inga staged-filer eller borttagningar. Full sökvägslista nedan.
- Inga ändringar i de 14 historiska migrationsfilerna; manifestkontrollen passerar.
- `git diff --check`: PASS. Ingen annan aktiv BerryIT-chatt identifierades vid
  slutkontrollen; parallell QABGO-chatt arbetar i ett annat repository.
- Lokal kontroll av den privata miljönyckelns exakta värde mot alla 81 ändrade/
  nya filer och 85 publika byggartefakter gav inga träffar. Detta ersätter inte
  separat granskning av framtida serverkonfiguration eller externa tokens.
- Native EXE SHA-256:
  `b4881dfc42d2c18b1ac48f04307200e0dc015fc5f40976d13decdafce6cef0e0`.
- Ingen commit, push, installation, serveranslutning, migration eller deployment
  utfördes i detta tillägg. GitHub CI är inte körd för opublicerad kod.

```text
 M .github/workflows/verify.yml
 M deploy/berryit-support/README.md
 M deploy/berryit-support/backup.sh
 M deploy/berryit-support/migrate.sh
 M deploy/berryit-support/restore-test.sh
 M desktop/.gitignore
 M desktop/README.md
 M desktop/package-lock.json
 M desktop/package.json
 M desktop/src-tauri/Cargo.lock
 M desktop/src-tauri/Cargo.toml
 M desktop/src-tauri/tauri.conf.json
 M desktop/src/App.tsx
 M desktop/src/auth/access.ts
 M desktop/src/auth/client.ts
 M desktop/src/auth/session.tsx
 M desktop/src/components/Shell.tsx
 M desktop/src/config.ts
 M desktop/src/registry/data.ts
 M desktop/src/views/Login.tsx
 M desktop/src/views/Projekt.tsx
 M desktop/src/views/Setup.tsx
 M desktop/tests/shared.test.ts
 M desktop/vite.config.ts
 M docs/connector-engine.md
 M package.json
 M services/connector-engine/adapters.mjs
 M services/connector-engine/agent-contract.mjs
 M services/connector-engine/contract.mjs
 M services/connector-engine/engine.mjs
 M shared/api.ts
 M shared/domain.ts
 M shared/nav.ts
 M shared/schemas.ts
 M shared/support-actions.ts
 M shared/support-workflow.ts
 M shared/ui/SupportWorkspace.tsx
 M src/app/control/(shell)/layout.tsx
 M src/app/control/(shell)/projekt/page.tsx
 M src/lib/auth.ts
 M supabase/tests/run-local.mjs
 M supabase/tests/support_desk_rls_test.sql
 M supabase/tests/upgrade-2c.mjs
 M tests/support/database.ts
?? deploy/berryit-support/upgrade-safety.test.sh
?? desktop/scripts/connect-backend.ps1
?? desktop/tests/build-config.test.ts
?? desktop/tests/connection.test.ts
?? docs/desktop-connection-repair-2026-10-16.md
?? docs/master-integration-pass1-2026-10-16.md
?? docs/master-integration-pass1-migrations.json
?? docs/project-access-http-gate.md
?? docs/project-access-master-2026-10-16.md
?? docs/project-access-migrations.json
?? services/connector-engine/pilot.mjs
?? services/connector-engine/pilot.test.mjs
?? services/connector-engine/project-discovery.mjs
?? services/connector-engine/project-discovery.test.mjs
?? services/connector-engine/repository-access.mjs
?? services/connector-engine/repository-access.test.mjs
?? shared/project-access.ts
?? shared/ui/ProjectAccessWorkspace.tsx
?? src/app/api/control/access/route.ts
?? src/app/api/control/repository/route.ts
?? src/components/control/ProjectAccessClient.tsx
?? supabase/migrations/20261016090000_project_access.sql
?? supabase/tests/fixtures/deployed-baseline.sql
?? supabase/tests/http-preflight.mjs
?? supabase/tests/http-preflight.test.mjs
?? supabase/tests/master-upgrade.test.mjs
?? supabase/tests/project-access.test.mjs
?? supabase/tests/upgrade-plan.test.mjs
?? supabase/upgrade-plan.mjs
?? tests/access/index.html
?? tests/access/main.tsx
?? tests/access/package.json
?? tests/access/playwright.config.ts
?? tests/access/run.mjs
?? tests/access/workflow.spec.ts
?? tests/desktop/connection.spec.ts
?? tests/desktop/playwright.config.ts
```
