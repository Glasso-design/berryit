# BerryIT PASS 3A — production readiness

## Beslut: BLOCKED

Granskad källa: `dabecfe34e71a1ffc7e98fd1be6968a23fd91df2`, branch
`feat/support-desk`. Produktionsobservationer: 2026-10-17, cirka 21:50–22:00 UTC.
Detta är ett förberedelsepaket, **inte ett körgodkännande**.

Ingen produktionsfil, databasrad, containerkonfiguration eller tjänst ändrades.
Ingen migration, backup, restore, inferens, installation, commit eller push
kördes. SSH använde befintlig identitet och strikt värdnyckelkontroll.
SQL-sammanställningarna kördes i `BEGIN READ ONLY`; personuppgifter och
hemligheter publiceras inte. Andra servrar kontaktades inte.

## 1. Verifierad drift

BerryIT finns på `prod-node-01`, under
`/home/ubuntu/berryit-support/deploy/berryit-support`.

| Resurs | Observation |
|---|---|
| BerryIT DB/Auth/REST/Storage/gateway | Fem containrar running, restart count 0; DB och Auth healthy. Övriga tre saknar Docker-healthcheck och kallas därför inte healthy |
| Exponering | Bara gateway publicerar en värdport: `127.0.0.1:8700`; DB exponeras inte på värden |
| GET `/health` | HTTP 200 |
| GET `/auth/v1/health` | HTTP 200; signup avstängt, TOTP-flaggor aktiva |
| GET `/rest/v1/` | HTTP 200/OpenAPI; detta bevisar inte autentiserad RLS |
| GET `/storage/v1/status` | HTTP 200; detta bevisar inte upload/download/ACL |
| GET `/ai/v1/health` | HTTP 404 |
| ONARLY AI Gateway | `onarly-ai-gateway`, running/healthy, restart count 0; värdloopback `127.0.0.1:18780` till containerport 8080 |
| AI Gateway GET `/health` | HTTP 200, `status=ok`; ingen providerkontakt eller inferens verifierad |

Produktionens katalog innehåller sex migrationsfiler. Deras SHA-256 matchar
repositoryts sex basfiler byte för byte. En server-Git-HEAD kunde inte erhållas;
driftsatt version identifieras därför med ledger och filhashar, inte ett
antaget commitnummer. Ledgern innehåller inga historiska exekveringschecksummor.

## 2. Exakt orsak till saknad AI-route

Serverns Caddyfile innehåller Auth, REST, Storage, health och en avslutande
404-handler, men ingen `/ai/v1/*`-handler. Serverns Compose innehåller endast
de fem bastjänsterna och saknar `ai-adapter`. Följande fyra värden saknas i
BerryITs skyddade `secrets/stack.env`:

```text
BERRYIT_AI_ADAPTER_IMAGE
ONARLY_AI_GATEWAY_URL
ONARLY_AI_GATEWAY_TOKEN
ONARLY_AI_GATEWAY_ROUTE
```

404-svaret är alltså den befintliga gatewayens fallback, inte ett React-,
Auth- eller modellfel. Aktuell repositorykonfiguration innehåller tjänsten
och routen men är inte installerad på servern.

### Kontrakt kontrollerat mot driftsatt Gateway-kod

`/app/server.mjs` i den befintliga ONARLY-containern lästes utan att exekveras.
SHA-256: `1578d77195ddf51612dc89ccb3ea2ef093f4354ebd28dd36bc76f12b96720c45`.

| Kontrakt | Verifierat statiskt |
|---|---|
| Autentisering | `Authorization: Bearer <GATEWAY_API_KEY>`, jämförelse med timingSafeEqual |
| POST `/chat` | JSON `message`; svar använder `reply` och `model` |
| POST `/groq/chat` | JSON `message`; svar använder `answer` och `model`; separat från Project Brain |
| Project Brain | Separat villkor för `/projects/ask`; BerryITs adapter tillåter inte denna route |
| Providerkonfiguration | Gateway-, Gemini- och Groq-nycklar finns i containermiljön; inga värden lästes ut till rapporten |

Ingen POST till någon AI-route gjordes. Health bevisar inte giltig providerbudget,
modellåtkomst, databehandling, svarskvalitet eller fungerande inferens.
Gatewayen använder idag en gemensam servernyckel; någon separat verifierad
BerryIT-credential med egen gatewaykvot kunde inte styrkas.

### Transportgrind — måste lösas före aktivering

