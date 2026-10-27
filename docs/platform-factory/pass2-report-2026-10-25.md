# ONARLY Platform Factory — PASS 2

Datum: 2026-10-25. **LOCAL / SYNTHETIC PASS. VERKLIG PROVIDER OCH PRODUKTION: BLOCKED.**

## Utgångsläge och skyddat arbete

Arbetet fortsatte på feat/support-desk, HEAD
`dabecfe34e71a1ffc7e98fd1be6968a23fd91df2`, i C:\projects\berryit.
MASTERPASS-rapporten, manifestet, README och faktisk kod lästes före ändringar.
De27 skyddade, tidigare ocommittade filerna är SHA-256-identiska med startläget.
MASTERPASS-rapport/manifest och historiska migrationsfiler är oförändrade.
Ingen annan agent användes och inget annat repository ändrades i PASS2.

## Implementerat

| Del | Faktiskt lokalt resultat | Extern begränsning |
|---|---|---|
| Cloudflare API | Fast HTTPS-origin, servercredentials, separata Tenant-key/Bearer-flöden, tokenstatus/expiry/revocation, begränsade svar, timeout, retry/backoff | Inga verkliga Cloudflare-anrop eller credentials verifierade |
| Kontomodeller | Tenant-dedikerat, villkorat standalone, explicit managed-resource isolation, aktuell capability discovery och kontoregister | Partnerentitlement och standalone-kontogräns kräver separat verifiering; inget tyst fallback |
| Ägarskap/idempotens | Beständiga SQL-intent, leases, inputhash, externa referenser, kollisionsskydd, samma idempotency key, reconciliation | Tvetydigt bucket-create stoppas för manuell kontroll eftersom ett namn inte bevisar ägarskap |
| R2 | Bucket-API, EU/US-jurisdiktion, SigV4 och riktig S3 multipart/HEAD/list-kod | Verkligt R2, CORS, credential scope och header enforcement ej testade |
| Kvotbroker | Samma instances/reservations, atomiska lås, standard10GB, begränsad broker-roll, signerade120-sekunders del-URL:er, serverkomplettering, dubbelräkningsskydd och80/90/100-varningar | Logisk kvot är inte Cloudflare-faktura eller kostnadstak; oklara MPU:er förblir reserverade |
| Produktkoppling | Broker-routes monterade i oförändrad QABGO Core i isolerad testkomposition, befintlig aktuell session/tenant/permission kontrolleras | Produktionens godkända host/anslutningskomposition och objektflöden återstår; ingen QABGO-kod ändrad |
| DNS/TLS | Instansbundet CNAME, zon/konto/ägarskap, kollisionskontroll; TLS mot godkänd publik/pinnad adress och certifikatkontroll | Inga verkliga DNS- eller TLS-förändringar |
| E-post | Verifierad mottagare, instansdomän, routing; separat samtyckesskyddad Sending REST-adapter; separat mailbox-kontrakt | Routing är ingen mailbox; Sending kräver separat entitlement/DNS-verifiering; inget verkligt mejl skickat |
| Control Center | Kontomodell, explicit modellbytesgodkännande, capabilities, saknade rättigheter, observationstid, resurskälla/status, kvot, DNS/TLS/e-post, kostnadsunderlag och blockerare | Syntetiska resurser märks SYNTHETIC_HTTP; ingen live-PASS eller verifierad faktura påstås |
| Aktiveringsgrind | Signerat, tidsbegränsat servermanifest med scope, exakta intent/inputhashar och backup/restore/HTTP-MFA-SSO-underlag | Inget live-godkännande finns; worker och SQL är fortsatt MOCK-only |

ProviderRegistry, FactoryEngine, projekt-/organisationsregister, befintliga
support_roles/permissions/grants, aktuell MFA/sessionkontroll och audit återanvänds.
Inget parallellt kund-, roll-, AI- eller provisioneringssystem infördes.

## Tester som faktiskt kördes

