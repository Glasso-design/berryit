# Desktop React crash — lokal verifiering 2026-10-17

Branch: `feat/support-desk`. HEAD: `0357a64e7d0284a30259cbf7b78b6c7a1e155b91`.
De 100 tidigare ocommittade filerna inventerades och hashades före ändring.
Ingen annan aktiv BerryIT-chatt identifierades. Ingen commit eller push.

## Rotorsak och minsta korrigering

Desktop löste React till `desktop/node_modules/react`, medan hook-komponenterna
i `shared/ui` löste till projektrotens `node_modules/react`. Båda var 19.2.8,
men de var två separata instanser. ReactDOM använde Desktop-instansen och
de delade komponenternas hooks anropade den andra instansens tomma dispatcher.

Felet återskapades före ombyggnad genom att rendera den verkliga befintliga
produktionsbundlen, logga in genom appens ordinarie komponenter med syntetiska
HTTP-svar och navigera till Kunder:

`Cannot read properties of null (reading 'useState')`.

Produktändringen är en enda rad i `desktop/vite.config.ts`:

```ts
dedupe: ["react", "react-dom"],
```

Alias, beroenden, versionsnummer, behörigheter, autentisering, databas och UI-
funktioner ändrades inte. Vite får nu lösa båda paketen från Desktop-roten,
även för delade komponenter och deras JSX-runtime. Detta följer
[Vite 7:s dokumenterade dedupe-kontrakt](https://v7.vite.dev/config/shared-options#resolve-dedupe).

## Verifiering i verklig produktionsbundle

Det nya bundletestet kör den befintliga produktionskonfigurationen genom Vites
riktiga byggpipeline, utan att skriva över byggartefakterna, och granskar dess
genererade modulträd. Det är inte en kontroll av enbart konfigurationssträngen.

| Kontroll | Före | Efter |
|---|---|---|
| React production-runtime | 2 separata filer | 1, från desktop/node_modules |
| ReactDOM production-renderer | 1 | 1, från desktop/node_modules |
| React / ReactDOM | 19.2.8 / 19.2.8 | 19.2.8 / 19.2.8 |
| Kunder i befintlig production-JS | Krasch, null/useState | Renderar med kundlista/formulär |

Kunder, Projekt och Support Desk finns alla i det kontrollerade modulträdet.
Det kräver inte att projektrotens React avinstalleras; webbappen behåller sin
befintliga installation. Avgörande är instansen i Desktop-bundlen.

## Riktig applikationsrendering

Playwright serverar `desktop/dist` direkt, inte en Vite dev-server eller en
ersatt komponent. Ordinarie `App`, `SessionProvider`, Supabase-klient,
inloggningsformulär, MFA-formulär, navigationsskal och vyer körs oförändrade.

Varje modul får en ny browserkontext utan sparad session: kallstart → login →
MFA-utmaning → Dashboard → vald modul → Dashboard → vald modul → Dashboard.
Backendens HTTP-svar och JWT är syntetiska; alla andra nätverksdestinationer
blockeras. Detta är inte en riktig GoTrue/MFA-verifiering eller native WebView2.

| Modul | Faktiskt verifierat efter korrigering |
|---|---|
| Kunder | Kundlista, formulär och två navigationsvarv |
| Projekt | Projektregister med syntetiskt projekt och två navigationsvarv |
| Support Desk | Ärendelista, öppna ärendedetaljer och två navigationsvarv |
| Dashboard | Översikt efter kallstart/inloggning och återgång från modul |
| Integrationer | Befintlig registervy renderar och kan lämnas/öppnas igen |
| Monitoring | Befintlig vy renderar med tomt syntetiskt mätunderlag |
| Ask ONARLY AI | Befintlig vy renderar; Gateway visas som ej ansluten |

Alla sju moduler hade noll pageerror/hook-fel och noll oväntade nätverksanrop.
Inga ändringar, meddelanden eller AI-frågor skickades till en verklig backend.
Skärmbilder och fel-/nätverksevidens finns lokalt i `test-results/desktop-react`.
De visar syntetisk data och är inte bevis för fungerande produktionsanslutningar.

## Testresultat

| Kommando/kontroll | Resultat |
|---|---|
| Nytt test av produktionsmodulträdet före fix | FAIL som avsett: två React-runtimes |
| Produktionsrendering före ombyggnad | FAIL som avsett: null/useState i Kunder |
| Desktop-enheter inklusive nytt bundletest | **139/139 PASS** |
| Byggd produktionsfrontend: 7 renderingstester + 3 anslutningsregressioner | **10/10 PASS** |
| Full befintlig SQL/RLS/MFA/Communications/Monitoring/DESK-regression | **272 PASS** |
| Befintlig isolerad Support Desk-/kundportalresa | **3/3 PASS** |
| Lint | PASS |
| Webbens typecheck | PASS |
| Desktops typecheck och Vite-produktionsbygge | PASS |
| Windows native + NSIS, befintlig verktygscache och offline/locked Cargo | PASS, byggexit 0; inget installerat |
| Befintlig isolerad Supabase HTTP/MFA-miljö | **BLOCKED**, preflight exit 2: ingen användbar lokal Docker CLI/context |

Support Desk-testets tidiga selektorer korrigerades till den befintliga
tabellens cell, ärendereferens och kombinerade rubrik. Det var testselektorer,
inte produktfel efter dedupe. Inga produktkontroller försvagades för att få PASS.
Befintliga Zod PURE-/chunkstorleksvarningar kvarstår; inga paket uppgraderades.

## Ändrade filer i detta pass

- `desktop/vite.config.ts` — enda produktändringen, React/ReactDOM dedupe.
- `desktop/tests/react-bundle.test.ts` — nytt test av verkligt produktionsmodulträd.
- `tests/desktop/render.spec.ts` — ny rendering av den byggda hela appen.
- `tests/desktop/playwright.config.ts` — befintlig Desktop-testkörning omfattar även rendering.
- Denna rapport.

## Begränsningar och stoppunkt

Ingen ny testmiljö eller utvecklingsverktyg installerades. Ingen native app
eller installerare kördes, så befintlig installation, verklig session och
Windows Credential Manager lämnades orörda. Native Windows/WebView2 med riktig
inloggning/MFA återstår när en redan godkänd isolerad backend finns tillgänglig.
Produktionsbackendens tidigare migrations-/anslutningsblockerare löses inte av
React-korrigeringen. AI/monitoring visas inte som fungerande anslutningar på
grundval av renderingstesterna.

Ingen ändring i behörighetsregler, SQL, produktionsserver eller kunddata.
Ingen migration, deployment, commit eller push. Arbetet stannar efter lokal
verifiering; installation och publicering kräver separat beslut.

## Slutliga artefakter och git-status

Ny installerare: `desktop/dist-installer/BerryIT-Control-Center-Setup.exe`.
Native program: `desktop/src-tauri/target/release/berryit-control-center.exe`.
Installerarens byggkälla är
`desktop/src-tauri/target/release/bundle/nsis/BERRYiT Control Center_0.1.1_x64-setup.exe`.
Ingen app eller installerare kördes. Versionsnumret är oförändrat 0.1.1;
denna lokala artefakt identifieras därför även med hash och byggdatum.

Den tidigare installeraren är bevarad byte-identiskt som
`desktop/dist-installer/BerryIT-Control-Center-Setup.pre-react-fix-20261017.exe`,
SHA-256 `537fd6f3e7881962ce2465ec248b574d7d12740ccfa28b7d76f298dd7c0f4329`.
Den gamla installeraren innehåller inte denna fix.


### Sluthashar

- Installerare: `dc5d6f39393edc25262bfbc8786c7f6d2e08ba849caa1fee3aaf6e3c787b9036`.
- Native EXE: `4cb811bd84af3e4a227797a0d3b6be9f3bb060e2f85e71c381c90fdbd0123570`.
- Testad och paketerad frontend `index-B5e8tfpq.js`: `e5b9c3b0975c059363df0c85a631f83c64f3ac8605d3584471b99c1ff97fa48e`.

### Slutlig arbetsyta

- 50 modifierade och 53 nya filer, inklusive tidigare arbete.
- 98 av 100 tidigare ändrade filer är byte-oförändrade; endast de två uttryckligen angivna konfigurationsfilerna utökades.
- Hashjämförelse bekräftar exakt en tillagd produktkonfigurationsrad. Inga SQL-/behörighetsfiler ändrades.
- Kontrollen av den lokala privata nyckelns exakta värde mot 103 ändrade/nya filer och 5 publika Desktop-byggfiler gav inga träffar.
- Rent index; ingen commit/push. HEAD oförändrad. `git diff --check`: PASS.

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
?? desktop/tests/react-bundle.test.ts
?? docs/ai-find-error-migrations.json
?? docs/ai-find-error-v1-2026-10-16.md
?? docs/desktop-connection-repair-2026-10-16.md
?? docs/desktop-react-crash-fix-2026-10-17.md
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
?? tests/desktop/render.spec.ts
```