BerryIT ligger i `berryit-support-net`, AI Gateway i `ai_default`.
Värdens `127.0.0.1:18780` är inte adapterns loopback. Adaptern accepterar HTTPS,
eller HTTP endast till loopback, och endast en origin utan path/query/credentials.
`http://onarly-ai-gateway:8080` är därför inte en fungerande stödd inställning;
den ska inte användas och URL-valideringen ska inte försvagas som genväg.

Före GO krävs ett granskat transportbeslut med:

1. En verkligt nåbar HTTPS-origin från den avsedda adaptercontainern till
   befintlig ONARLY Gateway; giltig certifikatkedja och exakt godkänd origin.
2. En BerryIT-ägd transportkonfiguration om befintlig HTTPS-route saknas.
   Eventuell proxy-/nätverksändring som berör ONARLY kräver separat godkännande;
   sådana ändringar ingår inte i detta paket. Ingen ny modellplattform behövs.
3. GET-health genom samma nätväg och TLS-kontroller, utan provideranrop.
4. Godkänt server-side credentialbeslut, skyddad distribution och rotation,
   provider-/databehandlingsbeslut och loggning utan prompt-/tokenläckage.
5. En betrodd byggd adapterimage med registry-referens **och digest**, rätt
   Linuxarkitektur och granskning. `:local`-fallback får inte användas i drift.

Konfiguration som därefter behövs, men **inte utförts**:

- Installera granskad BerryIT-Compose med befintlig valfri `onarly-ai`-profil.
- Ange de fyra värdena ovan server-side. Routens värde måste vara `/chat`
  eller `/groq/chat`. Tokens får inte läggas i Desktop, Git eller byggargument.
- Installera den granskade BerryIT-Caddy-routen:

  ```caddyfile
  handle /ai/v1/* {
      reverse_proxy ai-adapter:8788
  }
  ```

  Prefixet ska bevaras. Befintliga Auth/REST/Storage-routes och loopbackbindning
  ska behållas. Aktivera inte routen före verifierad adapterhealth.
- Behåll användar-JWT till Auth/PostgREST, aktuell databasauktorisering,
  förhandsgranskning och uttryckligt samtycke före delning. Ingen automatisk
  inferens, åtgärd, kodskrivning eller omstart.

## 3. Migrationsordning och beroenden

Aktuell produktionsledger innehåller exakt dessa sex basmigrationer:

```text
20261013080000_platform_bootstrap.sql
20261013090000_support_desk_core.sql
20261013090100_support_desk_rls.sql
20261013090200_support_desk_storage.sql
20261013090300_support_authority.sql
20261013091000_support_authority_hardening.sql
```

De ska **inte köras om**. Exakt tio framåtriktade steg återstår:

| Ordning | Migration | Beroende/effekt |
|---:|---|---|
| 1 | `20261013110000_support_mfa_enforcement.sql` | Befintliga roller och riktiga GoTrue-sessioner; databas-MFA och live session |
| 2 | `20261013120000_onarly_ai_assistant.sql` | MFA; AI-konversationer och befintligt projektregister |
| 3 | `20261013130000_connector_engine.sql` | Projekt, permissions; system-/integrationsregister och incidents |
| 4 | `20261013140000_infrastructure_monitoring.sql` | Connectorregistrets noder/tjänster/incidenter |
| 5 | `20261013150000_communications.sql` | Tickets, organisationer, permissions och riktig Storage-grund |
| 6 | `20261014110000_onarly_desk_integration.sql` | Tickets, entitlements och scoped grants; konsultfält |
| 7 | `20261014190857_security_ci_repair.sql` | Communications, Storage; privata hjälpare och säkerhetsreparation |
| 8 | `20261014235633_complete_support_workflow.sql` | Privata hjälpare och konsultfält; samma kund-/ärendekärna |
| 9 | `20261016090000_project_access.sql` | Befintliga projekt/roller; dynamiska roller, projektscope, legacykonvertering |
| 10 | `20261016150000_ai_diagnostics.sql` | Projektpermissions, incidents och AI; godkänd diagnostikprojektion |

Hashar, predecessor, driftsbas och paketfiler finns i
`production-readiness-pass3a-manifest.json`. Historiska migrationer ändrades inte.
Planeringen avbryter vid okänd ledger, lucka, hashavvikelse eller annan bas.
Varje SQL-fil och dess ledgerpost ska committas i **samma** transaktion via
den granskade nya `migrate.sh`; hela tiostegskedjan är inte en enda transaktion.
Underhållsspärren ska därför ligga kvar mellan stegen och vid varje fel.

## 4. Aktuell behörighetsrisk och legacygrind

