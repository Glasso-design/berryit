# PASS 3A — isolerad Factory-schemagrind, fortsättning

Datum: 2026-10-25. Status: **LOKAL KORRIGERING TESTAD; SERVERÄNDRING EJ GODKÄND/KÖRD**.
Detta kompletterar pass3a-report-2026-10-25.md. Tidigare rapport/manifester
och samtliga 27 skyddade samt 30 PASS 2-filer lämnas byte-identiska.

## Nytt verifierat beroendefel

En riktad läsande kontroll via befintlig SSH verifierade:

- Host core-node-01; Compose-projekt berryit-iso-83a2f62f.
- Befintlig container berryit-iso-83a2f62f-db, databas postgres.
- Container-ID: 1ea52edd800810ecb1e48aa743a99ceaf95a09b3a3da45a4ae4fcd490722988b.
- Starttid: 2026-10-17T08:40:43.648814484Z.
- Factory-schema saknas; factory_broker-roll saknas.
- public.has_resource_permission(text,uuid,uuid) finns.
- pgcrypto ligger i extensions; extensions.digest(text,text) finns.
- public.digest(text,text) saknas; pg_catalog.sha256(bytea) finns.

002_provider_broker.sql använder public.digest i två brokerfunktioner.
Det skulle ge SQLSTATE 42883 vid användning i denna Supabase-installation.
Tidigare fixture hade pgcrypto i public och upptäckte därför inte felet.
Tidigare 86/86 PASS bevisar inte kompatibilitet med denna extensionplacering.

## Lokal framåtriktad korrigering

Ny review-SQL: services/platform-factory/preflight/broker-hash-compatibility.sql.
Den ligger utanför produktionsmigrationskedjan, precis som Factory 001/002.
Den ersätter endast hashuttrycket i factory_broker_reserve och
factory_broker_upload med pg_catalog.sha256(pg_catalog.convert_to(...,'UTF8')).
Detta motsvarar befintlig SHA-256 för UTF-8-hemligheten.

CREATE OR REPLACE behåller ägare, EXECUTE-ACL och tom search_path.
Ingen extension flyttas; ingen public.digest-alias skapas; inga permissions,
tabeller, befintliga konton eller roller ändras av korrigeringen.
Den kräver explicit isolated-test-markör och befintliga brokerfunktioner.
Varken den eller 001/002 har körts på servern.

## Konkret granskningspaket — inväntar uttryckligt godkännande

Enda avsedda mål är containern/databasen ovan. Ingen produktionsadress,
ny stack, containeromstart, provideraktivering eller QABGO-deployment ingår.
Ett sammansatt lokalt review-paket finns i:

`test-results/platform-factory-pass3a-20261025/isolated-factory-review.sql`

SHA-256: `4405959248600b1dd3f50d72645d825cc94fcd77f11205487d5227ecaee04fed`.
Det är Git-ignorerat och har inte skickats till servern.

Ordning och källhashar:

| Ordning | Fil | SHA-256 |
|---|---|---|
| 1 | services/platform-factory/db/001_factory.sql | 35d7b8de6a84336b1b34dc7d5b3fec201f1e28dd3f2ecab0de796b82b6f24830 |
| 2 | services/platform-factory/db/002_provider_broker.sql | 8318d1b9a7b330e69ccee7ca64b314e0e155fd31630e8b1fe467df5eef5de2bc |
| 3 | services/platform-factory/preflight/broker-hash-compatibility.sql | a982cc863507088a996e0d079bfa85ed48eee039cf121133d5852c8989adaba3 |

Paketet sammanför exakt dessa källor i en transaktion och tar endast bort
deras yttre BEGIN/COMMIT. Det lägger till advisory lock, lock_timeout 5s,
statement_timeout 60s och explicit isolated-test-markör. Det vägrar befintligt
Factory-schema/brokerroll och skickar PostgREST schema-reload-NOTIFY vid commit.
Ingen processomstart ingår.

### Kontroll före eventuell senare körning

1. Inhämta uttryckligt godkännande för just dessa tre isolerade schemaåtgärder.
2. Kontrollera åter branch/HEAD, källhashar och pakethash.
3. Verifiera serverns nodnamn, exakt container-ID, Compose-projekt och stackrot
   /home/glasso/berryit-iso-83a2f62f; verifiera att inga produktionsvolymer/databaser
   används. En SQL-miljömarkör ensam bevisar inte isolering.
4. Kontrollera att inga andra testoperatörer/sessioner använder databasen.
   Stoppa vid annan aktivitet, målavvikelse, existerande Factory-schema/roll,
   nya funktioner med kolliderande namn eller oväntade beroenden.
