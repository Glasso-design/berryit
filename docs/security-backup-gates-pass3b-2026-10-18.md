# BerryIT PASS 3B — Security & Backup Gates

## Beslut och omfattning

| Grind | Beslut | Underlag |
|---|---|---|
| Lokal säkerhetskorrigering | GO för separat granskning/godkännande | Isolerad hotfix och regression gröna; inte applicerad i drift |
| Produktionssäkerhet | BLOCKED | Anonym grant-/ranginformation kan fortfarande nås; MFA-/legacy-/scopeuppgradering återstår |
| Krypterad extern backup och full restore | BLOCKED | Användaren: **ingen destination beslutad**. Credentials, mottagare, recovery-åtkomst och full restore saknas |
| Vercel Preview-avstängning | BLOCKED | Tillgängligt läsande projektanrop ger inte aktuell Git-deploymentkonfiguration |
| Produktionsuppgradering | BLOCKED | Säkerhet, backup, legacy-scope, Vercel och PASS 3A:s transport-/runtimegrindar återstår |

Källa: `dabecfe34e71a1ffc7e98fd1be6968a23fd91df2`, `feat/support-desk`,
`C:\projects\berryit`. PASS 3A-rapport och manifest återanvändes; ingen full
serverinventering upprepades. Ny granskning av helper/ledger/backups avgränsades
till BerryIT på prod-node-01 med befintlig SSH-identitet och strikt hostkontroll.
SQL kördes i READ ONLY-transaktioner. Inga andra servrar kontaktades i detta pass.

Ingen hotfix, migration, deployment, omstart, AI-inferens, produktionsbackup,
datakopia, installation, commit eller push kördes. **Kravet på helt oförändrat
produktionsfilsystem bröts dock av GPG enligt avsnittet nedan.**

## 1. Avvikelse från skrivskydd — GPG

En avsedd verktygs-/nyckellistning med `gpg --list-keys` initierade automatiskt:

```text
/home/ubuntu/.gnupg/              mode 0700
/home/ubuntu/.gnupg/pubring.kbx   mode 0600
/home/ubuntu/.gnupg/trustdb.gpg   mode 0600
```

Observation: 2026-10-17 22:15:47.948 UTC, dvs 2026-10-18 00:15:47.948 CEST.
Inga nycklar skapades; publik nyckelräkning var noll. Det är tomma GPG-
administrationsfiler, **inte** en ny backupnyckel eller krypterad backup.
Ingen BerryIT-konfiguration, databas eller tjänst ändrades av kommandot.

Avvikelsen rapporterades direkt. Ingen fil togs bort eller återställdes på
servern; eventuell hantering kräver separat uttryckligt godkännande. Inga fler
GPG-kommandon kördes där. Den lokala syntetiska verifieringen använder alltid
explicit ny homedir och berör inte användarens ordinarie nyckelring.

## 2. Exakt anonym åtkomst

Produktionens ledger är fortfarande exakt PASS 3A:s sex basmigrationer.
`active_support_grants(uuid)` har samma funktionskropp som motsvarande basfil:
body-MD5 `7046b3ef55adcf0b7ec7a454d43c106c`.

| Kontroll | Faktiskt resultat |
|---|---|
| SECURITY DEFINER / search_path | Ja / tom |
| anon EXECUTE | Ja, otillräckligt begränsad ACL |
| Identitetskontroll | Saknas; argumentet p_user väljer användaren |
| Returnerade kolumner | `role_key`, `scope`, `organization_id` för ej utgångna/återkallade grants |
| Wrapper | `max_support_rank(uuid)` tillåter anon och härleder rang från samma grants |
| Exponering | Gateway på värdens 127.0.0.1:8700; offentlig internetexponering har inte bevisats. Privilegieläckan finns ändå för en caller med nätväg till RPC:n |

**Säkert HTTP-bevis:** utan Authorization och utan apikey kördes HEAD mot ett
befintligt ID valt endast i serverprocessens minne. Ingen identitet eller
grantpayload skrevs ut. Helpern och varje projektion av de tre kontraktskolumnerna
gav 200, Content-Range `0-0/1`. Rank-wrappern gav också 200 utan nedladdat värde.
Projektion av `email`, `expires_at`, `granted_by`, `id` gav 400 eftersom dessa
inte är helperns returkolumner. Enda GET-resultatet var `[]` för ett fast,
icke-existerande syntetiskt UUID.

Bedömning: **hög prioritet före release**, informationsläckage om annan användares
behörighet och organisationskoppling vid känt UUID, inklusive ranginferens.
Ingen parameterlös lista över alla användare, ingen direkt credential-/PII-kolumn
och inget bevis för att just denna läs-RPC ensam ger skrivbehörighet. RLS på
granttabellen skyddar inte mot en otillräckligt skyddad SECURITY DEFINER-helper.