- En aktiv global `BERRYIT_SUPPORT_SUPER_ADMIN`-grant, utan sluttid, finns.
  Dess innehavare har en verifierad MFA-faktor. Den driftsatta SQL-funktionen
  kräver dock **inte** aal2; att faktorn finns är inte databasauktorisering.
- En aktiv legacy-teknikerprofil finns, och inga andra globala grants hittades.
  Projektmigrationens engångskonvertering skulle bevara dess breda åtkomst som
  global IT SUPPORT samt global `BERRYIT_LEGACY_INFRA_READ`.
- `active_support_grants(uuid)` är `SECURITY DEFINER`, har tom search_path,
  men är körbar av `anon` och saknar kontroll mot `auth.uid()` i funktionskroppen.
  Behörighetsinformationen kan därför exponeras för en caller som känner ett
  användar-ID. Den senare säkerhetsmigrationen och projektmigrationen behövs.
- Alla nuvarande public-tabeller har RLS, inklusive ledgern. RLS ensam
  kompenserar inte för en otillräckligt skyddad SECURITY DEFINER-funktion.

Före trafikåteröppning krävs dokumenterat ägarbeslut om de två berörda
identiteternas ändamål och scope, med skyddad ägaråterställning. Namn, e-post,
faktorhemligheter och råa användar-ID publiceras inte här.

Om teknikern inte ska vara global ska godkända organisations-/projektgrants
tilldelas genom skyddade, auditerade backendfunktioner efter migration 9 och
de automatiska globala kompatibilitetsgrantsen återkallas innan trafik öppnas.
Ingen profil-/JWT-manipulation och ingen ändring av historisk SQL ska användas.
Den skyddade ägargranten får inte tas bort som en bieffekt av denna granskning.

## 5. Backup och återställning: BLOCKED

I granskade BerryIT-sökvägar hittades endast dessa lokala filer, båda mode 0600:

- `backups/berryit-support-db-20261013T083332Z.dump`, 344 949 byte.
- `backups/berryit-support-storage-20261013T083332Z.tar.gz`, 743 byte.

Ingen verifierbar krypterad extern kopia, konfigurations-/secretbackup,
checksummanifest eller full restore-rapport hittades där. Inga BerryIT-jobb
hittades i läsbar ubuntu-crontab, root-crontab (ingen crontab), granskade
`/etc/cron.*` eller backuprelaterade systemd-timers. Andra produkters backupjobb
är inte bevis för BerryIT-backup och ändrades inte. Detta är en avgränsad
granskning; avsaknad här bevisar inte att någon okänd extern kopia är omöjlig.

Serverns gamla `backup.sh` har automatisk gallring. Gamla `restore-test.sh`
ignorerar pg_restore-fel. Gamla `security-gate.sh` har bred subject-baserad
DELETE och EXIT-cleanup; den är fortfarande **förbjuden att köra**.
SHA-256 är fortsatt `968563bc77e89744b336c4989048b6d8b10065ed74a877bb941568732f45ab18`.
Inget av dessa skript kördes. Nya granskade versioner finns i repo men är inte
installerade på servern.

För att stänga backupgrinden krävs:

1. Beslutat externt mål, krypteringsmottagare, åtkomst, retention, RPO och RTO.
   Dekrypterings-/återställningsbehörighet ska finnas även utanför prod-värden.
2. Ett godkänt skrivstopp/snapshot för enbart BerryIT, med dränerade anrop och
   pausade BerryIT-skrivare. DB, Storage och konfiguration ska representera
   samma dokumenterade återställningspunkt. Andra produkter får inte stoppas.
3. Full DB inklusive Auth/Storage-metadata, relevanta roller/grants och
   versionsuppgifter; faktiska Storage-filer; Compose/Caddy; nödvändiga
   serversecrets och JWT-/signeringskonfiguration. Ingen hemlighet i manifest.
4. Kryptering före extern överföring, restriktiva rättigheter och verifierade
   checksummor. Ingen automatisk gallring eller produktionsstädning.
5. Verklig återläsning från **den externa krypterade kopian** till separat
   godkänd, ägarmärkt miljö. Starta inte en sådan miljö i detta pass.
6. Kontrollera DB-restore-exit, constraints, RLS/ACL, riktig Auth/MFA,
   kunder/ärenden/audit, Storage-blobhashar och behöriga upload/download/signed
   URL-anrop. Dokumentera RPO/RTO och testtid. Befintligt restore-test mot en
   temporär DB i prod-containern är inte en full isolerad Supabase-restore.

