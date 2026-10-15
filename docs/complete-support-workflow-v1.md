# Complete Support Workflow V1 — arbetsrapport

## Preflight och underlag, 2026-10-15

`C:\projects\berryit`, `feat/support-desk`, bas
`7ede001df5f0e31773670a45c1c358fe20def194`. Rent arbetsträd vid start.
Ingen annan aktiv BerryIT-chatt identifierades i samma worktree.
Master Integration Audit lästes som underlag i arbetskonversationen; någon
separat Master Audit-fil finns inte i repositoryt. Security & CI Repair-rapporten
`security-ci-repair-2026-10-14.md`, kärnmigrationerna, behörighetsmodellen och
befintliga Desktop-/portalvyer granskades före utveckling.

## Gap-matris före utveckling

| Steg | Befintligt som återanvänds | Verifierad lucka | Planerad ändring |
|---|---|---|---|
| Kund | `profiles`, nullable `organization_id`, `organizations`, Auth-trigger | UI listar bara företag; registrering saknas | Visa personer och företag, registrera via serverns Auth-admin med samma profiler |
| Skapa ärende | `tickets`, kategorier, referenstrigger, RLS | Båda vyerna är i huvudsak listor; scopad manuell registrering saknas | Delad formulär-/dataimplementation och framåtriktade scopekontroller |
| Detaljer | Beskrivning, kontaktfält, status och tidsstämplar finns | Ingen sammanhängande detaljvy | Delad detaljvy för Desktop och portal |
| Tilldelning | `assignee_id`, `support_role_grants`, ändringshistorik | Ingen validering av mottagarens aktuella rättighet | Kontrollera aktiv profil, scope, utgång och återkallelse i databasen |
| Felsökning | `ticket_messages`, `ticket_internal_notes` | Läsa/skriva saknas i UI | Separata kundmeddelanden och interna arbetsanteckningar |
| Bilagor | `ticket_attachments`, privat Storage, RLS | Uppladdning/läsning saknas; metadata behöver bindas till rätt ärende | Behörig uppladdning/läsning utan publika URL:er eller överskrivning |
| Löst/avslutat | `lost`/`stangt`, `resolved_at`/`closed_at`, triggers | UI saknas | Manuella åtgärder med uppdaterad historik |
| Återöppna | Öppna statusar och statuslogg | Ingen uttrycklig spårbar orsak | Databasåtgärd som loggar aktör och återöppningsorsak |
| Kundportal | Session, MFA, RLS och ärendelista | Samma luckor som Desktop | Samma tickets, klientkontrakt och UI-komponenter |
| Verifiering | RLS/MFA/Communications/AI/Desktop-sviter | Ingen helresa i faktiska ärendegränssnittet | Nya isolerade SQL-/klient-/browserflöden; inga delade databaser |

Privatkund fortsätter vara en kundprofil utan organisation. Inga fiktiva
företag, nya kundregister eller parallella ärendekärnor införs.
ONARLY DESK:s organisationsbundna rättigheter utökas inte i detta pass.

## Genomförande och verifiering

### Implementerat lokalt

- Desktop och kundportal monterar samma `SupportWorkspace` och
  `CustomerWorkspace`. Desktop använder befintlig användarsession direkt mot
  Supabase. Portalen behåller httpOnly-cookies och använder autentiserade
  Next.js-routes; ingen JWT görs läsbar i portalens JavaScript.
- Personer och företag visas i befintliga register. Nya privatpersoner får
  `profiles.organization_id = NULL`; företagskontakter använder en riktig
  organisation. `tickets` är fortsatt enda ärendekärnan.
- Enligt användarbeslut registreras nya personer utan aktiverad inloggning:
  serverns Auth-admin begär `email_confirm:false`, en lång kontospärr och ett
  slumpmässigt lösenord som aldrig returneras. Ingen inbjudan/e-post skickas.
  Befintligt konto väljs ur registret; ett duplicerat Auth-konto avvisas.
