# Project Control Center + Tasks + Activity History

## Preflight och gap-matris (före implementation)

2026-10-25, C:\projects\berryit, feat/support-desk,
HEAD dabecfe34e71a1ffc7e98fd1be6968a23fd91df2. 126 tidigare ocommittade
filer skyddas med före-hashar. Ingen annan aktiv BerryIT-arbetsyta observerades.
Rapporter för projektåtkomst, Complete Support Workflow, Security & CI Repair,
Connector Engine och senaste Factory-pass återanvänds. Ingen ny masterarkitektur.

| Del | Återanvänds | Verifierad lucka | Inkrementell åtgärd |
|---|---|---|---|
| Projekt/kunder | support_projects, organizations, profiles, skyddade projekt-RPC:er | Typ, samlad översikt och verifieringskällor saknas | Utöka samma projekt-ID med metadata och gemensam detaljvy |
| Roller | support_roles/permissions/grants, has_resource_permission, MFA/session | Projektspecifika tasks/affärsuppgifter saknas | Nya serverdefinierade permissions med befintligt scope; inga UI-beslut |
| Taskhantering | tickets som enda supportkärna | Projektuppgifter saknas | Tasks som projektarbete, relation till befintliga tickets; ingen ny kundmodell |
| GitHub | Läsande serveradapter och pinnad repoidentitet | Flera repos, issues/releases/CI och tasksynk | Återanvänd adapter; bara GET externt, idempotenta interna kopplingar |
| Infrastruktur | infra_services/nodes, checks, incidents, integrations | Samlad projektscope-projektion | Tillåtna kolumner och aktuella permissions; okänt är inte healthy |
| Historik | support_admin_audit och connectorlogg | Samlad ändringshistorik/source/ansvar saknas | Append-only projektaktivitet; skilj system/manuellt/AI |
| Affär/avtal | Organisation anger operativ tenant | Registrerat affärsägande får inte antas från driftbehörighet | Separat permission och uppgift, ej verifierat som standard |
| Support/Factory | Skyddade befintliga RPC:er och vyer | Projektnavigation/sammanställning | Samma IDs, läsande kopplingar, Factory fortsatt MOCK/BLOCKED och 1 GB-standard |
| ONARLY AI | Befintligt samtycke, hashbunden preview och gateway | Tasks/historik saknas i projektunderlag | Lägg till endast backendbehörigt underlag före samtycke; ingen verklig inferens |
| Produktlista | Befintligt projektregister | Namngivna önskade projekt saknar verifierat innehåll | Neutral registreringslista/explicit organisation; inga uppdiktade adresser eller avtal |

## Gränser

Ingen produktion, commit, push eller deployment. Nya schemaförslag testas lokalt
i isolerad PGlite; inget DDL mot server utan separat godkännande. Ingen ny
Supabase-stack och ingen ändring i andra repositories. Drift/deployment förblir
läsande. Senaste Factory-standard 1 000 000 000 byte och tidigare arbete bevaras.

## Slutresultat

**LOCAL PASS. Nya PCC-flöden via verklig Supabase HTTP och native Windows:
BLOCKED_SCHEMA. STAGING/PRODUCTION: inte driftsatta eller godkända.**

### Implementerat och återanvänt

- Samma `support_projects`, organisations-/kund-ID, rollregister och aktuella
  serverpermissions används. Det finns inget parallellt kund- eller projektregister.
- Desktop och webb har Project Control Center med Overview, Infrastructure,
  Git & Code, Tasks, Activity History, Releases, Support och Platform Factory.
  Befintlig projektadministration, dynamiska roller, tilldelningar och
  resurskopplingar finns kvar i en separat expanderbar del.
- Projekttyp, utvecklingsstatus och lokal logotyp är registrerade uppgifter.
  SaaS, mobil, desktop, spel och webb visar relevanta underlag och uttryckliga
  luckor. TestFlight/Google Play/distribution antas aldrig vara anslutna.
- Affärsägande/avtalsreferens ligger separat från operativ organisation, kod
  och driftåtkomst. Okänt är standard; MG MEDIA härleds aldrig från en tenant.
- Tasks har CRUD med revisionskontroll, soft archive, ansvarig, deadline,
  checklistor, kommentarer, privata bilagor, resurskopplingar och paginerad
  ändringshistorik. All Tasks filtrerar endast backendbehöriga projekt.
- Interna kommentarer och bilagor har eget skydd. En bilagas interna
  klassning behålls även om dess task senare görs projektsynlig. Ingen klient
  får direkta skrivgrants på de nya tabellerna. Historik/kommentarer/underlag
  är append-only; arkivering raderar inga externa resurser.