DB-backup inkluderar inte själva Storage-objekten; se
[Supabase backupdokumentation](https://supabase.com/docs/guides/platform/backups).

## 6. Vercel och automatisk publicering: BLOCKED

GitHub har endast workflowet Verify och inga repository-webhooks. Verify
innehåller inga deploymentsteg. Den verifierade commitens CI är
[success](https://github.com/Glasso-design/berryit/actions/runs/39070377362).

Den oönskade deploymenten från 21:18 UTC skapades däremot av Vercels
GitHub App-integration: source `git`, branch `feat/support-desk`, target Preview,
state ERROR. Den är inte produktion. Vercels läsande projektanrop visar
BerryIT-projektet och den misslyckade deploymenten, men exponerar inte tillräcklig
aktuell konfiguration för att bevisa att automatiken nu är avstängd.
Browserkontrollen kunde inte upprättas (timeout). `live=false`, ingen ny
deployment eller ett misslyckat bygge är inte bevis för avstängd automation.

**Ingen Vercel-inställning ändrades.** Ett sådant steg vore en faktisk
driftinställningsändring, vilket detta pass förbjuder. Före nästa push krävs:

- Läsbar fullständig projektinställning/dashboardbevis för BerryIT, inklusive
  Git-koppling, deploymentregler och deploy hooks.
- Separat godkänd avstängning av endast BerryITs automatiska Git-deployments,
  alternativt en granskad `git.deploymentEnabled: false` för alla branches.
  Koppla inte från hela organisationens GitHub App och pausa inte webbplatsen.
- Kontrollera resultatet, behåll Verify och säkerställ att varken feature eller
  main får automatisk produktionsdeployment. Ingen testpush görs här.

En inaktiv konfigurationsskiss ligger i granskningspaketets `proposals/`;
den har inte lagts i repositoryroten eller aktiverats. Se
[Vercels officiella Git-konfiguration](https://vercel.com/docs/project-configuration/git-configuration).

## 7. Ytterligare releasegrindar

- **Next.js-server/API:** ingen Next.js Control Center-runtime finns i den
  granskade BerryIT-stacken. Skyddad kundregistrering och repository-API behöver
  beslutad privat runtime/URL, backendanslutning, server-only hemligheter och
  exakt `CONTROL_ALLOWED_ORIGINS`. Desktop får bara publik anslutningsprofil.
  Marknadswebbplatsen på Vercel är inte bevis för dessa privata API:er.
- **Desktoptransport:** befintlig personlig SSH-hjälp är inte en färdig
  hanterad anslutning för alla tekniker. Besluta stabil privat endpoint eller
  separat begränsad forward-only-identitet; distribuera inga SSH-nycklar eller
  service-role-värden i klienten. Ingen backend flyttas.
- **Beroenden:** föregående aktuella npm-audit visar Next 16.3.5 med kritiska
  advisories och kritiska Vitest/tinypool-varningar i utvecklingskedjan.
  Inga paket uppgraderades. Före publik Next-drift krävs riktad uppgradering
  och full regression, eller dokumenterad säkerhetsprövning av varje advisory.
  Utvecklingsberoenden ska inte beskrivas som installerade Desktop-runtimer.
- **Verklig tjänstegrind:** tidigare native WebView2-login/TOTP och avgränsade
  riktiga HTTP-scopekontroller är dokumenterade i native-rapporten. De är inte
  en full extern restore, fleranslutnings-/konkurrensgrind eller riktig AI-modell.
  Återstående fall i `project-access-http-gate.md` måste ha spårbara resultat.

## 8. Villkorad exekveringsordning — FÅR INTE KÖRAS NU

1. Stäng samtliga blockerare ovan; välj driftansvarig, ägare, fönster, scope,
   backup-/restorebevis och granskade image-digests. Kräv nytt uttryckligt
   produktionsgodkännande. Paketets `readyForProduction=false` ska inte ignoreras.
2. Verifiera åter hostname, rätt BerryIT-sökväg, fem befintliga container-ID,
   portbindning, volymer, filhashar och exakt sexposters ledger. Annan bas → STOPP.
3. Stagea endast granskat paket i ny versionsmärkt BerryIT-katalog. Ta
   metadata-bevarande, byteverifierade konfigurationsbackuper. Ingen direkt
   överskrivning, nyckelgenerering eller körning av gamla serverskript.
4. Lägg endast BerryIT i godkänt underhållsläge och skapa/verifiera den
   kompletta krypterade återställningspunkten enligt avsnitt 5.
5. Ersätt äldre driftverktyg med exakt granskade versioner efter hashkontroll.
   Isolerade testskript får fortfarande inte användas mot prod. Generisk
   `stack.sh up` ska inte användas som genväg eftersom den drar/startar hela stacken.
6. Applicera endast de tio saknade SQL-filerna i ordningen ovan via granskad
   transaktionsbunden migrator. Avbryt vid första fel; håll underhållsspärren.
   Kontrollera ledger efter varje steg och RLS/ACL efter säkerhetsstegen.
7. Genomför den godkända legacy-/scoperevisionen utan att förlora systemägaren.
   Begär separat PostgREST-schemaomläsning och verifiera RPC-kontrakten; en ny
   tabell/funktion får inte antas vara i API-cache bara för att SQL lyckades.
8. Konfigurera och starta endast BerryITs godkända adapterimage/transport.
   Verifiera intern `/ai/v1/health`, Auth/REST och Gateway GET-health över den
   faktiska TLS-nätvägen. Inget provideranrop i denna healthgrind.
9. Aktivera exakt BerryIT-Caddy-route efter verifierad upstream. Jämför alla
   övriga routes/portar/volymer och tjänsters starttider med före-bilden.
10. Kör godkända HTTP-/native acceptancefall: korrekt login/MFA, aktuella
    roller/revocation, kund-/projektscope, skyddade interna meddelanden/bilagor,
    projektadministration och audit. Ingen syntetisk seed/cleanup i produktion.
11. Första riktiga inferensen kräver eget uttryckligt godkännande och granskat
    syntetiskt underlag, förhandsgranskning och samtycke. Kontrollera verklig
    modell, svar, audit, saknat underlag och supportärendets separata bekräftelse.
12. Öppna trafik först efter dokumenterad PASS. Observera fel, tillgänglighet,
    audit, backupjobb och modellbudget. Vercels oönskade automation ska förbli av.

## 9. Rollback och stopp

Vid fel: håll BerryIT i underhållsläge och stoppa nästa fas. Ingen automatisk
down-migration, borttagning av volymer eller omstart av andra produkter.
En SQL-fil och ledgerpost återgår tillsammans vid transaktionsfel, men redan
committade tidigare steg återgår inte automatiskt.

Konfigurationsrollback ska använda exakt sparade Compose/Caddy/secrets och
godkända image-digests, endast för BerryIT. Ändrad AI-route kan återställas till
före-bilden. Efter migrerad databas räcker det **inte** att återställa Caddy.

Full rollback kräver den tidigare verifierade, sammanhängande DB+Storage+
Auth/konfigurationskopian. Återställ först till godkända nya BerryIT-ägda
återställningsresurser; bevara ursprungliga volymer och felande data. Växling
kräver operatörsbeslut och verifiering. Ingen dataradering eller automatisk
rollback-exekverare ingår i paketet. Återgång till det gamla osäkra schemat
innebär fortsatt trafikspärr, inte godkännande att öppna produktion.

## 10. Faktiskt verifierat i PASS 3A

| Kontroll | Resultat |
|---|---|
| SSH-värdidentitet, BerryIT-health och versionsmetadata | PASS, läsande |
| Ledger och sex basfilshashar mot repo | PASS, exakt 6; 10 saknas |
| Ny isolerad 6→16-uppgradering med syntetisk fixture | 29/29 PASS, PGlite; inte riktig Supabase HTTP |
| Manifest-/ordningsregressioner | 2/2 PASS |
| Kandidat-Compose på befintlig Compose 5.5.1 | Parse PASS; endast ai-adapter tillkommer; inga befintliga tjänst-, nätverks- eller volymskillnader |
| Kandidat-Caddy via `caddy adapt` och stdin | Parse PASS; ingen reload/provisionering |
| Tidigare full Verify på exakt source-HEAD | PASS, återläst från GitHub |
| Gateway health + statiskt Bearer/request/response-kontrakt | PASS; ingen inferens |
| Offsite/configbackup och full verklig restore | BLOCKED, inget verifierbart bevis |
| Produktions-MFA, nya RLS-/projekt-/AI-RPC:er | Ej uppgraderat; inget påstått drift-PASS |
| Säker nåbar AI-transport och betrodd adapterimage | BLOCKED |
| Vercel-automation bevisat avstängd | BLOCKED, inte styrkt och inte ändrad |
| Verklig modellinferens | Inte körd enligt instruktion |

Inledande metadatafrågor avbröts av lokala SQL-syntaxfel och korrigerades;
slutliga READ ONLY-frågor lyckades. Inga misslyckade försök räknas som PASS.

Lokala, ignorerade granskningsbevis och källpaket finns i `test-results/pass3a/`.
Endast denna rapport och manifestet är nya versionshanteringsbara filer.
Produktkod och historiska migrationer är oförändrade. Ingen commit eller push.