## 3. Förberedd minsta korrigering

Filer: `deploy/berryit-support/hotfixes/active-support-grants/`.

- `apply.sql`: samma caller-/profilkontroll som senare granskad Security & CI-
  migration, plus stängd PUBLIC/anon EXECUTE på **både helper och rank-wrapper**.
  Egen lookup behålls, andra användares lookup blir tom; betrodd intern SQL och
  serverns service_role behålls. Aktuell inaktivitet/expiry/revocation kontrolleras.
- Oförändrat funktionskontrakt, SECURITY DEFINER och tom search_path. Ingen ny
  permission, rollmodell, profiländring, grantändring eller ledgerpost.
- Endast exakt sexposters ledger och granskad gammal/identisk hotfixkropp accepteras.
  Annan bas eller definition → transaktionsavbrott. Timeout skyddar mot lång låsning.
- Audit med åtgärd, change-ID och basversionantal; inga grant-/credentialvärden.
- `containment.sql`: separat godkänd fail-closed fallback. Återställer aldrig
  den läckande gamla kroppen/anon-ACL. Kan blockera direkta autentiserade RPC:er;
  intern ägarväg fungerar fortfarande och är inte en generell trafikspärr.
- README innehåller exakt operatörsgrind, skyddad före-bild, HTTP-efterkontroll,
  beroenden och återställningsplan. Inget har applicerats i produktion.

Live-/källberoenden: `has_support_permission`, `is_support_super_admin`,
`max_support_rank` → grant-trigger, RLS för ärenden/anteckningar/bilagor och
audit. Test verifierar befintligt scope, ägartilldelning och återkallelse samt
hela hotfix → tio senare migrationer. Nyare projekthelper får inte nedgraderas.
Detta reparerar inte övriga kvarstående brister i den gamla sexmigrationsbasen.

## 4. Legacygrants — exakt avgränsning

| Granskningsreferens | Nuvarande fakta | Åtgärd före trafik efter uppgradering |
|---|---|---|
| `grant-5de4163dfd` | En aktiv global `BERRYIT_SUPPORT_SUPER_ADMIN`, utan sluttid; skyddad ägargrant | Bevara återställningsväg och verifiera avsedd ägare/MFA. Ingen automatisk återkallelse |
| `user-3f25628ba4` | En aktiv legacyprofil `technician`, **noll faktiska globala teknikergrants idag** | Besluta minsta organisation/projekt och giltighet. Migration 9 skulle skapa två globala kompatibilitetsgrants enligt nedan |

De två **prospektiva**, för breda tilldelningarna är:

1. `BERRYIT_SUPPORT_TECHNICIAN` (etikett IT SUPPORT), global.
2. `BERRYIT_LEGACY_INFRA_READ`, global.

Exakt målorganisation/projekt och sluttid har inte beslutats; detta är en
kvarstående behörighetsgrind. Före trafiköppning efter migration 9: verifiera
konverteringens faktiska grant-ID i skyddad administrativ session; skapa bara
godkända begränsade ersättningar via `grant_support_role`, och återkalla exakt
de två globala kompatibilitetsgrantsen via `revoke_support_role`. Kräver live
aal2 och administratör med rätt att delegera i scope, anledning och audit.
Om ingen ersättningsåtkomst godkänts ska den inte uppfinnas. Kontrollera att
gammal session nekas utanför nytt scope och att ägaråterställning fungerar.
Ingen historisk migration eller profilmetadata ändras som genväg.

## 5. Backupbeslut och förberedd procedur

Användaren har uttryckligen svarat: **ingen destination beslutad — BLOCKED**.
Ingen destination valdes, ingen ny credential efterfrågades eller skapades.

Återanvänd tidigare verktygsfynd: GPG finns; restic/borg/rclone/age hittades inte.
DB-containerns befintliga PostgreSQL-verktyg ingår i den framtida planen; ingen
installation gjordes. Ingen befintlig GPG-mottagarnyckel kunde styrkas.
Endast två tidigare lokala backupfiler bekräftades, 344 949 respektive 743 byte,
mode 0600. Inga bevis för aktuell extern/configbackup eller full restore.

`deploy/berryit-support/backup-gate/README.md` anger:

- Beslut om separat destination/region/feldomän, upload-only-identitet,
  separat återläsningsidentitet, mottagare/recoveryförvaring, signerare,
  kapacitet, retention och faktiska RPO/RTO-mål.
- Sammanhängande DB + globals/ägarskap + Auth/Storage-metadata + Storage-filer +
  Compose/Caddy/secrets/signering/digests under dokumenterat BerryIT-skrivstopp.