- Befintlig GitHub-läsare stödjer flera godkända repoanslutningar och GET för
  branches, commits, PRs, filer, issues, releases, Actions-runs och registrerade
  deployments. Metadata/repo-ID och serverns allowlist måste matcha. Inga
  providertokens, download-URL:er eller administrativa anslutningsfält returneras.
- Issues läses färdigt före en enda atomisk import. Fel, upprepade sidor eller
  gränsen 2 000 issues/8 MB avbryter utan partiell import. Identitet dedupliceras
  även över två anslutningar till samma repository. Nya observationer skapar
  granskningsförslag; manuella taskfält skrivs inte över utan explicit godkännande
  och aktuell revision. Kollision med annat projekt/tenant nekas.
- Historik skiljer databasens systemhändelser, manuella uppgifter, connector-
  observationer och AI-sammanfattningar. Manuella release-/produktionspåståenden
  får alltid `system_verified=false`. GitHub deploymentregistrering bevisar
  inte frisk produktion. Tid hos provider skiljs från faktisk lästid för issues.
- Neutral registrering av de tolv begärda projektnamnen använder befintlig
  organisation och skyddad, idempotent RPC. Alla tolv har registrerats och
  återlästs i syntetisk lokal SQL. Verklig organisations-/avtalskoppling behöver
  väljas av administratören; ingen katalog har skrivits till servern.
- Supportlänkar använder befintliga ticket-ID och referenser. Ticketläsning
  kräver fortfarande befintlig ticketbehörighet, även för en tasklänk.
- Factory-länken väljer både faktiskt projekt och versionsregistrerad produkt.
  Saknad adapter/behörighet ger BLOCKED, ingen annan produkt väljs automatiskt.
  Ny standard är fortsatt exakt **1 000 000 000 byte**. Äldre 10 GB-instans och
  reservationer bevaras; kvotbrokern har inte ersatts. SQL kräver explicit kvot,
  så kvotstandardens tidigare ändring behöver ingen kolumndefault-migration.
- Befintlig ONARLY AI-adapter får aktuella, backendbehöriga tasks och registrerad
  historik. Ingen affärs-/avtalsmetadata eller lokal projektsökväg läggs till i
  den automatiska projektkontexten. AI-sammanfattningar används inte som
  verifierade källor. Projektfrågor finns i samma befintliga chatt.
- Samtycke krävs före Gateway-anrop. Sök felet bygger hashbunden preview före
  överföring. Ändrad/återkallad kontext kontrolleras igen innan AI-svaret sparas.
  AI får aldrig utföra kommandon eller göra kod-/driftändringar.

### Backend, databas och rättigheter

Ny framåtriktad migration:
`supabase/migrations/20261025112940_project_control_center.sql`.
Den tillför nio projektspecifika tabeller, sammansatta tenant-/resurs-FK:er,
RLS, privata Storage-regler och skyddade RPC:er. Den kräver den tidigare
projekt-/roll-/sessionsmodellen och Supabases befintliga Storage-schema.
En oväntat offentlig eller felkonfigurerad befintlig taskbucket stoppar hela
migrationen atomiskt; dess data eller inställningar rättas inte automatiskt.

Migrationsmanifestet `docs/project-control-center-migrations.json` omfattar
17 ordnade filer (sex historiska baseline + elva senare kandidater), med
SHA-256 och föregångare. Tidigare reviewmanifest jämförs som oförändrade
prefix. Ingen historisk migrationsfil har ändrats. Supabase CLI saknades;
filen skapades med aktuell tidsstämpel och testades via faktisk SQL i PGlite.
`supabase db reset` och Supabase-advisors har inte körts.

| Permission | ADMIN / skyddad ägare | DEVELOPER, beviljat projekt | IT SUPPORT / kund som standard |
|---|---|---|---|
| tasks.read / tasks.write / tasks.internal | Inom aktuellt scope | Inom aktuellt scope | Ingen ny automatisk taskåtkomst |
| tasks.sync | Ja, aktuell MFA och repo-/taskrätt | Nej som standard | Nej som standard |
| projects.activity.read | Inom scope | Inom scope | Kräver separat uttrycklig tilldelning |
| projects.activity.write | Ja, aktuell MFA | Nej som standard | Nej som standard |
| projects.business.read / manage | Ja, aktuell MFA | Nej som standard | Nej som standard |
| projects.manage / repositories.read / factory.read / tickets.read | Befintliga separata regler | Befintliga separata regler | Befintliga separata regler |

