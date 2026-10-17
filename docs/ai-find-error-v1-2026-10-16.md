# Ask ONARLY AI — Sök felet V1, lokal verifiering

Bas: `feat/support-desk`, HEAD `0357a64e7d0284a30259cbf7b78b6c7a1e155b91`.
Datum: 2026-10-16. Tidigare 81 ocommittade filer bevarades; inget committades.

## Resultat

**Lokal implementation och körda isolerade tester: PASS.**
**Verklig ONARLY AI Gateway-inferens samt riktig Supabase Auth/HTTP/MFA: BLOCKED.**
Ingen verklig AI-fråga skickades. Inga serverändringar, installationer,
produktionsmigrationer, deployment, commit eller push utfördes.

## Befintlig kedja och konstaterade driftblockerare

1. Desktop `createAiClient` använder den konfigurerade backendadressen och
   användarens vanliga access-token. Native transport går genom befintlig
   Tauri HTTP-funktion; inga Gateway- eller administrativa nycklar behövs där.
2. Befintlig Caddy-konfiguration har `/ai/v1/*` till `ai-adapter:8788`.
3. Adaptern verifierar användaren mot BerryIT Auth och läser med samma JWT
   genom PostgREST/RLS. Endast svar och append-only audit använder servernyckel.
4. Befintlig `createOnarlyGateway` skickar serverautentiserad POST till `/chat`
   eller `/groq/chat`, med timeout, storleksgränser och utan redirects.
   Det finns ingen direkt providerfallback eller ny modellmotor.

En läsande kontroll av den tidigare lokala adressen
`http://127.0.0.1:8700/ai/v1/health` gav **HTTP 404** i vanlig Windows-kontext.
Det verifierar inte en fungerande adapterroute eller var denna lokala adress
för närvarande terminerar. Inga tunnlar skapades och inga servrar undersöktes.

`ONARLY_AI_GATEWAY_URL`, `ONARLY_AI_GATEWAY_TOKEN`,
`ONARLY_AI_GATEWAY_ROUTE` och `BERRYIT_AI_ADAPTER_IMAGE` var inte konfigurerade
i lokal process/`.env.local`. Serverns aktuella hemligheter inspekterades inte;
lokal avsaknad bevisar inte serverns konfiguration. Compose-profilen `onarly-ai`
är befintlig opt-in, inte en verifierad driftsatt adapter.

Gatewayindikatorn i Desktop säger nu **serverkonfigurerad — kontakt ej verifierad**.
`available` betyder endast att adapterkonfiguration finns. Ett healthsvar är
heller inget bevis på fungerande modellåtkomst eller providerbudget.

## Implementerat och återanvänt

- Befintlig Ask ONARLY AI har val av registrerat projekt och incident.
  Konversationen binds till organisation, projekt och valfri incident.
- `Sök felet för valt mål` skapar en vanlig befintlig AI-konversation.
  `Förhandsgranska underlag` hämtar endast databasens godkända projektion.
  Detta skickar ingenting till AI Gateway.
- Efter granskning krävs separat checkbox och knapp för att dela underlaget.
  Servern kräver `approvedForAi=true` samt ett eget engångs-ID bundet till
  aktör, konversation, SHA-256 av exakt underlag och fem minuters giltighet.
- Nästa anrop läser och auktoriserar underlaget igen. Ändrat underlag, återkallad
  behörighet, annan aktör, fel konversation, utgång eller återanvändning nekas.
  Vid flera adapterinstanser behöver förhandsgranskning och analys nå samma
  process. Annars nekas anropet säkert och ny förhandsgranskning krävs.
- Befintlig svarstruktur och `ai_messages` återanvänds. Observationerna kommer
  från databasen och visas med källa, tidpunkt och staleness. AI-genererade
  `verifiedFacts` tas bort i diagnostikläget, även om modellen anger ett känt
  käll-ID. Möjliga orsaker och rekommendationer är AI-bedömningar.
- Serverns lista över saknad information kan inte tas bort av modellen.
  En tydlig markering säger att ingen direkt serverundersökning har gjorts.
  Modelltextens slutsatser är inte ett bevis på en faktisk felorsak.
- Befintlig `Skapa supportärende` kräver separat bekräftelse. Samma `tickets`
  används, med projekt-ID samt konversations-/incidentreferens i metadata.
  Projektets DEVELOPER-roll ger ingen tickets.write. En separat giltig
  supporttilldelning krävs för att skapa ärendet.
- AI har inga endpoints eller verktyg för serverkommandon, kodskrivning,
  deployment, tjänstestart eller omstart. Rekommendationer utförs inte.