- Registrering kräver aktiv global administratör/superadmin och levande MFA2.
  Kontroll sker både före Auth-anropet och i Auth-triggerns transaktion.
  Kontext lagras i betrodd app-metadata, aldrig som behörighet i user-metadata.
  Återkallad registreringsbehörighet gör att den nya Auth-transaktionen avbryts.
- Ny kund kan väljas för manuell support omedelbart. Separat aktivering kräver
  ett senare behörigt administratörsingrepp i Auth: häv spärren, verifiera
  adress/ordna säkert lösenordsflöde och uppdatera
  `profiles.login_activation_pending=false`. Det finns ingen aktiveringsknapp
  eller automatisk aktivering i denna ändring.
- Ärendeskapande, detaljer, ansvarig tekniker, publika kundmeddelanden,
  append-only interna arbetsanteckningar, kundsynliga/interna bilagor,
  löst/avslutat och återöppning med obligatorisk kundsynlig orsak finns i UI.
  Historiken visar aktör, tid och återöppningsorsak. Interna uppgifter skrivs i
  separat arbetsanteckning.
- Teknikerlistan och databastriggern kontrollerar aktiv profil, befintlig roll,
  organisationsscope, utgång och återkallelse. Externa organisationsgrants ger
  ingen åtkomst till privata eller andra organisationers ärenden. Tidigare
  tilldelningar behålls som historik efter återkallelse men ger ingen ny rättighet.
  Befintligt MFA-undantag för vanligt ärendearbete behålls; administrativa
  åtgärder som kundregistrering kräver MFA2.
- Ärendets kundidentitet och originaluppgifter är oföränderliga. Manuella
  ärenden måste bindas till kundprofilens organisation. Befintligt AI/API-flöde
  där en behörig scopad tekniker själv är beställare är bevarat; detta tillåter
  inte att någon väljer ett godtyckligt kund-ID.
- Bilagans metadata registreras före objektet med slumpmässigt objektnamn.
  Sökväg, ärende och eventuellt meddelande binds i databasen. Objektet måste
  finnas innan servern markerar uppladdningen slutförd. Misslyckade uppladdningar
  lämnas öppet markerade och kan återupptas av samma uppladdare med samma fil.
  Ingen automatisk rensning eller överskrivning sker.
- Även historiskt felkopplade bilagerader begränsas av restriktiv RLS och
  kontroller i definer-RPC:er. Interna filnamn läcker inte via kundens
  ärendehistorik. Behörig nedladdningsbegäran loggas och använder privat
  Storage med 60 sekunders signed URL.
- Nya kund-/organisationsåtgärder, ärendeändringar, anteckningar och bilagor
  loggas i befintlig audit/historik. Privilegierade funktioner har låst
  `search_path`, identitets-/scopekontroll och uttryckliga EXECUTE-grants.
- HTTP-routes kontrollerar identitet, ursprung, schema och faktisk kroppsstorlek.
  Cookiebaserade skrivningar kräver exakt samma origin. Native Desktop använder
  Bearer; browserbaserad Desktop kräver uttrycklig CORS-origin. Service-role
  används endast i serverns kundregistrering efter behörighetskontrollen.
- Desktop har valfri Control Center-origin i befintlig konfiguration. Befintliga
  installationers konfigurationsformat är bakåtkompatibelt; ingen hemlighet
  införs i Desktop.

### Migration och testdata

Enda nya migrationen är
`supabase/migrations/20261014235633_complete_support_workflow.sql`, efter
`20261014190857_security_ci_repair.sql`. Inga historiska migrationer ändrades.
Nya fält: profilens aktiveringsmarkering/registrerande administratör, ärendets
återöppningsorsak och bilagans observerade uppladdningsslut. För befintliga
Storage-objekt registreras observationstid vid migrationen, inte en påhittad
ursprunglig uppladdningstid. Befintliga kunder, ärenden och objekt raderas inte.

Den syntetiska Auth-stubben fick `raw_app_meta_data`. En tidigare DESK-fixture
som felaktigt band organisation B:s ärende till organisation A:s beställare
rättades genom en separat syntetisk B-profil. Inga negativa assertions togs bort.
AI-testets befintliga kontrakt bevarades utan att ändra dess fixture.