| Kontroll | Resultat |
|---|---|
| npm run test:factory | **86/86 PASS**, inklusive nya negativa provider-, kvot-, privilegie- och aktiveringsfall |
| npm run test:factory-ui | **1/1 PASS**: riktig browserrendering, SQL-auktorisering, providerstatus, uttryckligt modellbyte, bakgrundsjobb/checklista |
| provider-postgres.test.mjs | **4/4 PASS**: sex oberoende PG-sessioner, två QABGO-runtimes, riktig produkt-HTTP-auth, manipulerade ID, multipart och inaktiverad användare |
| Befintlig local-qabgo.test.mjs | **8/8 PASS**:19 migrationer, två egna DB/runtimes, fyra produktionswebbbundles med verklig lokal HTTP-login, isolering, kvotlås, krypterad syntetisk DB/objekt/config-restore till tredje ny DB |
| npm run db:test | **272/272 PASS**: befintlig säkerhet/RLS/MFA/Support/Communications/DESK-regression |
| npm run db:access-test | **40/40 PASS**: dynamiska roller/projektscope och negativa RLS-fall |
| npm test --prefix desktop | **149/149 PASS**, inklusive en React-runtime i produktionsbundle |
| Connector/Monitoring/Communications/AI-service-regressioner | **135/135 PASS** |
| npm run lint | **PASS**, exit0 |
| npm run typecheck (inklusive next typegen) | **PASS**, exit0 |
| npm run build | **PASS**, Next.js Webpack, exit0 |
| npm run build --prefix desktop | **PASS**, Vite/TypeScript, syntetisk loopback-konfiguration; ingen installerarpaketering eller installerad app ändrad |
| git diff --check | **PASS**; endast befintliga LF/CRLF-notiser |
| Verklig Cloudflare | **EJ KÖRT / BLOCKED**, inga riktiga konton/buckets/DNS-regler/mejl |
| Verklig Supabase HTTP/TOTP/ONARLY SSO | **BLOCKED**, separat15-fallsgrind förberedd; dess syntetiska test är inte verklig MFA/SSO |
| Extern produktionsbackup/restore | **BLOCKED**, lokal syntetisk restore ersätter inte den externa grinden |

Nya negativa tester omfattar saknade rättigheter, utgångna/återkallade/felaktiga
tokens, fel scope/konto/zon/mottagare, kollisioner,429, timeout efter provider-
commit, retry utan dubblett, samtidiga leases/reservationer, signerad delstorlek
och checksumma, URL-manipulation/replay, tappat completion-svar, föråldrad
inventering, dubbelräkning, förfalskad checklista/status, fel MFA och direkt RPC.
Worker-testet använder service_role och brokertesterna den begränsade
factory_broker-rollen, inte bara schemaägaren.

HTTP-försöket i begränsad sandbox kunde först inte nå sin egen loopback-server.
Samma isolerade test passerade med tillåten lokal nätåtkomst. Slutgranskningen
identifierade behov av explicita worker-EXECUTE-grants; den framåtriktade lokala
migrationen kompletterades och testades med faktisk worker-roll. Slutresultaten ovan gäller de
gröna omkörningarna, inte de tidigare misslyckade försöken.

Den nya ägda PG16-instansen körde enbart på127.0.0.1:19843, med nytt run-ID,
skyddade syntetiska credentials och nya databaser. Den stoppades efter kontroll
av marker/datapath/port och att andra klienter saknades. Ingen testdata raderades,
ingen befintlig instans återanvändes och inga Linuxservrar kontaktades.
Native WebView2, Tauri/Rust och Windows-installerare byggdes/testades inte i PASS2.

Loggar och skyddade testartefakter finns under
`test-results/platform-factory-pass2-20261025/` och den stoppade ägda klusterns
`test-results/platform-factory-20261024/postgres-pass2-20261025/`.
Credentials, dumpmaterial och genererade bundles är Git-ignorerade och får inte
publiceras. PostgreSQL-providerfallet verifierades via verktygets direkta output;
övriga längre körningar har lokala loggar.

## Migration och säkerhet

Ny **services/platform-factory/db/002_provider_broker.sql**, efter001.
Fortfarande isolated-test-guardad och utanför produktionens migrationskedja.
Den lägger till privata RLS-skyddade intent/account/status/MPU/binding-tabeller,
separat MFA-skyddat modellgodkännande och kvotens revisionsstängsel. Alla
privilegierade funktioner har tom search_path och explicita EXECUTE-grants.
Anon/authenticated saknar åtkomst till provider-/broker-skrivytan. Produkt-
brokern har ingen allmän service-role- eller tabellbehörighet.

Klienter får inga service-role-, Cloudflare-, R2- eller SSH-hemligheter.
Nya filer granskades och mönsterskannades utan att skriva ut matchade värden.
Enda access-key-formatmatchningen var AWS:s offentliga referensvektor i ett
test; övriga testcredentials är uttryckligen syntetiska. Ingen riktig nyckel,
session, kunduppgift, produktionsconfig eller installerare ingår i PASS2-filerna.