5. Granska hela paketet mot de tre källfilerna. Kontrollera även faktisk
   public/auth-schema- och service_role-kompatibilitet före DDL.
6. Kör först efter dessa grindar med psql ON_ERROR_STOP och endast namngiven
   container. Ingen generell körväg mot valfri databas tillhandahålls här.
7. Bekräfta tomt Factory-register, RLS, funktionernas ägare/search_path/ACL,
   MOCK-only/live_approved=false och uppdaterad PostgREST-schema-cache.
8. Registrering av en granskad lokal produktkatalog, nya syntetiska Factory-
   instanser och eventuell providerstatus är separata testfixtures som måste
   ingå uttryckligt i samma senare godkända testpass. Migrationerna ensamma
   skapar ingen katalog, produkt, instans eller verklig anslutning.

001 lägger till fyra MFA-krävande Factory-permissions till befintliga
ADMIN/SUPER_ADMIN-definitioner i TESTDATABASEN. 002 skapar en NOLOGIN-brokerroll
med endast två RPC-rättigheter. Detta är faktiska behörighetseffekter i test,
inte enbart en UI-installation. Befintligt backend-scope fortsätter gälla.

### Återställningsgrind

Fel före COMMIT ska avbryta hela transaktionen; detta är lokalt verifierat
med injicerat sent fel. Inga automatiska DROP/DELETE-, konto- eller
volymrensningar tillhandahålls. Efter lyckad commit lämnas testdata kvar.
En eventuell återställning efter commit kräver separat granskad plan och
godkännande; kör inte 001/002 igen och försök inte automatisk destruktiv rollback.
Om schemat redan finns ska nästa operatör stoppa och utreda dess status.

## Faktiska lokala kontroller

Reproduktion av kompatibilitetstestet:

```
node services/platform-factory/tests/broker-hash-compatibility.test.mjs --environment=isolated-pglite
```

8/8 PASS: ursprungligt 42883-fel, spärr vid okänd miljö, exakt två ändrade
hashuttryck, bevarade ägare/ACL/search_path, nekade klient-/service_role-anrop,
fel hemlighet/tenant/bindning, UTF-8-autentisering och läsning av upload,
främmande subject, kundisolering, kvot samt återkallad bindning.
All data är syntetisk i en ny PGlite-instans i processen.

Det exakta sammanfogade paketet kontrollerades dessutom mot separat lokal
PGlite med samma extensions-layout: sent injicerat fel rullar tillbaka schema,
roll och permissions; komplett paket kompilerar; upprepad körning vägras utan
att ta bort installerade data. Tre kontroller PASS. Detta är **inte** server-HTTP.

| Omsprungen kontroll i denna fortsättning | Resultat |
|---|---|
| Factory-provider/quota/retry/isolering | 86/86 PASS, LOCAL/MOCK/SYNTHETIC |
| Ny kompatibilitetsregression | 8/8 PASS, isolerad lokal PGlite |
| Exakt sammanfogat SQL-paket | 3/3 kontroller PASS, isolerad lokal PGlite |
| Lint | PASS, exit 0 |
| Next typegen + TypeScript | PASS, exit 0 |
| Nya server-HTTP/MFA/SSO-prov | Ej körda; tidigare GoTrue/MFA-resultat kvarstår |

Första Factory-omkörningen i nätverksbegränsad sandbox gav 75/86 PASS och
11 fel i loopback-HTTP-sviterna. Samma oförändrade svit kördes därefter med
tillåten lokal nätverksåtkomst och gav 86/86 PASS, exit 0. Inga timeouts,
assertions eller säkerhetsspärrar försvagades. Loggar för båda körningar är
bevarade under test-results/platform-factory-pass3a-20261025.

Den nya regressionen körs med sitt separata kommando ovan; befintligt
PASS 2-testkommando/runner ändrades inte. Ingen ny webb-/Desktop-bundle
behövdes eller byggdes för denna SQL-/test-/dokumentationsändring.

## Kvarvarande grindar

- Isolerat Factory-schema/ägarskap/RLS över verklig HTTP: BLOCKED_APPROVAL.
- Cloudflare: fortsatt BLOCKED_CREDENTIALS, inga nya provideranrop.
- Central ONARLY-identitet och QABGO:s fyra appars SSO: fortsatt BLOCKED.
- Oberoende krypterat backuprepository och faktisk extern restore: fortsatt BLOCKED.
- Factory-vyn ska fortsatt visa MOCK/BLOCKED. Ingen provider-PASS publiceras.

Denna fortsättning ändrar inga produktionsmigrationer, servrar eller tidigare
PASS 2-filer. Ingen installation, deployment, commit eller push har gjorts.
