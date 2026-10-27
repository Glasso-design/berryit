# ONARLY Platform Factory — PASS 3A

2026-10-25. **Slutstatus: BLOCKED för verklig provisionering och produktionsbeslut.**
Detta är en faktisk anslutnings-/verifieringsrapport, inte ett körgodkännande.

## Sammanfattning

| Grind | Faktiskt resultat |
|---|---|
| Cloudflare real read-only | **BLOCKED_CREDENTIALS**;0 API-anrop. Inget påstående om att konton saknas |
| Account/R2/DNS/TLS/Email/quota-kontrakt | **86/86 LOCAL/MOCK/SYNTHETIC PASS**, oförändrad PASS2-kod |
| Ny GET-only-preflight | **3/3 SYNTHETIC PASS**, inklusive saknade credentials, Tenant-only och okänd credentialtyp |
| Befintlig Factory-browserregression | **1/1 SYNTHETIC PASS**, inte verklig Supabase-Factory-verifiering |
| Riktig befintlig GoTrue-login/TOTP | **PASS**, verklig isolerad HTTP; aal1→aal2 |
| Backend-MFA, JWT och aktuell session | **PASS** för körda negativa fall; ingen frontendauktorisering |
| Factory-ägarskap/Factory-RLS | **BLOCKED_SCHEMA**: Factory-schema/RPC:er saknas helt i teststacken |
| ONARLY-central identitet/SSO till QABGO | **BLOCKED_NOT_INTEGRATED**; BerryIT-testidentitet verifierad, inte central ONARLY-IdP |
| QABGO:s fyra appar via samma riktiga SSO-kedja | **BLOCKED**; sådan produktkomposition finns inte i den granskade godkända stacken |
| Extern krypterad backup/restore | **BLOCKED**; separat volym finns, men inget repository/aktiv mottagare/restorebevis |
| Factory-vyn mot verklig testbackend | **BLOCKED_SCHEMA**; status kan inte publiceras via saknade RPC:er |
| Produktionsläge | Fortsatt **MOCK/BLOCKED**; ingen live-aktivering |

## 1. Baslinje och filskydd

Repository C:\projects\berryit, origin Glasso-design/berryit,
branch feat/support-desk, oförändrad HEAD
`dabecfe34e71a1ffc7e98fd1be6968a23fd91df2`.
PASS2-rapport, manifest, README och faktisk implementation lästes.
Alla29 hashlistade PASS2-filer, PASS2-manifestet självt samt27 skyddade filer
bevarades. Dessutom bevarades hela startlägets110 modifierade/nya filer.
Ingen annan aktiv BerryIT-chatt identifierades i den avgränsade trådkontrollen;
inga andra agenters filer skrevs över och inga subagenter startades.

Inga historiska migrationer, tidigare rapporter, Windows-installationer,
konfigurationer eller Credential Manager-sessioner ändrades.

## 2. Cloudflare: vad som faktiskt granskades

Enbart metadata/variabelnamn granskades i processmiljön, BerryITs lokala
.env-filer, relevanta Windows Credential Manager-mål, standardplatser för
Wrangler/Cloudflare samt granskade serverreferenser på core/prod. På prod lästes
endast relevanta variabelnamn i BerryITs befintliga skyddade stack.env; inga
värden publicerades. Godkända Cloudflare-credentials kunde inte identifieras.
Andra produkters privata .env-filer eller personliga konton genomsöktes inte.
Detta bevisar inte att credentials saknas överallt utanför de granskade källorna.

Resultat: **BLOCKED_CREDENTIALS**, verification=NOT_RUN, apiRequests=0.
Inga Cloudflare GET-, POST-, PATCH-, PUT- eller DELETE-anrop gjordes.
Detta är inte REAL READ-ONLY PASS. Konto-ID:n, kontotyper, faktisk R2-, DNS-,
Email Routing- och Tenant-behörighet är därför **okända**.

| Behövd läsande åtkomst | Kvarvarande krav |
|---|---|
| Token | Godkänd server-/lokal secret-store-referens; korrekt user- eller account-owned verify-endpoint |
| Konto | Account Read/åtkomst till uttryckligt konto; eventuellt tillåten kontolista |
| R2 | Workers R2 Storage Read/list buckets inom valt konto |
| DNS | Zone Read och DNS Read inom godkända zoner |
| E-post | Email Routing Addresses Read och Routing Rules/inställningsläsning |
| Tenant | Endast om partnerfunktionen aktiverats: godkänd Tenant-identitet/key och unit/entitlement-verifiering |

