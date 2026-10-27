# PCC — fortsättning till isolerad HTTP-/native-grind

> Uppföljning efter separat uttryckligt godkännande: backup/restore och det låsta
> PCC-paketet är genomförda i den befintliga isolerade testdatabasen.
> Se [faktisk migrations- och HTTP-rapport](project-control-isolated-result-2026-10-25.md).
> HTTP-grinden är BLOCKED av ett verifierat PostgREST 14/SQLSTATE 40001-problem;
> ingen ny korrigeringsmigration eller adapterdeployment är gjord.
> Texten nedan bevarar det ursprungliga granskningsläget före godkännandet.

2026-10-25. **LOKALT GRANSKNINGSPAKET FÖRBERETT; SERVERKÖRNING EJ GODKÄND/KÖRD.**

Fortsätter `project-control-center-2026-10-25.md`. De tidigare verifierade
funktionerna har inte byggts om. Ingen produktkod eller historisk migration
har ändrats i denna fortsättning. Användarens besked ”Fortsätt” används för
lokal förberedelse och läsande kontroller; separat godkännandefråga för faktisk
testmigration, testdatabasbackup och syntetiska testdata är fortfarande öppen.

## Ny faktisk verifiering

- Branch `feat/support-desk`, HEAD `dabecfe34e71a1ffc7e98fd1be6968a23fd91df2`.
- De 44 filerna från slutrapporten var byte-identiska vid återupptagandet;
  arbetsytan hade samma 162 dirty paths och tomt index. Endast denna BerryIT-
  chatt var aktiv i arbetsytan.
- Läsande SSH med befintlig identitet bekräftade `core-node-01` och exakt
  container `berryit-iso-83a2f62f-db`, databas `postgres`.
- Container-ID:
  `1ea52edd800810ecb1e48aa743a99ceaf95a09b3a3da45a4ae4fcd490722988b`.
- Exklusiv datavolym `berryit-iso-83a2f62f-db-data`; två skrivskyddade init-
  binds under `/home/glasso/berryit-iso-83a2f62f/`. Inga främmande mounts hittades.
- Read-only SQL gav exakt de 16 förväntade migrationsnamnen, befintligt
  Factory-schema, inga PCC-objekt eller kolliderande permissionnamn och noll
  andra aktiva klienttransaktioner vid kontrollögonblicket. Factory hade inga
  live-godkända adaptrar eller instanser med annat än MOCK.
- Ingen backup, DDL, NOTIFY, fixture, inloggning eller sessionändring har körts
  på servern. Läsande transaktioner avslutades med ROLLBACK.

## Konkret paket för granskning

Källa: `supabase/migrations/20261025112940_project_control_center.sql`.

Källans SHA-256:
`9e2e4dbc9c8ed3500b4fcb61fdd5d009e160dc2a2917052aff6badc619ea26f8`.

Lokalt, Git-ignorerat paket:

```
C:\projects\berryit\test-results\project-control-native-20261025\review-package\review.sql
C:\projects\berryit\test-results\project-control-native-20261025\review-package\manifest.json
```

Paketets SHA-256:
`c08045eae95672e46a97d8ec5e3f5f9308fbb06edecc597cde1884e0a0ea929e`.

`tests/project-control/isolated-review.mjs` verifierar källans och alla tidigare
migrationers hash mot det befintliga granskningsmanifestet. Det låser mål,
container-ID, databas, mounts, ledger och frånvaro av PCC-kollisioner. Verktyget
kan endast skapa ett nytt lokalt granskningspaket under `test-results`; det har
ingen nätverks-, SSH-, databas-, execution- eller cleanup-funktion. `--execute`
nekas. Manifestet anger alltid `REVIEW_ONLY_NOT_EXECUTED` och krav på mänskligt
godkännande. JSON-flaggor eller en källhash är inte ett sådant godkännande.

SQL-paketet återanvänder exakt den granskade migrationskroppen i en transaktion,
med `lock_timeout=5s`, `statement_timeout=60s` och advisory lock. Vid eventuell
senare körning kontrollerar SQL på nytt ledger, aktiva klienter, syntetisk
Factory-status, objekt- och permissionkollisioner före ändring. Efter DDL
registreras just migrationens namn och PostgREST får schema-reload-NOTIFY vid
COMMIT. Ingen omstart eller generell uppgraderingsfunktion ingår.

DDL-effekt: nio nya projekttabeller, 28 offentliga hjälpfunktioner/RPC:er med
avgränsade grants, privat taskbucket, tenant-/resurs-FK:er och åtta nya
permissions på de befintliga standardrollerna. Befintliga kund-, Auth-,
profil- och grantposter ska inte ändras eller raderas.