Egna roller använder exakt samma centrala permissionregister, aktuell grant,
organisation och projektscope. Standardroller jämförs endast när deras
serverdefinierade grundpermissions registreras. RPC/RLS auktoriserar varje
åtgärd med aktuell konto-/sessions-/grantstatus. Profilroll, UI-state och
klientskickade användar-/tenantfält är inte behörighetskällor. Privilegierade
funktioner har tom `search_path`, återkallad PUBLIC/anon EXECUTE och minsta
avsedda authenticated/service_role-grants. Issueimport är endast serverkörbar
och kontrollerar den verifierade aktörens verkliga levande aal2-session igen.

### Kontrakt och avgränsningar

- `/api/control/project-control`: befintlig autentiserings-/originhantering,
  strikt actionkontrakt, högst 64 KB. Desktop använder samma skyddade RPC:er.
- `/api/control/project-control/attachment`: begränsad multipart-kropp,
  prepare → Storage upload utan upsert → storleksverifierad complete.
  Återupptagning verifierar lagrat task-/fil-/path-ID, inte klientens påstående.
- `/api/control/project-sync`: endast registrerade projekt-/integrations-ID,
  verifierad anropare och serverkonfigurerad `BERRYIT_GITHUB_READ_CONNECTIONS`.
  Behörighet ska omfatta just önskat repository och läsoperationerna ovan.
- Nedladdning begär en signerad URL med 60 sekunders giltighet efter ny
  behörighetskontroll och audit. Verklig Storage-HTTP, signatur, utgång och
  återkallelsefönster är kvarvarande verifieringsfall, inte SQL-testad S3.
- AI-kontext är uttryckligen begränsad till tio öppna tasks, tio underlag och
  tjugo händelser från senaste sju dagarna. Större underlag redovisas som
  ofullständigt; AI ska inte påstå sig ha granskat hela projektet eller servern.
- Saknad ny AI-kontext-RPC redovisas uttryckligen. Permissionfel konverteras
  aldrig till mockframgång. Befintlig Gateway och supportärendeskapande återanvänds.
- GitHub-läsning sker på begäran; issues har implementerad import/synk. Ingen
  ny automatisk bakgrundsinsamlare för releases, deployments, DNS eller backup
  har aktiverats. Senast systemverifierade version förblir okänd tills sådan
  verifierad observation finns i registret; manuella uppgifter ersätter den inte.
- Projekt använder fortsatt befintlig organisationsmodell. Fristående
  privatkundsärenden fungerar kvar i Support Desk, men en PCC-tasklänk kräver
  samma verkliga projekt och organisation. Ett separat privatpersonsägt
  projekt utan organisation kräver ytterligare granskad modelländring utifrån
  befintliga profiler. Ingen fiktiv företagsorganisation eller parallell kundmodell
  har införts som genväg.

## Faktiska verifieringsresultat

Alla nedanstående slutkörningar gav exit 0; inga fall hoppades över i dessa
slutkörningar. Tidiga fel beskrivs nedan och i samtalets verktygsutskrifter;
de räknas inte som PASS. Loggfilerna avser slutkörningarna.