Kvarstående tekniska begränsningar: ingen automatisk ägaradoption efter tvetydigt
bucket-create/MPU-initiate; sådana resurser kräver manuell reconciliation och
reservationen ligger kvar. Inventering över100000 objekt stoppar uttryckligen
för batchgranskning, aldrig ofullständig framgång. Signerade del-URL:er kan
återanvändas inom120 sekunder men kan inte ändra delstorlek/nyckel/checksumma eller
slutföra objekt; fullföljande kräver ny serverauktorisering. API-requests kan
fortfarande vara fakturerbara. Desktop-bygget har en chunkstorleksvarning;
Node-/Playwright-testverktygen har befintliga module-type/NO_COLOR-notiser.

## Extern aktiveringsgrind och första riktiga QABGO

**Ingen del är godkänd för produktionsaktivering genom denna rapport.**

1. Verifiera partnerentitlement/unit eller standalone-ägare/kontogräns; annars
   uttryckligt separat godkännande av shared resource isolation. Ordna rätt
   servercredentials, nya kontons credentialflöde och konton/zoner med minsta scope.
2. Kräver User Details Read/membership för standalone, godkänd Tenant-key för
   partners, account/token-verifiering, Workers R2 Storage Read/Write och
   bucket-scopad S3-access, Zone/DNS Read/Write samt Email Routing Addresses Read
   och Rules Read/Write. Sending kräver separat entitlement/permission. Verifiera
   aktuella permission-group-ID via Cloudflare, inte gissade ID.
3. Kör godkänd separat isolerad Supabase HTTP/MFA/Storage och ONARLY→Factory/QABGO
   SSO-grind. Befintlig remote-teststack antas inte saknas; den inventerades inte
   i detta pass. Ingen stack installerades eller ändrades.
4. Verifiera krypterad extern DB+Storage+config-backup, oberoende recoverymaterial,
   faktisk restore och återställd applikationsåtkomst. Tidigare backupblockerare
   gäller fortsatt; ingen produktionsbackup aktiverades här.
5. Separat granskning/godkännande av framåtriktad produktionsschema- och worker-
   komposition, brokeranslutning/produktobjektflöden, supervision/leases och
   driftidentiteter. MOCK-spärrarna får inte bara plockas bort.
6. Därefter separat godkänd begränsad verifiering mot riktig provider: R2/CORS/
   signaturer/kvotisolering, konto, DNS/TLS och routing, före första verkliga kund.
   Release/version, runtime/DB, identitetsaktivering, budget och restore måste
   också vara godkända. Routing ger fortsatt ingen fullständig mailbox.

Detaljer och primära API-källor:
[pass2-providers.md](pass2-providers.md).

## Exakta PASS2-filer

Nya filer:

- docs/platform-factory/pass2-providers.md
- docs/platform-factory/pass2-report-2026-10-25.md
- docs/platform-factory/pass2-delivery-manifest.json
- services/platform-factory/db/002_provider_broker.sql
- services/platform-factory/providers/activation-gate.mjs
- services/platform-factory/providers/cloudflare-api.mjs
- services/platform-factory/providers/cloudflare-provider.mjs
- services/platform-factory/providers/quota-broker.mjs
- services/platform-factory/providers/r2-s3.mjs
- services/platform-factory/providers/resource-registry.mjs
- services/platform-factory/providers/status.mjs
- services/platform-factory/providers/tls-email.mjs
- services/platform-factory/tests/activation.test.mjs
- services/platform-factory/tests/http-identity-gate.mjs
- services/platform-factory/tests/identity-gate.test.mjs
- services/platform-factory/tests/provider-http.test.mjs
- services/platform-factory/tests/provider-postgres.test.mjs
- services/platform-factory/tests/provider-resources.test.mjs
- services/platform-factory/tests/provider-security.test.mjs
- services/platform-factory/tests/r2-broker.test.mjs
- services/platform-factory/tests/synthetic-r2.mjs

Uppdaterade befintliga MASTERPASS-filer:

- services/platform-factory/README.md
- services/platform-factory/providers/cloudflare.mjs
- services/platform-factory/providers/registry.mjs
- services/platform-factory/tests/fixture.mjs
- services/platform-factory/tests/postgres/local-qabgo.mjs
- services/platform-factory/tests/run.mjs
- shared/factory.ts
- shared/ui/FactoryWorkspace.tsx
- tests/factory/workflow.spec.ts

## Git och stopp

30 PASS2-filer:21 nya och9 befintliga uppdaterade. Hela arbetsytan innehåller
110 modifierade/nya konkreta filer inklusive tidigare arbete. De27 skyddade
filerna är oförändrade. Ingen staging, commit, push, resursbeställning, DNS-/
e-poständring, radering, serverändring eller produktionsmigration/deployment.
Branch och HEAD är oförändrade. Se separat SHA-256-manifest för leveransens
filgräns, bevarandekontroll och testutfall. Arbetet stannar här före extern aktivering.
