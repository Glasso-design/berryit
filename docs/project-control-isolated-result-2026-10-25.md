# PCC — faktisk isolerad migrations- och HTTP-grind

Datum: 2026-10-25. **Backup/restore: PASS. Låst PCC-migration: PASS.
Sammanhållen HTTP-/releasegrind: BLOCKED (30 PASS, 0 FAIL, 1 BLOCKED).**

Utfört efter användarens uttryckliga godkännande för denna isolerade grind.
Ingen produktion, deployment, containeromstart, radering, commit eller push.
Produktkod och det låsta migrationspaketet har inte ändrats i detta pass.

## 1. Identitet och applicerat paket

Färska kontroller utfördes inför backup, innan den nya restore-databasen
skapades och omedelbart innan PCC-paketet applicerades:

- SSH-nod `core-node-01`, befintlig SSH-identitet och verifierad host key.
- Container `berryit-iso-83a2f62f-db`, ID
  `1ea52edd800810ecb1e48aa743a99ceaf95a09b3a3da45a4ae4fcd490722988b`.
- Endast denna container använder `berryit-iso-83a2f62f-db-data`.
  Exakt en skrivbar PG-datavolym och två tidigare granskade, skrivskyddade
  init-binds under teststackens katalog. Rätt Compose-projekt och nätverk.
- Databas `postgres`, exakt de 16 föregående migrationsnamnen i låst ordning.
  Inga PCC-objekt eller permissionkollisioner, ingen live-Factory och inga
  andra aktiva klienttransaktioner inför DDL. Alla konton klassificerades
  inom den redan kända syntetiska stacken; inga identiteter skrevs ut.
- Samtliga lokala migrationshashar och det färdiga paketets hash stämde.

Applicerad källa: `supabase/migrations/20261025112940_project_control_center.sql`.
Källans SHA-256:
`9e2e4dbc9c8ed3500b4fcb61fdd5d009e160dc2a2917052aff6badc619ea26f8`.

Applicerat paket:
`C:\projects\berryit\test-results\project-control-native-20261025\review-package\review.sql`.
SHA-256: `c08045eae95672e46a97d8ec5e3f5f9308fbb06edecc597cde1884e0a0ea929e`.

Exakt denna migrationskropp kördes med `ON_ERROR_STOP`, transaktion,
advisory lock, timeoutgränser och nya baselinekontroller inne i transaktionen.
Ledgerpost och PostgREST schema-reload-NOTIFY ingick i samma COMMIT.
Ingen annan uppgradering eller historisk migration applicerades.

Verifierat efteråt: **17 migrationer, 9 nya tabeller med RLS, 28 nya offentliga
funktioner med säker search_path och noll anon-EXECUTE**. De avsedda åtta
permissions och privat taskbucket finns. Klientens direkta taskskrivning och
service-import-RPC nekades genom verklig SQL/HTTP.

## 2. Full testdatabasbackup och verklig återställning

Run-ID: `59cac62cc8284d1ea4548ae085126164`.

Versionsmatchade `pg_dump`/`pg_restore` **17.6**, befintlig lokalt tillgänglig
`supabase_admin` i just testcontainern. Inga nya rättigheter eller verktyg.
`pg_dump --format=custom` omfattade hela testdatabasen, utan schema-/tabellfilter.
En exporterad PostgreSQL-snapshot hölls öppen för dump och innehållsfingeravtryck.
Binärdata transporterades som bytebuffertar över SSH, aldrig genom PowerShells
textpipeline. Ingen okrypterad dump skrevs till disk.

Backup:
`C:\projects\berryit\test-results\project-control-native-20261025\execution-59cac62cc8284d1ea4548ae085126164\database.dump.aesgcm`

- Dumpens storlek: **920 077 byte**.
- Dumpens SHA-256 efter autentiserad dekryptering:
  `71d3a50757b5ea6f3c489c4c6c3c3f7cb6e756b2b5283ceef5bedc6ce52165c3`.