- Adapterns Dockerfile tar nu med den nya interna diagnostikmodulen.
  Ingen image byggdes eller publicerades; Docker saknas lokalt.

## Underlag och uttryckliga begränsningar

Allt hämtas ur befintliga tabeller. Ingen collector startas vid en AI-fråga.

| Underlag | Med i diagnostiken | Begränsning |
|---|---|---|
| Incidenter/felrapporter | Status, severity, observationsantal, godkänd metric_key, tid | Ingen fri titel, summary eller personuppgift skickas |
| Connector-status | Senaste status per tjänst, latency, källa, tid | Endast vald projekttjänst; ingen raw detail/config |
| Monitoring | Senaste tjänstemätvärden per metric, värde, källa och tid | Fast lista med nio befintliga mätvärdestyper |
| Incidenthistorik | Eventtyp, aktörstyp och tidpunkt | Inga aktörsnamn eller fria händelsetexter |
| Server-/applikationsloggar | Inte anslutna | Visas alltid som ej undersökta/saknade |
| Nodövergripande CPU/RAM/disk | Utelämnas | Delad nod kan innehålla andra projekt/kunder |

Underlaget begränsas uttryckligen till 20 incidenter, 30 tjänstestatusar,
50 senaste tjänstemätvärden och 20 händelser. Det påstås inte vara full historik.
Status utan mätning är okänd; föråldrade observationer bevisar inte nuläget.
Avsiktligt pausade tjänsters registrerade unknown-status får inte omtolkas som
ett verifierat fel. Prompten instruerar modellen om detta; ingen incident
skapas eller stängs automatiskt av AI.

Råloggar kräver ett separat godkänt, serverbaserat och projektsäkert kontrakt
för insamling och redigering innan de kan användas. Regex på fri loggtext är
inte grund för en garanti att hemligheter eller andra kunders data saknas.

## Backend, databas och ny framåtriktad migration

Ny fil: `supabase/migrations/20261016150000_ai_diagnostics.sql`.
Tidigare 15 migrationsfiler är oförändrade, inklusive föregående lokala
projekt-/rollmigration. Manifest: `docs/ai-find-error-migrations.json`.
Efter tidigare verifierade sex driftssteg finns nu åtta historiska steg och
två lokala tillägg att granska — **tio väntande steg**, inte applicerade här.
Supabase CLI saknas; migrationsfilen skapades lokalt utan installation och
verifierades i den fulla SQL-kedjan. Ingen migrationsmetadata skrevs till server.

- Ny serverdefinierad permission `ai.use` i samma befintliga rollregister.
  Standard ADMIN, IT SUPPORT, DEVELOPER och skyddad ägare får permissionen,
  endast inom respektive verkligt beviljat scope. Egna roller kan få den genom
  samma MFA-/delegeringsregler. Permissionen ger ingen generell infrastrukturläsning.
- Projektbaserad AI kräver både `ai.use` och `projects.read` i exakt projekt.
  Äldre allmänna organisationschattar behåller befintliga supportpermissions.
- AI-konversationers RLS stöder projektscope; meddelanden återanvänder dess
  kontroller. Projektkunskap får en restriktiv scopepolicy. Projektval ger
  inte rätt att läsa andra projekt eller deras supportärenden.
- Incident-ID får sammansatt tenant-FK och verifierad relation till projektet.
  Ändrad/inkonsekvent incident-/tjänstkoppling gör gammal konversation obehörig.
- SECURITY DEFINER används för den begränsade projektionen eftersom de breda
  infrastrukturtabellernas RLS avsiktligt inte ger en utvecklare generell läsning.
  Funktionerna kontrollerar aktuell faktisk anropare och grants, har låst tom
  search_path, kvalificerade relationer och explicita EXECUTE-rättigheter.
  Anon/PUBLIC saknar åtkomst till diagnostik-RPC:erna; privata hjälpare ligger
  i befintlig privat schema och kan inte anropas via exponerat PostgREST-schema.
- Befintlig ticket-guard bevaras i en framåtriktad ersättning. Endast undantaget
  för en AI-tekniker som registrerar sig själv utökas till verifierad
  tickets.write i exakt projekt. Det ger ingen rätt att välja annan kundidentitet.
- Befintlig audit registrerar uttrycklig diagnostikdelning med aktör, scope,
  request-ID, käll-ID och kontexthash. Varken tokens eller rått underlag loggas.
  Gatewayfel auditeras genom samma befintliga felväg. Saknad audit stoppar delning.

