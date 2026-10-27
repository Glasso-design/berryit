# ONARLY Platform Factory — PASS 3A, godkänd isolerad körning

Datum: 2026-10-25. **ISOLERAD FACTORY/AUTH-DEL PASS; SAMMANLAGT PASS 3A OCH PRODUKTION BLOCKED.**

Fortsättning på pass3a-report-2026-10-25.md och den öppna schemafrågan i
pass3a-isolated-schema-gate-2026-10-25.md. Användarens uttryckliga besked
"Kör PASS 3A enligt detta godkännande" godkände de tre namngivna isolerade
schemaåtgärderna och efterföljande syntetiska verifieringen. Det är inte ett
produktions-, Cloudflare write-, SSO-deploy- eller backupaktiveringsbeslut.
Tidigare rapporter/manifester bevaras som historiska mätpunkter.

## 1. Genomfört i befintlig isolerad miljö

| Grind | Faktiskt utfall |
|---|---|
| Git | feat/support-desk, HEAD dabecfe34e71a1ffc7e98fd1be6968a23fd91df2; tom index |
| Skyddat arbete | Alla 120 tidigare modifierade/nya konkreta filer byte-identiska, inklusive 27 skyddade och 30 PASS 2-filer |
| Andra agenter | Appens trådlista visade endast denna aktiva BerryIT-arbetsyta; andra aktiva projekt lämnades orörda |
| Servermål | core-node-01, befintliga berryit-iso-83a2f62f-db / postgres |
| Container-ID | 1ea52edd800810ecb1e48aa743a99ceaf95a09b3a3da45a4ae4fcd490722988b |
| Isolering | Bind mounts under befintlig testrot; exklusiv named volume berryit-iso-83a2f62f-db-data; inga delade DB-mounts |
| Samtidighet | Inga andra aktiva klienttransaktioner inför DDL; befintliga lediga tjänstepooler lämnades orörda |
| Schema före | Inget Factory-schema, inga kolliderande Factory-RPC:er eller brokerroll |
| Schemaåtgärd | Granskat paket 001 → 002 → broker-hash-compatibility, atomisk transaktion, exit 0 och COMMIT bekräftad |
| Pakethash | 4405959248600b1dd3f50d72645d825cc94fcd77f11205487d5227ecaee04fed |
| API-schema | PostgREST NOTIFY reload schema; ingen process-/containeromstart |
| Katalog | 29 granskade produktdefinitioner; QABGO ADAPTER_IN_DEVELOPMENT; 0 live-godkända produkter |

Factory 001/002 har inte flyttats till produktionsmigrationskedjan och inga
historiska migrationer har ändrats. Korrigeringen använder PostgreSQLs inbyggda
SHA-256 i de två befintliga brokerfunktionerna; pgcrypto ligger kvar i extensions.
Ingen databas, runtime, bucket, DNS-post eller mailbox provisionerades.

Verifierat efter installation: 16 Factory-tabeller med RLS, inga anon-körbara
Factory-funktioner, inga osäkra SECURITY DEFINER-search_path och brokerrollen
kan inte logga in. Ingen ny API- eller behörighetsmodell infördes.

## 2. Riktiga isolerade HTTP-/MFA-/RLS-resultat

Slutförd körning: **21 PASS, 0 FAIL, 5 BLOCKED**. Verklig GoTrue, TOTP,
PostgREST och PostgreSQL användes i den befintliga stacken.