- Krypterad fils SHA-256:
  `732274e279727a08d6720987f30e9d8db1436e93896aac88b2c8d03865ad50fa`.
- AES-256-GCM med slumpnyckel, IV, autentiseringstagg och run-ID som AAD.
  Manipulerad ciphertext nekades. Sparad fil dekrypterades och kontrollsumman
  verifierades före återställning. `pg_restore --list` verifierade arkivet.
- Återställningsnyckeln finns separat i
  `...\project-control-native-20261025\recovery-59cac62cc8284d1ea4548ae085126164\key.dpapi`.
  Den är Windows DPAPI CurrentUser-skyddad. Båda katalogerna har bruten ACL-
  arvskedja och full åtkomst enbart för den aktuella Windows-användaren och SYSTEM.
  Nycklar eller Auth-innehåll ingår inte i Git eller denna rapport.

Ny, kollisionstestad databas i **samma befintliga isolerade PostgreSQL-container**:
`berryit_pcc_59cac62cc8284d1e`. Den fick run-specifik ägarmarkering.
Ingen HTTP-tjänst pekades om till den. Ingen annan befintlig databas ändrades.
`pg_restore --exit-on-error --single-transaction` gav **exit 0**.

Verifierat före PCC-migrationen:

- **98 tabeller, 1 624 rader** identiska mot samma snapshot.
- RLS/policies, funktioners kroppar, ägarskap, SECURITY DEFINER, search_path
  och ACL-rättigheter matchar.
- **4 sekvenser, 547 constraints, 289 index, 3 vyer, 69 triggers och 5
  extensionversioner** matchar, inklusive sekvensernas värden.
- Negativa jämförelsetester upptäckte ändrad RLS respektive ändrad ACL.

Den första strikta jämförelsen stannade på ACL-arrayordning. Rättigheter och
grantors jämfördes därefter som ordnade mängder. Tre CHECK-uttryck hade endast
redundanta AND-parenteser; PostgreSQLs egen pretty-deparser gav identiska
uttryck. Inga grants, constraints eller säkerhetsvillkor ändrades för att få PASS.
DDL var spärrad tills dessa jämförelser var verifierade.

Bevisgräns: detta är full **enskild testdatabas**, inte en ny oberoende
PostgreSQL-clusterrestore eller komplett Supabase-driftsrestore. Clusterroller
återanvändes. Storage-blobfiler och tjänsternas secrets/config omfattas inte av
en databasdump. Detta öppnar ingen produktionsbackup-/releasegrind.
Restore-databasen, krypterad backup och syntetiska testdata finns kvar;
ingen automatisk cleanup eller återställning över källdatabasen sker.

## 3. Verkliga HTTP-, MFA-, RLS- och PCC-resultat

Befintlig loopbacktunnel `127.0.0.1:18750` till testgatewayens `127.0.0.1:8750`
återupprättades med befintlig SSH-identitet. Endast testkonton och syntetisk data.
Nya testsessioner använde `persistSession:false`; endast dessa sessioner
loggades ut. Befintlig Windows-installation, config, Credential Manager och
användarens befintliga session ändrades inte.
Ingen generell utloggning eller sessionsrensning gjordes. Sessionsrader från
ett avbrutet syntetiskt diagnostikförsök kan finnas kvar; inga tokens sparades
av det försöket och det används inte som bevis på fullständig sessionstädning.

Slutlig full körning i `http-results-complete.json`: **30 PASS, 0 FAIL,
1 BLOCKED**. Den separata slutgrinden i `http-gate-disposition.json` är BLOCKED.
Testverktyget returnerar nu exit 2 vid BLOCKED, exit 1 vid FAIL och endast
exit 0 när samtliga kontroller passerat; fyra rena statusregressioner bevisar detta.
Denna rapport gör inte tidigare felaktiga testantaganden till PASS.