Före faktisk körning måste nod, container-ID/mounts, ledger, paket-/källhash,
andra operatörer och klientaktivitet kontrolleras färskt igen. Ett lokalt
sparat proof är en mätpunkt, inte bestående bevis för att ett senare mål är rätt.

## Backup och återställning före eventuell DDL

Backup är ett kvarstående förvillkor och har **inte** utförts.

1. Godkänn först det namngivna isolerade målet och endast dess syntetiska data.
2. Använd versionsmatchad `pg_dump -Fc` från just testcontainern. Ingen generell
   serverdump, produktionsfil eller annan produkts databas får ingå.
3. Lagra endast krypterad backup, med separat skyddat recoverymaterial och
   åtkomstskydd; inga nycklar, sessioner eller plaintextdump i Git eller rapport.
   Binär dump får inte passera en textkonverterande PowerShell-pipeline.
4. Verifiera krypterad fil/checksumma, dekryptering och arkivets läsbarhet innan
   DDL. Detta är ingen ersättning för produktionskravet på extern komplett
   backup och faktiskt verifierad restore.
5. Vid fel före COMMIT ska transaktionen rullas tillbaka. Efter lyckad COMMIT
   finns ingen automatisk DROP/DELETE eller restore. Stoppa vid verifieringsfel
   och ta fram en separat godkänd återställning; radera inga testkonton/data.

## Ytterligare konstaterat AI-beroende

Den befintliga isolerade AI-adaptern granskades genom enbart source-markör och
hash, utan att källkod eller env-värden skrevs ut:

```
projectControlContextSupported=false
sourceSha256=5be833bae09b4785f4987a8c6246b0ede4aa1aa116ec3affbf79ddf20dfac5da
```

Enbart databasmigrationen verifierar alltså inte nya tasks/historik genom AI.
Ingen container har ändrats eller startats om för att dölja detta beroende.
Föredragen testväg efter godkänd DDL är befintlig aktuell serveradapter som lokal
testprocess, verklig isolerad GoTrue/PostgREST och den befintliga syntetiska
Gatewayen genom låsta privata anslutningar. Om den kedjan inte kan bindas
säkert ska AI-delen förbli BLOCKED; en isolerad containeruppdatering skulle
kräva separat godkännande. Ingen produktionsinferens ingår.

Native använder därefter en separat testkopia och Credential Manager-
namnrymd. Befintlig installation/config/session ska bevaras. Verklig login,
TOTP, task-/projekt-/rollflöden, Storage-HTTP och återkallelse ska verifieras
innan native-PASS får rapporteras. Ingen ny Supabase-stack behövs.

## Lokala verifieringar i fortsättningen

`npm run test:project-control-review`: **18 PASS, 0 FAIL, 0 SKIP**.

Fall täcker produktion/okänd miljö, fel nod/container/databas, delad volym,
främmande/skrivbar bind, ledgeravvikelse, partiellt schema, permissionkollision,
live-Factory, aktiv annan klient, förbjuden execution-mode, sanerade CLI-fel,
outputgräns/överskrivning och transaktionskontroll. Själva paketet applicerades
en gång i ny syntetisk PGlite; ett nytt försök nekades utan ändrad ledger.
Permissionkollision nekades före DDL och rollback bevarade baslinjen.

Den första testkörningen påvisade att en ledger saknades i den nya testfixturen;
fixturen fick samma explicita ledger som motsvarande befintliga uppgraderingstest.
Spärren för verkligt saknad/fel ledger har inte försvagats.

Lint: PASS. Befintliga slutverifieringar återanvänds för oförändrad produktkod;
ingen onödig fullständig byggomgång har körts. De nya skyddstesterna är tillagda
i befintlig verifierings-CI, utan deploymentsteg.

Ändrade filer i denna fortsättning:

- `tests/project-control/isolated-review.mjs` (ny)
- `tests/project-control/isolated-review.test.mjs` (ny)
- `docs/project-control-isolated-gate-2026-10-25.md` (ny)
- `package.json` (ny testscriptpost)
- `.github/workflows/verify.yml` (ny säkerhetsgrind)

Ingen commit, push, merge, installation, servermigration eller deployment.
Verklig HTTP-/native-verifiering är fortsatt **BLOCKED_APPROVAL** och AI har
dessutom det namngivna adapterberoendet. Inväntar svar på den konkreta frågan
om testmigration, skyddad testdatabasbackup och syntetiska testdata.