- Skyddad staging, GPG med explicit homedir, fulla fingerprints, kryptering
  före extern överföring, SHA-256, autentiserad signatur och faktisk återläsning.
- Separat ny restoremiljö, kontrollerade roller/versioner, pg_restore med
  felstopp, arkiv-/filhashkontroll samt riktiga Auth/MFA/PostgREST/Storage-
  acceptancefall. Ingen produktionsdatakopia utan separat godkännande.
- Ingen implicit gallring, EXIT-delete, volymrensning eller restore över
  befintlig data. Misslyckade körningar bevaras skyddat. Rensning kräver separat
  explicit kör-ID, ägarskapsbevis, fillista och godkännande.

Lokalt testat: PGlite-bas/fixture → snapshot + syntetiskt Storage-objekt +
konfig + manifest → tar → GPG-kryptering/signatur → lokal offsite**simulering**
→ verifiering/dekryptering → ny skyddad katalog → ny PGlite → rader/audit/RLS/ACL
och filreferenser. GPG-nycklarna är enbart syntetiska, ligger under testets egen
ACL och har aldrig kopierats till någon server eller Git.

**Ej verifierat:** riktigt pg_dump/pg_restore-format, oberoende extern transport,
restore med separat extern credential/nyckelförvaring, full Supabase-stack,
verklig GoTrue/TOTP och Storage-HTTP på återställd instans. Dessa är BLOCKED;
PGlite-snapshot är inte en PostgreSQL-dump och lokal katalog är inte offsite.
Databasbackup innehåller inte Storage-objekten; se
[Supabase backupdokumentation](https://supabase.com/docs/guides/platform/backups).

## 6. Vercel — återläsning kan inte styrka avstängning

BerryIT-projektet lästes åter via befintlig connector. Svaret innehåller
projektmetadata och tidigare misslyckad preview, men inte den aktuella
Git-kopplingen, deploymentEnabled-reglerna eller deploy hooks. `live=false`
och en misslyckad deployment bevisar inte att automatiken är avstängd.
Tillgänglig CLI saknas; tidigare browserkontroll gav timeout. Inga inställningar
ändrades och ingen testpush gjordes.

Nästa grind kräver läsbart dashboard-/fullständigt API-bevis för just BerryIT:
Gitkoppling, alla branchregler och hooks. Om avstängning inte kan styrkas krävs
separat godkännande att stänga endast BerryITs oönskade Git-deployments och sedan
läsa tillbaka resultatet. En granskad `git.deploymentEnabled: false` kan stänga
automatisk Git-publicering för alla branches; den är inte aktiverad här. Deploy
hooks/manuell publicering behöver granskas separat. Se
[Vercels officiella Git-konfiguration](https://vercel.com/docs/project-configuration/git-configuration).
GitHub Verify är oförändrat och har inga deploymentsteg enligt PASS 3A.

## 7. Faktiska lokala testresultat

| Kommando/kontroll | Resultat |
|---|---|
| `node supabase/tests/active-grants-hotfix.test.mjs --environment=isolated-pglite` | **21/21 PASS**, inklusive överordnat test; exakt bas, anon/wrapper, own/foreign, expiry/revoke/inactive, scope, grant/audit, eskalering, drift, 6→hotfix→16 och fallback |
| `node deploy/berryit-support/backup-gate/synthetic-restore.test.mjs --environment=isolated-pglite` | **10/10 PASS**, inklusive överordnat test; kryptering/signatur, negativa fil-/keyfall, DB/fil/konfig-restore |
| `npm run db:test` | **272 säkerhetskontroller PASS, 0 fel**: RLS, MFA, Support Desk, Communications och ONARLY DESK |
| `npm run db:repair-test` | **22/22 PASS**: Communications/Storage, identitet och isolering |
| `npm run db:master-upgrade-test` | **29/29 PASS**: kvarvarande migrationer, fixturebevarande, MFA/permissions, pilotregister |
| `npm run db:access-test` | **40/40 PASS**: projekt, dynamiska roller, scope och återkallelse |
| `npm run db:safety-test` | **5/5 PASS**: fel/okänd/productionklassad miljö, extern databas och cleanup-argument nekas |
| ESLint på båda nya testfilerna | PASS, exit 0 |
| `npm run typecheck` i befintlig arbetsyta | **FAIL**, exit 2: äldre ignorerad kopia `test-results/secure-push/clean-source` tas med av rotens glob och saknar egna beroenden/alias |
| Samma tsc med tillfällig source-konfig under ignorerad testkatalog | PASS, exit 0. Samma strict-/typeinställningar; enbart genererade `test-results` utesluts utöver befintliga excludes. Next typegen lyckades |
| Historiska migrationer, tracked diff och `git diff --check` | Oförändrade / tom / PASS |
| Riktig HTTP efter hotfix och full extern Supabase-restore | BLOCKED; hotfix inte applicerad och ingen godkänd restoremiljö/destination |

Inledande lokala försök föll på en felaktigt daterad syntetisk expiryfixture,
MSYS-sökväg och för lång GPG-agentsocket samt en felaktig testförväntan om anon
SELECT (korrekt resultat är permission denied). Testfixturer/harness rättades;
slutresultaten ovan kördes därefter. Inga databasconstraints eller produktens
behörighetsregler försvagades. Det råa typecheck-felet redovisas separat;
projektets tsconfig ändrades inte. Inga webb-/Desktop-byggen kördes om i PASS 3B,
eftersom ingen UI-/runtime-/beroendekod ändrades. Tidigare build/CI-bevis finns
i PASS 3A och räknas inte som nya PASS 3B-körningar.

## 8. Exakt återstående körplan och stoppgrindar

1. **Beslut:** destination/region, separata write/read-credentials, krypterings-
   mottagare/recovery/signerare, retention/RPO/RTO och godkänd restoremiljö.
   Besluta också legacyteknikerns exakta scope/giltighet. Inga hemligheter i chatten.
2. **Isolerad verklig repetition:** godkänn separat mål; kör full pg_dump/restore-
   procedur med syntetisk fixture, riktig extern återläsning, Auth/MFA,
   PostgREST/RLS och Storage-HTTP. Inga proddata kopieras som bieffekt.
3. **Vercel:** läs full konfiguration; separat godkänd avstängning vid behov och
   återläs bevis. Ingen push före stängd automationsgrind.
4. **Säkerhetshotfix:** separat godkännande; strikt verifierad sexmigrationsbas,
   skyddad/krypterad före-bild, granskade filhashar, transaktion, ACL-/audit-
   återläsning och riktiga HTTP-efterkontroller enligt hotfixens README. Vid
   avvikelse håll spärren och använd bara separat godkänd fail-closed fallback.
5. **Full produktionsåterställningspunkt:** separat godkänt BerryIT-skrivstopp;
   DB+Storage+konfiguration krypteras, kopieras externt och återläses/verifieras
   till godkänt mål. Verkliga proddata på testmål kräver uttryckligt tillstånd.
6. **Uppgraderingsgodkännande:** uppdatera granskat leveransmanifest med godkänd
   hotfix som utombandsändring. PASS 3A:s exakta tio migrationer körs i ordning,
   varje SQL+ledger atomiskt; historiska sex körs inte om. Okänd ledger/hash → STOPP.
7. **Legacygrind:** efter migration 9, före trafik, verifiera och ersätt/återkalla
   exakt de två globala teknikerkompatibilitetsgrantsen enligt ägarbeslut. MFA,
   audit och nekad åtkomst i gammal session krävs; skyddad ägargrant bevaras.
8. **Återstående PASS 3A:** besluta privat Next-runtime/endpoint, klienttransport,
   säkert nåbar HTTPS till befintlig AI Gateway, servercredential och betrodd
   adapterimage/digest. Lös riktade beroendevarningar separat; inga genvägar.
9. **Acceptance/öppning:** full riktig HTTP/native verifiering och behörighets-
   regression innan trafik. Första verkliga inferens kräver separat godkännande,
   granskat syntetiskt underlag och användarsamtycke. Dokumentera rollbackbevis.

Vid varje fel: stoppa nästa fas, behåll underhållsspärr och bevara originaldata.
Ingen automatisk down-migration, wipe eller omstart av andra tjänster.

## 9. Lokal leverans och Git

Sex nya SQL-/test-/procedurfiler samt denna rapport och PASS 3B-manifestet.
De två redan befintliga PASS 3A-filerna bevaras byte för byte:

```text
production-readiness-pass3a-2026-10-17.md
SHA-256 665b24bc7d25e07e780b3648a4559a391826373d298c03694ce6644751cdcc3d
production-readiness-pass3a-manifest.json
SHA-256 572bddea1e5b29aa15952edea8960745e3f8e72acd502356c2944ed5c5bc49da
```

HEAD/branch oförändrade. Inga tracked filer ändrade, inga historiska migrationer
ändrade, inget stageat, ingen commit/push. Totalt tio nya ospårade gransknings-
filer inklusive de två från PASS 3A. Lokala loggar och syntetiska artefakter
ligger ignorerade i `test-results/pass3b`; inga riktiga konton, nycklar, tokens
eller databaskopior ingår i leveransen. Körmanifestet listar filernas SHA-256.

Arbetet stannar här. Produktionsgrindarna är inte stängda och inget
produktionskörgodkännande har lämnats.