| Kontroll | Resultat och begränsning |
|---|---|
| Gateway/Auth/Storage health | HTTP 200; ingen Storage-objekt-ACL sluts av health |
| GoTrue lösenordslogin | PASS, verklig login i separat testsession; ogiltigt lösenord nekas |
| MFA | PASS, aal1 nekas privilegier och Factory-skapande; verklig TOTP ger aal2 för befintlig testägare och två nya syntetiska användare |
| Identitet | PASS för aktuell BerryIT GoTrue-identitet och serversvar; central ONARLY IdP/SSO är inte därmed verifierad |
| Factory-ägarskap | PASS, rätt owner/project/org och standard 10 000 000 000 byte; samma idempotency key ger samma jobb |
| Kundisolering | PASS, andra kundens jobb/instans/providerstatus returneras inte; listan innehåller endast egen instans |
| Manipulerade ID | PASS, annan organisation, annat projekt i samma organisation, annan kunds projekt och obehörig ägare nekas |
| Administrativa gränser | PASS, scoped användare kan inte ge sig ADMIN, köra worker-RPC eller förfalska tekniskt checklistunderlag; anon nekas list-RPC |
| Direkt RLS | PASS via SET LOCAL ROLE authenticated med samma verkligt verifierade GoTrue-identitet och levande aal2-session: egen instans 1, främmande 0, egna jobb 1 |
| Skrivskydd | PASS, tabell-ACL nekar direkta klientskrivningar; factory är inte ett exponerat REST-schema och providerstatus-INSERT nekas även via HTTP |
| Audit | PASS, Factory-begäran registreras av backend med MOCK-underlag |
| Manipulerad JWT | PASS, ändrad identitet med gammal signatur nekas via HTTP |
| Återkallad roll | PASS, samma befintliga session mister läs-/skrivrätt omedelbart vid nästa kontroll |
| Avslutad session | PASS, gammal aal2-token kan inte skapa Factory-instans efter logout |
| Central ONARLY → Factory/QABGO SSO | BLOCKED, ingen betrodd issuer-/audience-/tokenexchange-kedja finns i den verifierade kompositionen |
| SSO kundisolering/replay/revocation | BLOCKED, fem SSO-fall redovisas uttryckligen som blockerade |
| QABGO:s fyra appar via central SSO | BLOCKED, ingen sådan runtime/SSO-komposition är verifierad i denna stack |
| Intern Communications-bilagas objekt-ACL via HTTP | Ej körd här; separat kvarvarande fall i fulla 15-fallsgrinden |

De 21 kontrollerna inkluderar fixture- och browserkontroller; de är inte 21
fullständiga SSO-fall. Mappat mot den befintliga 15-fallsgrinden finns nio
verifierade fall, fem SSO-blockerare och ett ej kört Storage-objektfall.
Den fulla identitets-/releasegrinden är därför **BLOCKED**. Testdriverns exit 0
för den slutförda körningen betyder att de körda assertionerna passerar, inte
att SSO, Storage-objektgrinden eller produktionsrelease har godkänts.

### Avbruten första körning

Första körningen gav 16 PASS och 1 FAIL i testhjälparens tolkning av psql:s
DO-kvittens. Statusraden hade redan skrivits i testdatabasen; ingen automatisk
omkörning av schema eller rensning skedde. Kvittenshanteringen rättades och en
ny, separat märkt syntetisk körning slutförde samtliga 21 kontroller. Båda
resultaten/loggarna finns kvar. Det första felet döljs inte som PASS.

## 3. Factory-vyn

Den befintliga FactoryWorkspace och executeFactoryAction återanvändes
oförändrade. Chromium renderade vyn genom en lokal testproxy till riktiga
PostgREST-anrop med den scoped användarens verkliga aal2-session. Inga tokens
eller service-role-nycklar skickades till browsern.

Verifierat: egen instans visas, annan kunds instans/projekt saknas, rätt kvot
visas och BLOCKED_CREDENTIALS/SSO/backup-blockerarna presenteras. Inga pageerror-
eller React-hook-fel upptäcktes. Ingen worker kördes och ingen checklista
märktes som verifierad installation.

Providerstatusen är uttryckligen en **SYNTHETIC_HTTP-fixture i den riktiga
testdatabasen** med BLOCKED/UNVERIFIED-capabilities. Den är inte verklig
Cloudflare-evidens. LIVE_READ_ONLY/LIVE_VERIFIED publicerades inte.
Kostnaden visas som uppskattning, aldrig verifierad faktura.