Skicka inte token i chatten eller Git. Koppla en godkänd server-side secret
store eller tillhandahåll dess referens och avgränsade account/zone-scope.
Read success får senare inte likställas med write- eller provisioneringsrätt.
Dedikerat managed, limited standalone och managed-resource isolation är
implementerade modeller; **ingen är verifierad som tillgänglig för användarens
verkliga konto** i detta pass. Shared isolation kräver fortsatt explicit val.

### Nytt läsande verifieringsverktyg

services/platform-factory/preflight/cloudflare-readonly.mjs återanvänder
PASS2:s CloudflareApiClient. Transporten tillåter endast GET till fast
Cloudflare-origin, saknar mutationsväg och redigerar inte providerobjekt.
Den redovisar tokenmetadata, läskapabiliteter och blockerare utan råa
providersvar, kontonamn, mottagaradresser eller credentials. Den verifierar
inte write-behörighet eller kontoentitlement med gissningar.

run-readonly.mjs har explicit --mode=read-only, avgränsat lokalt output-path och
ger exit2 för credentialblockering. Detta beteende verifierades: exit2 och0
API-anrop. Nya tester omfattar även Tenant-only partial och fel credentialtyp.

Körning från projektroten:

```
node --test services/platform-factory/tests/preflight-readonly.test.mjs
node services/platform-factory/preflight/run-readonly.mjs --mode=read-only --output=test-results/platform-factory-pass3a-20261025/cloudflare-readonly.json
```

Verktyget läser endast uttryckliga Cloudflare-miljöreferenser och laddar inte
.env-filer automatiskt. Verkliga credentials ska tillföras säkert av operatören.

## 3. Verklig befintlig isolerad Auth-miljö

core-node-01 nåddes med befintlig strikt SSH/Tailscale. Den befintliga
berryit-iso-83a2f62f kör fortfarande sju containrar: DB, GoTrue, PostgREST,
Storage, gateway, AI-adapter och syntetisk Gateway. Inga containrar skapades,
startades, stoppades eller startades om. ID/state/starttid/restart count är
oförändrade efter kontrollen. DB/Auth/AI-adapter har healthy; övriga tillskrivs
ingen Docker-healthcheck som de saknar.

Den tidigare lokala tunneln lyssnade inte. En separat ägd SSH-forward till
127.0.0.1:18750 → core127.0.0.1:8750 öppnades. Gateway, Auth-health och
Storage-status gav200. Detta bevisar inte Storage-objekt-ACL.
Den egna nya tunneln avslutades efter testerna, med kontroll av exakt PID/
forwarding och att inga andra lokala testklienter använde den.

Det befintliga syntetiska testkontot och dess befintliga TOTP-faktor användes.
Ny separat testsession, persistSession=false, ingen Credential Manager eller
befintlig native-session. Varje körning loggade ut endast sin egen nya session.
Inga konton eller MFA-faktorer skapades/ändrades; inga lösenord, faktorsecrets,
access-/refresh-token eller test-e-postadresser loggades.

### Faktiska HTTP-resultat

10 kontroller PASS,0 FAIL,2 Factory-kontroller BLOCKED:

1. Riktig GoTrue-lösenordsinloggning ger aal1.
2. Avsiktligt felaktigt testlösenord nekas.
3. Backend nekar roles.manage vid aal1.
4. Befintlig TOTP-faktor verifieras och aktuell nivå blir aal2.
5. GoTrue getUser verifierar samma befintliga testidentitet.
6. support_access_context verifierar aktivt konto och Super Admin på servern.
7. Autentiserad läsning av befintliga syntetiska projekt fungerar.
8. Manipulerad JWT-identitet nekas med HTTP401.
9. Endast den nya testsessionen loggas ut.
10. Den gamla aal2-tokenens privilegierade behörighetskontroll blir false efter
    utloggningen, trots att JWT:n ännu har återstående giltighetstid.

Detta är **REAL ISOLATED HTTP PASS för dessa specifika fall**, inte ett
fullständigt PASS för Factory, kundisolering, SSO eller fyra produktappar.
Den verifierade användaren är en BerryIT-testidentitet; ingen oberoende central
ONARLY-IdP eller betrodd SSO-assertion verifierades.