| Område | Faktiskt verifierat |
|---|---|
| Auth/MFA | Riktig GoTrue-login, verkliga TOTP-faktorer/aal2, serverns aktuella Super Admin-status; aal1 nekas känslig projektadministration, synk och utvecklingsunderlag |
| RLS/tenant | Riktiga PostgREST- och direkta SQL-anrop med verifierad sessionsidentitet; egna scoped rows synliga, främmande projekt/organisationer och manipulerade ID nekas |
| Roller | Dynamiska scopes, nekad rolleskalering, skyddade profilfält, återkallelse och tidsutgång slår igenom i redan inloggad aal2-session |
| Sessioner | Manipulerad signerad JWT nekas; gamla tokens efter lokal logout kan inte göra privilegierade anrop |
| Tasks | Skapa, ändra, tilldela, deadline/checklista, kommentarer, interna/publicerade uppgifter, avslut, arkivering/återaktivering och spårbar historik |
| Paginering | 105 tasks över två riktiga HTTP-sidor, utan dubbletter/förlust; projektarkivering bevarar tasks |
| Bilagor | Riktig Storage-uppladdning och trusted storlek, intern isolering, signerad nedladdning, manipulerad signatur och utgången URL nekas; gamla interna bilagor förblir privata efter taskens synlighetsändring |
| Återkallelse/Storage | Ny signering nekas efter återkallad grant. En redan utfärdad signerad URL är en tidsbegränsad bearer capability; omedelbar revokering av en tidigare giltig URL påstås inte |
| Infrastructure | Riktigt registrerat syntetiskt nod-/tjänstträd, avsiktligt pausad tjänst och ej verifierad status; URL med query-hemlighetskanarie filtreras, obeviljad infrastrukturläsning döljs |
| Git-kopplingar | Pinned read-only-register, tenantkontroll och ingen token i publik katalog; service-only import av syntetiskt upstreamunderlag går genom verklig SQL/HTTP, är idempotent och skriver inte över manuella taskfält |
| Utvecklingshistorik | Append-only audit och manuellt underlag; affärsdata och lokala sökvägar exkluderas ur riktig AI-kontext-RPC; inget falskt verifierat deployment-/backupresultat |
| Support Desk | Riktiga syntetiska tickets i samma kärna, tenantbundna task-/projektkopplingar och ärendeläsning; främmande ärendekoppling nekas |
| PCC-gränssnitt | Alla åtta befintliga flikar, tasks/kommentarer/historik, registrerad infrastruktur/Git och Support Desk-navigering renderade i Chromium mot riktig isolerad Auth/PostgREST via lokal testproxy; inga JavaScript-/React-krascher |

Browserbeviset gäller **Chromium**, inte native WebView2 eller en ny installerare.
Webb-/Desktop-produktkod är oförändrad; tidigare verifierade produktionsbyggen
återanvänds för samma källhashar. Ingen ny installerare eller deployment gjordes.
Ingen riktig GitHub-provider eller extern AI-inferens anropades.

Utvecklingen av testharnessen innehöll korrigerade antaganden: vanliga
taskpermissions kräver enligt registret inte MFA (känslig synk/evidence gör det),
profil-PATCH skyddar privilegier genom att bevara gamla fält, saknat Storage-
objekt ger 55000 och äldre historik ligger efter första sidan. Ett SQL-test
med FOR UPDATE måste använda en alltid återställd transaktion, inte READ ONLY.
Browserns load-event nådde en lokal 15-sekundersgräns i en mellanliggande körning;
DOMContentLoaded plus explicit väntan på faktisk PCC-rendering passerade.
Alla mellanresultat är kvar; slutkörningens 0 FAIL får inte tolkas som att dessa
första körningar också passerade.

## 4. Verifierad blockerare: revisionskonflikter i PostgREST 14