Detta är funktionell headless-browserrendering av befintlig komponent genom
testtransport, inte native WebView2, produktions-Next-route, central SSO eller
visuell verifiering av hela den paketerade Desktop-appen. Ingen Desktop-
installation/session ändrades. Skärmbilden ligger Git-ignorerad i
test-results/platform-factory-pass3a-20261025/approved-real-http-factory-view.png.

## 4. Cloudflare — BLOCKED_CREDENTIALS

Den tidigare granskningen av godkända lokala/server-side credential-källor
hittade ingen avsedd Factory-credential. Ny processbaserad readonly-preflight
bekräftar BLOCKED_CREDENTIALS/NOT_RUN och **0 Cloudflare API-anrop**.
Inga andra produkters hemligheter genomsöktes och inga råvärden loggades.

| Funktion | Verklig status |
|---|---|
| Tokenstatus/kontoåtkomst | BLOCKED_CREDENTIALS |
| R2 read/list | BLOCKED_CREDENTIALS |
| DNS-zoner och records | BLOCKED_CREDENTIALS |
| Email Routing och verifierade mottagare | BLOCKED_CREDENTIALS |
| Tenant API/dedikerade managed accounts | Ej verifierad entitlement/credential |
| Standalone-konton | Tillgänglighet/eligibility okänd |
| Managed resource isolation | Kräver separat uttryckligt modellval; ingen fallback aktiverad |

Nästa läsande preflight behöver en godkänd secret-store-referens med
token.verify, account.read, r2.buckets.read, zone.read, dns.read,
email.routing.read och email.destinations.read inom exakt godkänt konto/zon.
Tenant-entitlement och dess separata autentiseringsmodell måste styrkas om
dedikerade Tenant-konton ska användas. Läsrätt bevisar ingen skrivrätt eller
kontoskapanderätt. Skicka inte credentials i chatten.

Lokala/mock-providers kan fortfarande testas, men ingen verklig kontotyp,
R2-anslutning, EU-jurisdiktion, TLS, DNS eller e-postfunktion får kallas REAL PASS.

## 5. Backup — BLOCKED

Läsande slutkontroll på core bekräftar fortsatt:

- /srv/berryit-backup finns, kapacitet 20 957 446 144 byte, tillgängligt
  19 866 902 528 byte.
- Inget repository-config eller repository-data/index/keys/snapshots finns.
- Ingen rest-server körs.
- Inget krypterat externt repository kunde därför återställas i detta pass.
- Separata hostnamn är inte bevis på oberoende fysisk felzon/offsiteplacering.

Tidigare restic/rest-server-installation återanvänds som inventerat faktum;
inget installerades, startades eller konfigurerades här. Ingen produktionsbackup,
dump eller kunddataöverföring gjordes. Kapacitet för DB/Storage/config,
retention och tillväxt måste fortfarande dimensioneras. Tidigare lokala
syntetiska restoretester ersätter inte återläsning från oberoende lagring.

## 6. Syntetiska fixtures och slutkontroll

Två testkörningar skapade sammanlagt fyra testkonton, fyra organisationer,
sex projekt, fyra scoped egna roller/grants samt fyra MOCK-jobb/instanser.
Två statusrader innehåller enbart blockerad syntetisk providerevidens.
Inga externa Factory-resursrader finns och ingen molnresurs skapades.

Alla fyra grant-ID kontrollerades mot respektive körnings explicita skapade
user/org/project/role-ID före avslut. Tre återkallades via skyddad MFA-RPC;
en var redan återkallad av negativtestet. Slutavläsning visar **0 aktiva
testgrants och 0 sessioner för de fyra nya testkontona**. Konton, data och
audit ligger kvar, utan rensning eller DELETE. Befintliga Windows-/Credential
Manager-sessioner och andra testkonton loggades inte ut.

Samtliga 68 containrar i före-/efterjämförelsen har identiska ID, status,
starttid och restart-räknare. Inga tidigare pausade containrar startades.
Inga Compose-/serverfiler ändrades. Endast detta pass egen SSH-tunnel öppnades
och stängdes efter verifiering av PID/kommando och noll andra klienter.