### Exakt Factory-blockerare

En READ ONLY-SQL-kontroll i den befintliga testcontainern visar:

- factory-schema saknas,0 Factory-tabeller och0 Factory-RPC:er.
- Befintlig has_resource_permission finns och används av riktiga HTTP-anrop.
- factory_catalog ger PGRST202 både före och efter lyckad MFA.

PGRST202 är här **saknad funktion/schema**, inte bevis på att Factory-MFA eller
Factory-RLS nekar korrekt. Ägarskap, administrativa Factory-åtgärder, teknisk
checklistauktorisering och kundisolering för riktiga Factory-instanser kan
därför inte verifieras i denna stack ännu.

Ett separat besked begärdes om de två redan granskade, isolerade Factory-
migrationerna001/002 får appliceras endast här. Inget sådant godkännande
antogs. Inga migrationer eller schemaändringar kördes på core eller prod.
Samtliga tidigare30 PASS2-filer är fortsatt oförändrade.

### ONARLY/QABGO/SSO

Den granskade QABGO-koden har sin befintliga produktinloggning/sessioner.
Factory-fixturens onarly_profile_id→product_user_id är en profilreferens;
den implementerar ingen SSO-tokenväxling. En fungerande ONARLY→Factory→QABGO-
kedja med betrodd issuer, audience, replay- och återkallelsekontroll kunde
inte återfinnas i de granskade kopplingarna.

Den godkända BerryIT-stackens sju komponenter innehåller ingen QABGO-produkt-
runtime. Fyra QABGO-appar via denna riktiga SSO-kedja och åtkomstnekande mellan
deras kundinstanser är **BLOCKED**, inte PASS. PASS2:s tidigare separata lokala
PostgreSQL/password-login-tester är inte samma bevisning och upprepades inte
genom att skapa en ny miljö. Ingen ny stack, installation eller deployment gjordes.

## 4. Extern backup: aktuell observation

Tidigare rapporters installationsstatus återanvändes inte som aktuell sanning.
Läsande kontroller visar nu följande:

| Plats | Faktiskt läge |
|---|---|
| core | Restic0.16.4 och rest-server0.14.0 finns installerade |
| /srv/berryit-backup | Monterad ext4-LV,20 957 446 144 byte totalt (19,5GiB)/19 866 902 528 byte ledigt (18,5GiB),755 root:root |
| Volymens innehåll | Endast lost+found på granskad toppnivå; inget backuprepository |
| Mottagare | Ingen körande rest-server-process eller identifierad BerryIT-backupunit |
| prod | Restic/rest-server saknas i granskad PATH; inga identifierade BerryIT-backupconfig/units eller relevanta stack.env-referenser |
| Fysisk separation | core rapporterar Apple Macmini5,1; prod OpenStack Nova-VM. Separata värdar är verifierade; fysisk felzon/offsiteplacering måste fortfarande styrkas av operatören |

Destinationen är alltså **allokerad men inte verifierat användbar för backup**.
Append-only, begränsad writer/recovery-identitet, privata transporter, faktisk
krypterad repositoryåtkomst och återställning är inte verifierade.
Ingen produktionsbackup, dumpöverföring, installation, konfiguration, endpoint-
start eller restore gjordes. Det finns inget identifierat repository här att
återställa från. Tidigare syntetiska restoretester ersätter inte denna grind.

Kapaciteten måste dessutom bedömas mot10GB objekt per instans plus DB/config,
retention och tillväxt. Den cirka20GiB stora volymen är inte bevis på tillräcklig kapacitet för
flera kunder eller flera fullständiga återställningspunkter.

## 5. Factory-vyn

Den befintliga vyn och dess MOCK/BLOCKED-spärrar bevarades. Dess syntetiska
browserregression passerar och visar statuskälla/blockerare korrekt.
Den verkliga testbackendens saknade factory_catalog/factory_provider_status
hindrar publicering och visning av det nya riktiga preflightunderlaget där.
Det rapporteras som **BLOCKED_SCHEMA**, inte som en färdigkopplad live-vy.

pass3a-readiness.json innehåller ett redigerat aktuellt underlag för nästa
godkända publicering till testmiljön. Det är **inte** en publicerad DB-status
eller en deployment. Ingen syntetisk observation har märkts som verklig
provider-PASS och inga permissions har lagts i frontend.