| Grind / kommando | Resultat | Miljö / bevisgräns |
|---|---|---|
| `npm run db:project-control-test` | 24 PASS | Riktig SQL/RLS i ny in-memory PGlite; inkluderar uppgradering med befintliga syntetiska rader och atomiskt stopp vid offentlig bucket |
| `npm run db:test` | 272 PASS | Befintlig Support/MFA/RLS/Communications/Monitoring/DESK-regression |
| `npm run db:access-test` | 40 PASS | Projekt, dynamiska roller, delegation och återkallelse |
| `npm run db:repair-test` | 22 PASS | Isolation, internchatt och restriktiv Storage-RLS |
| `node supabase/tests/onarly_ai_assistant_test.mjs` | 11 PASS | AI:s befintliga SQL-scope |
| `npm run db:upgrade-test` | 22 PASS | Syntetisk MFA-uppgradering och återställning |
| `npm run db:master-upgrade-test` | 29 PASS | Historisk åttastegsuppgradering med bevarade rader; PCC:s egen fulla uppgraderingskontroll finns ovan |
| `node supabase/tests/active-grants-hotfix.test.mjs --environment=isolated-pglite` | 21 PASS | Hotfix plus alla elva senare migrationskandidater, endast syntetisk DB |
| `npm run db:safety-test` | 5 PASS | Okänd/produktionsklassad/extern miljö och cleanup-argument nekas |
| `node --test supabase/tests/upgrade-plan.test.mjs supabase/tests/http-preflight.test.mjs` | 6 PASS | Manifest-/miljökontrakt, inte riktiga HTTP-/MFA-anrop |
| Connector/Monitoring/Communications/AI:s befintliga och nya Node-sviter | 147 PASS | GET-kontrakt, syntetisk HTTP/Gateway, scope, samtycke, retry och atomisk import |
| `npm run test:factory` | 92 PASS | LOCAL/MOCK; atomisk kvot, 1 GB-default, äldre kvot, isolering och releasegrindar |
| `npm test --prefix desktop` | 150 PASS | Alla tolv testfiler; ingen skippad Communications-svit |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked --offline` | 8 PASS | Befintliga cachade beroenden och separata testnycklar |
| `npm run test:project-control` | 1 PASS | Chromium → gemensam UI/API-dispatcher → riktig isolerad SQL/RLS; task, checklistor, kommentar, bilaga, history, support- och Factory-navigation |
| `npm run test:support-workflow` | 3 PASS | Befintlig kundresa och isolerad uppgradering |
| `npm run test:project-access` | 2 PASS | Befintlig projekt-/rolladministration |
| `npm run test:ai-diagnostics` | 2 PASS | Samtycke, syntetisk HTTP-Gateway och supportärende; ingen verklig inferens |
| `npm run test:factory-ui` | 1 PASS | Factory fortsatt MOCK/BLOCKED och 1 GB |
| `npm run test:desktop-connection` | 10 PASS | Faktisk ny produktionsbundle i Chromium; syntetisk kallstart/login/MFA och sju befintliga moduler |
| `npm run lint` / `npm run typecheck` | PASS | Inga lintfel eller lintvarningar; Next-typer genereras före typecheck |
| `npm run build` | PASS | Dokumenterad Next.js Webpack-produktion |
| `npm run build --prefix desktop` | PASS | TypeScript och Vite; React-dedupe kvar |

Totalt 19 Playwright-fall passerar. De är inte native WebView2-tester eller
bevis på riktig GoTrue/JWT-signatur/Storage-HTTP för den nya PCC-migrationen.
Översiktsbilden har dessutom granskats visuellt. Evidens/loggar finns lokalt i
`test-results/project-control-20261025/`, Chromium-tracekatalogerna och
`test-results/desktop-connection/`; de är ignorerade testartefakter.

Tidiga fel rättades utan svagare spärrar: SQL-variabelkollision vid bilage-
förberedelse, för bred invokerläsning av Factory-adaptertabellen (ersatt med
smal auktoriserad serverprojektion), testfixturernas Storage-beroende och
uppdaterade, exakta migrations-/navigeringsförväntningar. UI-tester använder
korrekta tillgänglighetsselektorer. Byggvarningar: befintlig Zod-annotation och
Desktop-chunk över 500 KB; inga gränser höjdes för att dölja dem.

## Verklig miljö och nästa grind

Enbart läsning via befintlig SSH-identitet mot core-node-01 verifierade alla
sju `berryit-iso-83a2f62f-*`-containrar körande med åtta dagars upptid.
Databas, Auth och AI-adapter hade Docker healthy. En read-only SQL-transaktion
mot just `berryit-iso-83a2f62f-db` gav:

```
project_tasks_present=false
project_control_rpc_present=false
factory_schema_present=true
```

Den tidigare lokala tunneln på 18750 lyssnade inte. Ingen tunnel skapades,
ingen container startades och ingen serverkonfiguration eller data ändrades.
Teststacken saknas alltså inte: den saknar den nya granskade PCC-migrationen.
Tidigare native-/HTTP-verifieringar gäller sina dåvarande versioner och
åberopas inte som PASS för nya tasks/PCC-bilagor.

| Del | LOCAL/MOCK | STAGING/PRODUCTION |
|---|---|---|
| Projekt, tasks, historik, dynamiska permissions | LOCAL PASS med faktisk SQL/RLS | Ny migration ej applicerad |
| GitHub-läsning/issuesynk | MOCK-kontrakt PASS | Verklig token-/repoanslutning och API-verifiering återstår |
| ONARLY AI projektunderlag | MOCK/syntetisk HTTP PASS | Verklig Gateway-inferens ej körd; ingen ny AI-plattform |
| Infrastructure | Behörig register-/observationsprojektion PASS | Ingen ny agent/serveranslutning eller hälsomätning gjord |
| Factory | LOCAL/MOCK PASS, kvoter bevarade | Fortsatt separat provider-/identitets-/backup-/restoregrind |
| Native Windows + verklig PCC HTTP/MFA/Storage | BLOCKED_SCHEMA och stängd tidigare tunnel | Ingen installation eller deployment gjord |

Nästa nödvändiga steg är separat godkännande av den konkreta migrationen i
befintlig isolerad stack, med schema-/backupbaslinje, samtidigt klientstopp
vid DDL-behov och verifierad återställningsväg. Därefter återanvänds en säker
lokal tunnel och separat native-testprofil: verklig GoTrue/TOTP/aal2, direkta
RPC/RLS-attacker, filuppladdning/signerad nedladdning samt återkallelse testas
innan ett native-PASS kan lämnas. Befintlig installation och Credential
Manager-session får inte ersättas. Ingen ny teststack krävs.

Före produktion krävs separat säkerhets-/migrationsreview, aktuella scoped
grants, verifierad extern krypterad backup och godkänd faktisk restore,
providercredentials i serverns secret store samt uttryckligt driftgodkännande.
Denna rapport är inget tillstånd att köra produktionsmigration eller inferens.

## Git och säkerhetskontroll

Branch och HEAD är oförändrade. Samtliga 126 tidigare konkreta arbetsfiler
finns kvar; 118 är byte-identiska och åtta har byggts vidare på för den
begärda integrationen. Övriga ändringar är avsedda rena basfiler eller nya
PCC-filer. Ingen oväntad ändring eller annan aktiv BerryIT-chatt observerades.

Detta pass berör 44 filer: 24 nya och 20 vidareutvecklade befintliga filer.
Hela arbetsträdet innehåller 162 dirty paths (27 modifierade, 135 untracked),
inklusive tidigare arbete. Index är tomt. Inga tidigare migrationshashar har
ändrats. Diff-/källgranskning och en kompletterande mönstersökning fann inga
nya verkliga nycklar, JWT, privata nycklar eller kunduppgifter. Testidentiteter
är syntetiska. Testsessioner, datakopior, credentials, screenshots och byggda
artefakter ingår inte i de nya avsedda Git-filerna.

GitHub Actions har endast verifieringstriggers; de nya testerna är tillagda
utan att ta bort spärrar. Ingen Actions-körning utlöstes här. Ingen commit,
push, merge, deployment, produktionsmigration, kontoradering eller
konfigurationsändring på core/prod utfördes.

## Filförteckning för detta pass

- `.github/workflows/verify.yml`
- `desktop/src/App.tsx`
- `desktop/src/project-control/client.ts`
- `desktop/src/views/Factory.tsx`
- `desktop/src/views/OnarlyAi.tsx`
- `desktop/src/views/Projekt.tsx`
- `desktop/src/views/Tasks.tsx`
- `desktop/tests/communications-security.test.ts`
- `desktop/tests/shared.test.ts`
- `docs/project-control-center-2026-10-25.md`
- `docs/project-control-center-migrations.json`
- `package.json`
- `services/connector-engine/project-issues.mjs`
- `services/connector-engine/project-issues.test.mjs`
- `services/connector-engine/repository-access.mjs`
- `services/onarly-ai-adapter/project-context.test.mjs`
- `services/onarly-ai-adapter/server.mjs`
- `shared/nav.ts`
- `shared/project-access.ts`
- `shared/project-candidates.ts`
- `shared/project-control.ts`
- `shared/ui/FactoryWorkspace.tsx`
- `shared/ui/ProjectAccessWorkspace.tsx`
- `shared/ui/ProjectControlWorkspace.tsx`
- `shared/ui/TaskWorkspace.tsx`
- `src/app/api/control/project-control/attachment/route.ts`
- `src/app/api/control/project-control/route.ts`
- `src/app/api/control/project-sync/route.ts`
- `src/app/control/(shell)/tasks/page.tsx`
- `src/components/control/ProjectAccessClient.tsx`
- `src/components/control/TasksClient.tsx`
- `supabase/migrations/20261025112940_project_control_center.sql`
- `supabase/tests/active-grants-hotfix.test.mjs`
- `supabase/tests/master-upgrade.test.mjs`
- `supabase/tests/onarly_ai_assistant_test.mjs`
- `supabase/tests/project-control.test.mjs`
- `supabase/tests/upgrade-plan.test.mjs`
- `supabase/upgrade-plan.mjs`
- `tests/project-control/index.html`
- `tests/project-control/main.tsx`
- `tests/project-control/package.json`
- `tests/project-control/playwright.config.ts`
- `tests/project-control/run.mjs`
- `tests/project-control/workflow.spec.ts`