### Testresultat, 2026-10-15

| Kontroll | Resultat |
|---|---|
| `npm run db:safety-test` | PASS, 5/5; okänd/produktion/extern DB och cleanup-argument stoppas |
| `security-gate-safety.test.sh` | PASS; endast mockar, ägda ID, felvägar, samtidighet och restore-kollision |
| `npm run db:test` | PASS, 271/271; samtliga 14 migrationer, 45 RLS-tabeller, 104 policies, 143 index |
| `npm run db:upgrade-test` | PASS, 22 kontroller av befintlig MFA-uppgradering/återställning |
| `npm run db:repair-test` | PASS, 22/22; Communications, scope, definer-ACL, Storage och återkallelse |
| `node supabase/tests/onarly_ai_assistant_test.mjs` | PASS, 11 kontroller |
| Connector Engine, Monitoring, email-adapter, AI-adapter | PASS, 102/102; inga verkliga leverantörsanrop |
| `npm test --prefix desktop` | PASS, 128/128 i 8 filer, inklusive 9 nya HTTP-/registrerings-/filtester |
| `npm run test:support-workflow` | PASS, 3/3 resor/sviter med verklig SQL/RLS och Chromium |
| Lint | PASS |
| Webb- och Desktop-typecheck | PASS |
| `npm run build` | PASS, Next.js 16.3.5 med dokumenterad Webpack-väg |
| `npm run build --prefix desktop` | PASS, TypeScript + Vite 7.3.7 |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib --locked --offline` | PASS, Rust kompilerad och 8/8 native tester |
| `git diff --check` och credential-granskning | PASS; inga historiska migrationsdiffar eller identifierade serverhemligheter i klientpaketen |

De tre nya isolerade sviterna verifierar:

1. SQL/den delade klienten: privatkund, organisationsisolering, manipulerade
   kund-/ärende-/bilage-/meddelande-/tekniker-ID, utgång och återkallelse,
   registrerings-MFA och förlorad administratörssession mellan kontroll och
   Auth-insert, ignorerad user-metadata-spoofing, interna anteckningar/filer och
   historik, ofullständig uppladdning, upprepad completion, audit med aktör,
   återöppningsorsak samt 405 historikrader med identisk tidsstämpel över flera
   sidor. Funktionsrättigheter och privata definer-hjälpare kontrolleras direkt.
2. Framåtmigration med redan befintlig syntetisk privatkund, stängt ärende,
   objekt och felkopplad bilagemetadata: inga rader försvinner; legitima objekt
   behålls och felkoppling blir otillgänglig. Återöppning fungerar efteråt.
3. Chromium: registrera privatkund → välj kund → skapa ärende → tilldela →
   kundmeddelande → intern åtgärdsanteckning → publik/intern fil → lös → stäng →
   återöppna → kundens svar → annan kund nekas även med manipulerat ärende-ID.
   Samma gemensamma UI monteras av de faktiska Desktop-/portalvyerna.

Testmiljön är en ny PGlite-instans i minnet per svit. Inga befintliga databaser
eller konton används. Browserharnessen får en egen ledig loopback-port med
`strictPort`, läser inga `.env`-filer och blockerar browsertrafik utanför loopback.
Testköraren kräver exakt `--environment=isolated-pglite` och vägrar extern
databaskonfiguration. Auth-identiteten och Storage HTTP ersätts av uttryckliga
testadaptrar; riktiga SQL-policyer, triggers, klientåtgärder och UI körs.

CI har fått samma versionsbundna Playwright-installation och nya testkommando.
GitHub Actions har inte körts för dessa opublicerade ändringar.

### Kvarstående risker och nästa grind

- **Hel tjänstekedja:** riktiga GoTrue-ban/aktivering, PostgREST-exponering,
  Next.js-sessionens cookie/bearer-transport samt Storage HTTP/signed URL måste
  fortfarande verifieras tillsammans på en ny isolerad Supabase-stack före
  produktionsbeslut. Den syntetiska harnessen bevisar inte leverantörstjänsterna.
  De separata HTTP-skydden och registreringsattributen har negativa enhetstester.
- **Signed URL:** redan utfärdad URL kan fungera till sin 60-sekundersutgång
  efter återkallad rättighet. Nya begäranden kontrolleras mot aktuella rättigheter.
- **Aktivering:** administrativ process för verifierad identitet, säker
  credential-hantering och aktivering måste beslutas före verklig kundregistrering.
  Ingen sådan process kördes här.
- **Privatkund/DESK:** manuellt ärendeflöde använder befintlig nullable modell.
  ONARLY DESK:s rättigheter/enheter är fortsatt organisationsbundna och kräver
  separat framtida databasbeslut för privatkunder. Inget parallellt kundregister.
- **Paket:** befintliga `npm audit`-träffar kvarstår: root 8 berörda paket
  (7 high, 1 critical), Desktop 3 (2 critical, 1 moderate). Se även tidigare
  Security & CI Repair-rapport. Endast versionsbunden Playwright och dess två
  paket tillkom; inga befintliga paketversioner uppgraderades. Separat granskad
  beroendereparation behövs före produktion.
- **Byggvarningar:** Desktop ger befintlig typ av Zod/Rollup-kommentarvarning
  och stor huvudchunk (~649 kB). Inga varningsgränser sänktes.
- **Drift:** serverns äldre security-gate, historiska scratchpad-skript,
  backup/restore och tidigare auditens driftfrågor är inte åtgärdade av detta
  pass. Ingen verklig cleanup, e-post, fjärrsession, migration eller deployment.
- **Distribution:** frontendens produktionspaket och Rust kompilerades/testades;
  ingen signerad Windows-installerare eller staging-/produktionsrelease skapades.

**Slutsats:** det avgränsade manuella supportflödet är implementerat och lokalt
verifierat. Produktionsberedskap och hela Supabase-tjänstekedjan är inte
godkända genom detta pass. Ingen commit eller push har gjorts. Inväntar separat
godkännande för publicering.

### Slutligt Git-läge

Branch `feat/support-desk`, HEAD oförändrad:
`7ede001df5f0e31773670a45c1c358fe20def194`.
19 modifierade och 20 nya filer, samtliga ocommittade och ostagade.
Ingen annan aktiv BerryIT-worktree-agent identifierades vid slutkontrollen.

```text
 M .env.example
 M .github/workflows/verify.yml
 M .gitignore
 M desktop/README.md
 M desktop/src-tauri/src/app_config.rs
 M desktop/src/config.ts
 M desktop/src/platform.ts
 M desktop/src/views/Installningar.tsx
 M desktop/src/views/Kunder.tsx
 M desktop/src/views/Setup.tsx
 M desktop/src/views/Support.tsx
 M desktop/src/vite-env.d.ts
 M package-lock.json
 M package.json
 M src/app/control/(shell)/kunder/page.tsx
 M src/app/control/(shell)/support/page.tsx
 M supabase/README.md
 M supabase/tests/local_bootstrap.sql
 M supabase/tests/support_desk_rls_test.sql
?? desktop/tests/support-workflow.test.ts
?? docs/complete-support-workflow-v1.md
?? shared/support-actions.ts
?? shared/support-http-policy.ts
?? shared/support-registration.ts
?? shared/support-workflow.ts
?? shared/ui/CustomerWorkspace.tsx
?? shared/ui/SupportWorkspace.tsx
?? src/app/api/control/customers/route.ts
?? src/app/api/control/support/route.ts
?? src/components/control/SupportClient.tsx
?? src/lib/support/http.ts
?? supabase/migrations/20261014235633_complete_support_workflow.sql
?? tests/support/database.ts
?? tests/support/index.html
?? tests/support/main.tsx
?? tests/support/package.json
?? tests/support/playwright.config.ts
?? tests/support/run.mjs
?? tests/support/workflow.spec.ts
```