## 7. Tester, leveransfiler och Git

| Kontroll | Faktiskt resultat |
|---|---|
| Godkänd isolerad schema-/katalogtransaktion | PASS, exit 0; läst tillbaka |
| Slutförd verklig isolerad Auth/Factory/browser-körning | 21 PASS, 0 FAIL, 5 SSO BLOCKED |
| Första körning | 16 PASS, 1 testhjälparfel; logg bevarad |
| Lokala provider/quota/retry/isoleringstester i föregående fortsättning | 86/86 PASS; samma 30 PASS 2-filer, inte omkörda efter godkänd serverkörning |
| Lokal hashkompatibilitet i föregående fortsättning | 8/8 PASS |
| Atomiskt SQL-paket, lokala rollback-/replaykontroller | 3/3 PASS |
| Lint efter ny testkälla | PASS; oanvänd import avlägsnades, slutkörning utan varningar |
| Next typegen + TypeScript | PASS |
| Nya produktions-/Desktopbyggen | Ej körda; ingen produktkälla/paketering ändrades |
| Cloudflare readonly | BLOCKED_CREDENTIALS, 0 anrop |
| Full 15-falls identitetsgrind / extern restore | BLOCKED |

Nya versionshanterbara filer i detta godkända steg:

1. services/platform-factory/tests/existing-isolated-http.mjs
2. docs/platform-factory/pass3a-approved-execution-2026-10-25.md
3. docs/platform-factory/pass3a-approved-execution-manifest.json

HTTP-testet kräver explicit existing-isolated-berryit-läge och en lokalt
granskad manifestfil under test-results med den befintliga stackens exakta
identitet och credential-filreferenser. Credentials, lösenord och TOTP-hemligheter
läses enbart i minnet. Testet stöder inte kontoradering eller destruktiv cleanup.
Det separata lokala operatorhook-underlaget och de faktiska körmanifesten/loggarna
är Git-ignorerade; inga sessions-/credential-/installerarartefakter ingår i Git.

Alla tidigare 120 arbetsfiler är bevarade. Totalt 123 modifierade/nya konkreta
filer, tom index, oförändrad HEAD. Ingen Git-commit, push, merge eller produktions-
deployment/migration. Manifestet innehåller fil- och evidenshashar.

## 8. Exakta grindar före första verkliga QABGO-instansen

1. Godkänd begränsad Cloudflare-credential och REAL READ-ONLY-preflight för
   aktuellt konto, R2, zoner, routing och eventuell Tenant-entitlement.
2. Uttryckligt kontomodellsval; dedicated får inte ersättas av delat konto utan
   separat godkännande. Begränsade skrivcredentials följer inte av denna läsgrind.
3. Betrodd central ONARLY-SSO/produktaktivering samt separat godkänd isolerad
   körkomposition för QABGO:s fyra appar. Verifiera issuer, audience, kundscope,
   replay och revocation, samt återstående Storage-objekt-ACL i fulla identitetsgrinden.
4. Godkänd oberoende backupdestination/felzon, kapacitet/retention, append-only,
   separat writer/recovery-material och faktisk syntetisk restore från lagringen.
5. Separat granskad produktionsmigrationskedja, worker/broker-/Auth-/Storage-
   komposition, releaseversion och nödvändiga produktuppgifter. Den nuvarande
   isolerade SQL-installationen är inte ett produktionsmigrationspaket.
6. Uttryckligt godkännande av exakt första verkliga provisioneringsresa,
   resurser, budget, domän/mottagare och behörigheter. Därefter riktig R2/SigV4,
   multipart/CORS/header-kvot, reconciliation, DNS/TLS/e-post, isolation och recovery.
   Alla live-statusar förblir spärrade tills den resan är verifierad.

**STOPP: ingen ytterligare serverändring, provisionering eller release är
godkänd genom detta rapporterade resultat.**