## 6. Tester och lokala filer

| Kontroll | PASS3A-resultat |
|---|---|
| Befintlig Factory-provider-/quota-/retry-/isoleringstestsvit |86/86 PASS, LOCAL/MOCK/SYNTHETIC |
| Ny readonly-preflight |3/3 PASS, syntetisk transport |
| Befintlig Factory-browserregression |1/1 PASS, syntetisk RPC/SQL-fixture |
| Riktig isolerad GoTrue/MFA/HTTP |10 PASS,0 FAIL;2 Factory-delar BLOCKED_SCHEMA |
| Lint |PASS |
| Typecheck med Next typegen |PASS |
| Nya webb-/Desktop-/Rust-/installerarbyggen |Inte körda i PASS3A; inga UI-/installationskällor ändrades |
| Real Cloudflare |BLOCKED_CREDENTIALS,0 anrop |
| Full15-falls HTTP/MFA/SSO-grind |BLOCKED, får inte kallas färdig |
| Extern restore |BLOCKED, ej körd |

Nya versionshanterbara filer, inga befintliga ändrade:

- services/platform-factory/preflight/cloudflare-readonly.mjs
- services/platform-factory/preflight/run-readonly.mjs
- services/platform-factory/tests/preflight-readonly.test.mjs
- docs/platform-factory/pass3a-report-2026-10-25.md
- docs/platform-factory/pass3a-readiness.json
- docs/platform-factory/pass3a-delivery-manifest.json

Sanerade resultat/loggar och tillfälliga testhjälpare ligger Git-ignorerade i
test-results/platform-factory-pass3a-20261025. Inga credentials eller sessioner
ingår i leveransfilerna. Äldre seed-users.mjs/seed.mjs observerades som befintliga
på sin dokumenterade scratchpad-plats; **de lästes/kördes inte**, används inte av
dessa kontroller och ingår inte i leveransen.

## 7. Exakta återstående beslut före första verkliga QABGO

1. Godkänd Cloudflare secret-store-referens och avgränsade läsrättigheter för
   den verkliga preflighten. Verifiera account/zone-scope och faktisk Tenant- eller
   standalone-eligibility; shared isolation kräver separat uttryckligt val.
2. Besked om enbart Factory001/002 får installeras i den befintliga isolerade
   stacken. Därefter riktiga Factory-ägarskaps-, MFA-, administrativa RLS- och
   kundisoleringsprov och publicering av blockerarna i testvyn. Inget prod-DDL.
3. Separat godkänt färdigställande och isolerad verifiering av betrodd ONARLY-
   SSO, produktaktivering och QABGO:s fyra appar. Samma15-fallsgrind ska visa
   issuer/audience/replay/revocation och nekad åtkomst mellan kunder.
4. Behörig slutföring av den externa backupvägen: verifierad disk/felzon,
   kapacitet/retention, skyddat repository, append-only och separata writer/
   recoveryidentiteter/material. Därefter faktiskt syntetiskt restoreprov från
   den oberoende lagringen. Aktivera ingen produktionsbackup genom detta pass.
5. Separat godkännande av granskad produktionsschema-/worker-/brokerkomposition,
   begränsade Cloudflare-skrivpermissions, exakta resurser, budget och domän/
   mottagaråtgärder. Inga write-rättigheter följer av readonly-PASS.
6. En separat godkänd verklig provisioneringsresa med syntetisk kund innan
   live-status får införas. R2 signerade URL/CORS/header-skydd, EU-jurisdiktion,
   faktisk kvot/reconciliation, DNS/TLS/e-post, isolation och recovery ska bevisas.
   Därefter nytt uttryckligt produktionsbeslut och eventuell releasegodkänning.

Inget av ovanstående godkänns automatiskt av denna rapport.

## Git och stopp

Branch/HEAD oförändrade, inget staged, ingen commit eller push. Startlägets110
filer bevarade; sex nya leveransfiler ger116 modifierade/nya konkreta filer totalt.
Alla27 skyddade och30 PASS2-filer bevarade. Ingen produktionsändring, migration,
deployment, konto-/resursskapning, DNS-/e-poständring eller radering utfördes.
Arbetet stannar vid dessa verifierade blockerare och den öppna testmigrationgrinden.
