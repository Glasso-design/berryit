# Platform Factory — standardkvot 1 GB

Datum: 2026-10-25. **LOKAL VERIFIERING PASS**.

Ny standard för nya plattformar: **1 GB = 1 000 000 000 byte** (decimal GB).
Detta ersätter 10 GB som produktstandard i den lokala koden. Historiska
PASS-rapporter/manifester beskriver sina då faktiskt uppmätta 10 GB-instansvärden
och har inte skrivits om.

## Ändringen

- Ett gemensamt DEFAULT_STORAGE_QUOTA i shared/factory/schema.mjs används av
  serverns requestschema, Factory UI och produktadaptrar genom befintligt kontrakt.
- API-begäran utan storageQuotaBytes får exakt 1 000 000 000 byte före skyddad RPC.
- Factory-formuläret visar 1 GB som standard och tillåter fortsatt större kvot.
- QABGO-adaptern, installationsmallen och kvotchecklistans beskrivning är uppdaterade.
- Aktiv dokumentation, testfixtures, HTTP-testets förväntan och browserprovet
  använder den nya standarden. Kvotregressionen ingår i npm run test:factory.

Explicit större kvot är fortsatt tillåten inom tidigare gränser, upp till
1 000 000 000 000 byte. Standardvärdet är inte ett nytt maximalt lagringstak.
Ingen ny automatisk utökning eller driftåtgärd har införts; befintliga
godkännandeflöden och serverkontroller gäller fortsatt.

## Befintliga instanser och databas

Ingen migration behövs. factory.instances.quota_bytes är ett obligatoriskt
lagrat instansvärde utan kolumnstandard. factory_create kräver en fullständig
begäran med uttrycklig kvot; API-kontraktet fyller standarden innan RPC-anropet.
Varken tabeller, historiska migrationer, Factory-installations-SQL eller
brokerfunktioner har ändrats.

Ingen UPDATE/backfill, serveranslutning eller databasändring har utförts i detta
pass. Äldre klienter som uttryckligen anger 10 GB behandlas som en begäran om
den större kvoten enligt samma befintliga regler, inte som ett utelämnat värde.

Atomiska reservationer, multipart, reconciliation, isolering och varningar vid
80/90/100 procent använder fortfarande den faktiska instansens lagrade kvot.
Cloudflares delade gratisnivå/fakturering är separat; dokumentation och explicita
kostnadstester om 10 GB ändras inte till en per-instans gratisgaranti.

## Faktiskt verifierat

Nya default-quota.test.mjs körs endast i isolerad lokal PGlite och verifierar:

1. Samma decimalvärde i requestschema, serverkontrakt, adapter och mall/checklista.
2. Befintligt skyddat API-flöde med utelämnad kvot skapar en QABGO-instans där
   både SQL-raden och jobbets input innehåller exakt 1 000 000 000 byte.
3. Samma idempotency key återanvänder instansen.
4. Explicit 5 GB-instans kan fortfarande skapas.
5. 800/900/1 000 miljoner reserverade byte ger 80/90/100 procent; ytterligare
   en byte nekas utan övertrassering.
6. En äldre syntetisk 10 GB-instans med 2 GB reserverat är identisk i kvot,
   reservationer, input och audit efter nya skapanden och idempotent återanrop.

Browserprovet verifierar det faktiska förifyllda inputvärdet, förklarande text
och den skapade SQL-radens kvot. Ingen server-/produktionsinstans behövde ändras.

| Kommando/kontroll | Resultat |
|---|---|
| Riktat default-quota.test.mjs | 6/6 PASS, inklusive föräldertest |
| npm run test:factory | 92/92 PASS, inklusive de sex nya kontrollerna |
| npm run test:factory-ui | 1/1 PASS, verklig browserrendering med lokal syntetisk SQL-fixture |
| npm test --prefix desktop | 149/149 PASS, inklusive en React-runtime i produktionsbundle |
| npm run lint | PASS, exit 0 |
| npm run typecheck | PASS efter Next typegen, exit 0 |
| npm run build | PASS, dokumenterad Next.js Webpack-väg |
| npm run build --prefix desktop | PASS, tsc + Vite-webbundle; ingen installerare byggd |
| git diff --check | PASS |

Första typecheck-körningen fann unknown-typen i den nya browser-testassertionen.
Den rättades genom att läsa/konvertera SQL-resultatet inom den befintliga typade
async-låsningen. Typecheck och browserprovet kördes om och passerade; inga
assertions eller spärrar togs bort. Ursprunglig logg är bevarad.

Oförändrade icke-blockerande byggvarningar om Zod-kommentarer och bundle över
500 kB kvarstår. Desktop-negativtesten loggar avsiktligt nekad konfiguration;
samtliga 149 assertions passerar. Ingen beroendeuppgradering har gjorts.

Riktiga Supabase HTTP/MFA-, Cloudflare- och native WebView2-prov kördes inte om
för denna lokala standardändring. Tidigare PASS 3A-blockerare för SSO, extern
backup/restore och verklig provideraktivering kvarstår.

## Ändrade filer och arbetsyta

Tolv befintliga arbetsfiler ändrades endast för denna kvotändring:

- shared/factory/schema.mjs och schema.d.mts
- shared/ui/FactoryWorkspace.tsx
- services/platform-factory/contract.mjs
- services/platform-factory/adapters/qabgo.mjs och qabgo.template.json
- services/platform-factory/tests/fixture.mjs, run.mjs och existing-isolated-http.mjs
- tests/factory/workflow.spec.ts
- services/platform-factory/README.md
- docs/platform-factory/pass2-providers.md

Tre nya filer:

- services/platform-factory/tests/default-quota.test.mjs
- docs/platform-factory/default-quota-1gb-2026-10-25.md
- docs/platform-factory/default-quota-1gb-manifest.json

Startlägets övriga 111 av 123 modifierade/nya konkreta arbetsfiler är
SHA-256-identiska. De tolv avsedda ändringarna har granskats mot separata
före-kopior; tidigare ocommittat innehåll bevaras. Totalt finns 126 modifierade/
nya konkreta filer, index är tom och HEAD är oförändrad på feat/support-desk:
dabecfe34e71a1ffc7e98fd1be6968a23fd91df2.

Manifestet anger före-/efterhashar och testunderlag. Alla loggar ligger
Git-ignorerade i test-results/platform-factory-quota-1gb-20261025.
Ingen produktionsändring, migration, deployment, Git-commit eller push.