Teststackens **PostgREST 14.12** återförsökte en avsiktlig stale-revision med
SQLSTATE **40001** i stället för att leverera ett färdigt fel. HTTP avbröts av
testets 15-sekundersgräns. Taskens revision ändrades inte. Direkt SQL verifierade
sedan 40001-spärren i en transaktion som alltid avslutades med ROLLBACK.

En egen hängande diagnostikprocess stoppades och dess särskilt identifierade
testfråga avbröts med `pg_cancel_backend` i den isolerade databasen. Ingen
backendprocess terminerades och ingen container eller tjänst startades om.
Slutkontrollen gav **noll aktiva andra klienter**.

Detta överensstämmer med [Supabases dokumenterade 40001-problem i PostgREST 14](https://github.com/orgs/supabase/discussions/50151).

Separat granskning behövs för en framåtriktad korrigering som använder en
icke-återförsökt konfliktkod, exempelvis `PT409`, för verkliga stale revisions.
Inventerade ställen:

- `save_project_task`, PCC-källans rad 207.
- `save_support_project`, historiska project_access-källans rad 317.
- `save_support_role`, samma historiska källas rad 452 (impact-konflikt).

Ändra inte historiska eller nu applicerade filer. Nästa granskade migration ska
bevara funktionernas samtliga identitets-, permission-, scope-, MFA-, lås-, audit-
och revisionsvillkor och testa verkligt HTTP 409, oförändrade data vid konflikt
och uteblivna retry-loopar. Ingen sådan ny migration är skapad/applicerad här.

## 5. AI-adaptern — exakt avvikelse och nästa granskning

Den isolerade containerns `/app/server.mjs` saknar `project_control_ai_context`.

| Fil | Isolerad container SHA-256 | Lokal källa SHA-256 |
|---|---|---|
| server.mjs | `5be833bae09b4785f4987a8c6246b0ede4aa1aa116ec3affbf79ddf20dfac5da` | `43f8645fd8d02b37a398407839a169fba3fceeae41df96920810b34b04bef4bc` |
| diagnostics.mjs | `40bc868c78b3336d2df687a0f6673f1dd3d29e82758b11eb1b3df7c4b54753b8` | Samma hash |

Den redan implementerade lokala serveradaptern behöver, efter separat
adapter-/driftsgranskning, ersätta den äldre isolerade `server.mjs`:

1. `sourceContext` och diagnosticContext hämtar PCC-RPC med **anroparens token**,
   rätt projekt och aktuell sessions-/tenantkontroll, aldrig service-role för
   underlagsläsning.
2. PCC-fakta och uttryckliga informationsluckor förs in i prompten. Manuellt
   registrerade uppgifter är inte verifierad server-/produktionsstatus.
3. Kontext och behörighet kontrolleras igen efter Gateway-svaret, före lagring.
   Ändrad/återkallad kontext stoppar svaret. Okänd eller förbjuden källa uppfinns inte.
4. Befintligt samtycke, syntetisk Gateway, säkra konfigurationsgränser och
   icke-exekverande rekommendationer behålls.

Ingen ny databasmigration behövs för den **befintliga** lokala adapterkodens
PCC-RPC-anrop. `diagnostics.mjs` behöver enligt hashjämförelsen inte ändras.
Ingen adapterfil, image, env eller tjänst har uppdaterats här. Riktig end-to-end
PCC-kontext genom den **driftsatta** isolerade adaptern är därför BLOCKED.
En lokal adapterprocess eller isolerad containeruppdatering är en ny konkret
verifieringsåtgärd som ska granskas separat; ingen produktionsinferens ingår.

## 6. Databevarande, regressioner och filer

Omedelbart efter migrationen var samtliga **94 befintliga tabeller utan avsedd
katalogändring** byte-identiska på radnivå. Tillåtna tillägg var permissions,
roll-permissionkopplingar, ledger och privat bucket.

Efter alla testkörningar jämfördes varje ursprunglig icke-Auth-rads hash mot den
återställda 16-migrationsdatabasen: **659 ursprungliga rader i 75 tabeller finns
kvar oförändrade**, inklusive samtliga 28 organisationer, 56 profiler, 21 projekt,
40 grants och 7 ärenden. Alla **56 ursprungliga Auth-identiteter** matchar på ID,
e-postfingeravtryck och skapandetid. Auth-inloggnings-/sessionstider är avsiktligt
inte byte-identiska efter riktig login/MFA. Nya syntetiska konton, projekt,
ärenden, tasks och audit finns kvar; ingen rensning har utförts.

Alla sju isolerade containrar kör fortfarande med startdatum 2026-10-17 och
restartCount 0, inklusive befintlig syntetisk Gateway. Ingen annan miljö ändrades.

Nykörda lokala regressioner (PGlite får inte förväxlas med ovanstående riktiga HTTP):

| Kontroll | Resultat |
|---|---|
| Databasens samlade RLS/MFA/Communications/Monitoring/Support/DESK-säkerhet | 272 PASS |
| PCC SQL/upgrade/negativtester | 24 PASS |
| Projekt/dynamiska roller | 40 PASS |
| Communications/Storage/security repair | 22 PASS |
| Låst PCC-pakets säkerhetsspärrar | 18 PASS |
| Connector/Git/AI-adapter/diagnostik | 38 PASS |
| BLOCKED/FAIL/PASS-grindens negativa tester | 4 PASS |
| Desktop, inklusive Communications och React-produktionsbundle | 150 PASS |
| Support Desk SQL/client/browserresa | 3 PASS |
| Typecheck inklusive Next typegen | PASS |
| Slutlig lint | PASS, 0 varningar |

Exakt slutlig Git-status dokumenteras också i den maskinläsbara slutverifieringen
under test-results. Inga historiska
migrationer, produktkällor eller tidigare arbetsfiler skrevs över.

Nya versionshanterbara testkällor i detta pass:

- `tests/project-control/existing-isolated-http.mjs`
- `tests/project-control/existing-isolated-browser.mjs`
- `tests/project-control/isolated-sql-readback.mjs`
- `tests/project-control/isolated-results.mjs`
- `tests/project-control/isolated-results.test.mjs`
- `tests/project-control/http-main.tsx`
- `tests/project-control/http-index.html`

Dokument: denna rapport och uppföljningshänvisning i den tidigare isolerade grinden.
Live-testerna är **operatörsstyrda**, kräver ett separat godkänt manifest under
Git-ignorerade `test-results`, fast mål och skyddade testcredentials. De är inte
aktiverade som automatiskt serverjobb i CI. Kör inte om dem som cleanup.

Skyddade/ignorerade bevis finns under
`C:\projects\berryit\test-results\project-control-native-20261025\`:
backup-/restorefingeravtryck, migrationsresultat, `http-results-complete.json`,
`http-gate-disposition.json`, `final-data-audit-with-auth.json`, regressionloggar
och `real-http-pcc.png`. Den lokala operatörskörningen ligger i
`run-approved-gate.mjs`; den är inte en godkänd generell produktionskörväg.

Git: `feat/support-desk`, HEAD `dabecfe34e71a1ffc7e98fd1be6968a23fd91df2`,
origin `https://github.com/Glasso-design/berryit.git`. **173 dirty paths:**
27 tracked modifierade och 146 ospårade filer, tomt index. Alla tidigare 47
kontrollhashade arbetsfiler är oförändrade utom den avsiktliga
uppföljningshänvisningen i den tidigare grindrapporten. Den låsta migrationskällan
och paketet är oförändrade; inga historiska tracked migrationsdiffar.
`git diff --check`: PASS. Ingen annan BerryIT-agent var aktiv.

**Stopp:** ingen ytterligare migration, adapterdeployment, produktionsaktivering,
commit eller push. Granska 40001-korrigeringen och AI-adaptersteget separat.