Funktions-/RLS-principerna kontrollerades mot
[Supabase funktioner](https://supabase.com/docs/guides/database/functions) och
[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Faktiska testresultat

| Kontroll | Resultat |
|---|---|
| Ny SQL/RLS + hela Desktop-browserresan → riktig adapterkod → syntetisk HTTP Gateway → supportärende | **2/2 PASS** |
| AI-adapter, preview, samtycke och negativa HTTP-tester | **14/14 PASS** |
| Befintlig AI-kundisolering direkt SQL/RLS | **11/11 PASS** |
| Full befintlig RLS/MFA/Communications/Monitoring/DESK-kedja | **272 PASS** |
| Projekt-/rollsäkerhet efter AI-migrationen | **40/40 PASS** |
| Historisk uppgradering + bevarad fixture | **29/29 PASS** |
| MFA-uppgradering/rollback | **22 PASS** |
| Security Repair | **22/22 PASS** |
| Testmiljöskydd | **5/5 PASS** |
| Samlad Connector/Monitoring/AI/Communications/pilot/repository/manifest-regression | **141/141 PASS** |
| Desktop-enhetstester | **138/138 PASS** |
| Befintlig support-/kundportalhelresa | **3/3 PASS** |
| Befintlig projekt-/rollbrowserresa, inklusive stor katalog | **2/2 PASS** |
| Lint, webbens och Desktops typecheck | PASS |
| Webpack-produktionsbygge | PASS |
| Desktop Vite + offline Tauri native release utan bundle | PASS |
| Verklig Supabase HTTP/Auth/Storage/MFA och verklig AI-inferens | **BLOCKED** |

Det simulerade felet innehåller tjänstestatus degraded och faktiskt registrerad
syntetisk cpu_percent=99. Browsern väljer mål och godkänner exakt underlag.
Testet verifierar CPU-hypotes, saknade loggar, källor och ett projektscopat
supportärende. Enbart DEVELOPER nekas ärendet; separat IT SUPPORT-grant tillåter
det. Främmande projekts tjänst, fri feltext och syntetisk privat token skickas inte.

Negativa tester täcker annan kund, syskonprojekt, fel incident, anonym RPC,
utgångna/återkallade grants, inaktivt konto, ändrad incidentkoppling, stale data,
förfalskat klientunderlag/roll, annan aktör, engångs-ID, expiry, omspelning,
ändrat underlag, saknad Gateway och falska AI-faktapåståenden.

Testerna använder nya minnesdatabaser, syntetiska identiteter och egna
loopback-portar. Browserns Auth och REST-transport är testfixturer; faktisk
PostgreSQL/RLS körs. Gateway är en syntetisk HTTP-server med befintligt
/chat-kontrakt — inget riktigt modellresultat hävdas. Ingen serverdata rensades.

Under arbetet hittade helresan ett RLS-fel vid INSERT RETURNING och ett äldre
AI-ticketundantag som saknade projektscope. Båda rättades och verifierades.
Testharnessens dubbla React, alias/TypeScript-kontext och cacheplacering rättades
utan att försvaga produktkontroller. Tidiga misslyckade försök ersätter inte de
redovisade slutkörningarna. Befintliga Zod PURE-/chunkstorleksvarningar kvarstår.

## Artefakt och nästa nödvändiga driftssteg

Native fil: `desktop/src-tauri/target/release/berryit-control-center.exe`.
SHA-256: `72ec98d8219a86e2e06e472202e53a3da2aa34dfebbaf11ff14cd7409d30a38e`.
Ingen installerare ersattes och appen installerades eller startades inte native.

1. Godkänn separat isolerad Supabase-stack på lämplig Linuxmiljö, med egen
   databas, egna portar och syntetiska användare. Verifiera riktiga JWT,
   PostgREST/RPC, Auth/MFA/Storage samt nya och befintliga klientflöden där.
2. Granska den totala migrationskedjan, befintliga breda legacy-grants,
   skyddad återställningsidentitet samt verifierad backup/restore före driftbeslut.
3. Verifiera avsedd backendadress, Caddy-route och adapterimage. Placera befintlig
   ONARLY URL/token i serverns skyddade konfiguration efter separat godkännande.
   Desktop får bara befintlig backendadress/publik nyckel/användarsession.
4. Godkänn ett syntetiskt verkligt Gatewayanrop och kontrollera modell-/provider-
   åtkomst, timeout, audit och svarskontrakt. Konfiguration/health räcker inte.
5. Godkänn därefter separat commit/push/CI och senare separat produktionsåtgärd.
   Ingen produktionsberedskap eller ändring på core-node-01/prod-node-01 hävdas.

## Arbetsyta

Exakta filer och slutkontroller bifogas nedan. Inga staged-filer eller commits.

- Slutlig branch: `feat/support-desk`.
- Slutlig HEAD: `0357a64e7d0284a30259cbf7b78b6c7a1e155b91`.
- 50 modifierade och 50 nya filer totalt, inklusive tidigare arbete. Inga staged-filer eller borttagningar.
- 74 av de tidigare 81 ändrade filerna är byte-oförändrade. 7 utökades avsiktligt för scripts, CI, navigation, migrationsmanifest och testisolering.
- De tidigare 15 migrationsfilerna är byte-oförändrade; aktuell 16-filsmanifestkontroll passerar.
- Lokal privat nyckels exakta värde kontrollerades mot 100 ändrade/nya filer och 85 publika byggfiler: inga träffar. Inga verkliga kunduppgifter tillfördes; testdata är syntetiska.
- `git diff --check`: PASS. Ingen GitHub CI-körning för opublicerad kod.

### Filer berörda i just Sök felet-passet

- `.github/workflows/verify.yml`
- `desktop/src/ai/DiagnosticPanel.tsx`
- `desktop/src/ai/client.ts`
- `desktop/src/views/OnarlyAi.tsx`
- `desktop/tests/ai-browser-main.tsx`
- `docs/ai-find-error-migrations.json`
- `docs/ai-find-error-v1-2026-10-16.md`
- `docs/onarly-ai-assistant.md`
- `package.json`
- `services/onarly-ai-adapter/Dockerfile`
- `services/onarly-ai-adapter/diagnostic-http.test.mjs`
- `services/onarly-ai-adapter/diagnostics.mjs`
- `services/onarly-ai-adapter/diagnostics.test.mjs`
- `services/onarly-ai-adapter/server.mjs`
- `shared/ai.ts`
- `shared/nav.ts`
- `supabase/migrations/20261016150000_ai_diagnostics.sql`
- `supabase/tests/master-upgrade.test.mjs`
- `supabase/tests/upgrade-plan.test.mjs`
- `supabase/upgrade-plan.mjs`
- `tests/access/workflow.spec.ts`
- `tests/ai/diagnostics.spec.ts`
- `tests/ai/index.html`
- `tests/ai/package.json`
- `tests/ai/playwright.config.ts`
- `tests/ai/run.mjs`

### Full arbetsytestatus (även tidigare pass)

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
 M desktop/src/ai/client.ts
 M desktop/src/auth/access.ts
 M desktop/src/auth/client.ts
 M desktop/src/auth/session.tsx
 M desktop/src/components/Shell.tsx
 M desktop/src/config.ts
 M desktop/src/registry/data.ts
 M desktop/src/views/Login.tsx
 M desktop/src/views/OnarlyAi.tsx
 M desktop/src/views/Projekt.tsx
 M desktop/src/views/Setup.tsx
 M desktop/tests/shared.test.ts
 M desktop/vite.config.ts
 M docs/connector-engine.md
 M docs/onarly-ai-assistant.md
 M package.json
 M services/connector-engine/adapters.mjs
 M services/connector-engine/agent-contract.mjs
 M services/connector-engine/contract.mjs
 M services/connector-engine/engine.mjs
 M services/onarly-ai-adapter/Dockerfile
 M services/onarly-ai-adapter/server.mjs
 M shared/ai.ts
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
?? desktop/src/ai/DiagnosticPanel.tsx
?? desktop/tests/ai-browser-main.tsx
?? desktop/tests/build-config.test.ts
?? desktop/tests/connection.test.ts
?? docs/ai-find-error-migrations.json
?? docs/ai-find-error-v1-2026-10-16.md
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
?? services/onarly-ai-adapter/diagnostic-http.test.mjs
?? services/onarly-ai-adapter/diagnostics.mjs
?? services/onarly-ai-adapter/diagnostics.test.mjs
?? shared/project-access.ts
?? shared/ui/ProjectAccessWorkspace.tsx
?? src/app/api/control/access/route.ts
?? src/app/api/control/repository/route.ts
?? src/components/control/ProjectAccessClient.tsx
?? supabase/migrations/20261016090000_project_access.sql
?? supabase/migrations/20261016150000_ai_diagnostics.sql
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
?? tests/ai/diagnostics.spec.ts
?? tests/ai/index.html
?? tests/ai/package.json
?? tests/ai/playwright.config.ts
?? tests/ai/run.mjs
?? tests/desktop/connection.spec.ts
?? tests/desktop/playwright.config.ts
```
