# ONARLY Platform Factory — discovery och implementeringsgräns

## Granskad bas

BerryIT `feat/support-desk` @ `dabecfe34e71a1ffc7e98fd1be6968a23fd91df2`.
27 redan ocommittade filer finns; före-hashar sparade under ignorerade
`test-results/platform-factory-20261024/`. Backup-, hotfix- och Desktop-arbetet
ska inte skrivas över. Andra identifierade Codex-arbeten är avslutade/idle;
COMPOSER:s separata arbetsyta lämnas orörd. Inga serverkontroller behövs för lokal implementation.

42 faktiska `.git`-kandidater hittades under C:/projects och C:/ONARLY-HUB.
38 har läsbar HEAD. BUDGY, ONARLY-DRIVE-PASS6 och onarly-create har ingen
verifierad HEAD; fliqs-community har ingen första commit. Dessa räknas inte
som verifierade releaser. Worktree-dubbletter inventeras genom Git, inte som
nya produkter. Full lokal metadata finns i discovery.json (inga credentials).

## Produktmatris före kodning

| Produkt / repository | Verifierat befintligt | Adapterstatus / beroende |
|---|---|---|
| QABGO / onarly-drive | Customer, Driver, Dispatch/Call Center, Admin/Core; Node 24 + PostgreSQL; 19 checksumskyddade migrationer | ADAPTER_IN_DEVELOPMENT; ren bundle, aldrig kopiera pilotseeds eller TaxiZone-produktion |
| Hub/Radio/Video/Director/ARENA/Performance/Composer/Flexx / onarly-main | Gemensamt produktregister, stationsidentitet, Supabase, separat kommersiellt control plane och audit | MANUAL_SETUP_REQUIRED; ingen färdig fullständigt isolerad instansadapter |
| VISI / visi | Next.js, egen runtime och AI-providergräns | MANUAL_SETUP_REQUIRED; dataresidens, Auth/Storage och ren produktmall måste verifieras |
| FLIQS / fliqs | Flera läsbara webb-/native-worktrees; distribution skiljer mellan dem | MANUAL_SETUP_REQUIRED för webbdelen; ingen automatisk adapter annonseras |
| BerryIT / berryit | Projekt, roller/permissions/grants, MFA, audit, Connector Engine och monitoring | MANUAL_SETUP_REQUIRED som produkt; används som Factory-kontrollpanel |
| ONARLY DESK | Desktop och RustDesk-konfiguration; 19 opublicerade filer | NOT_PROVISIONABLE som SaaS utan godkänd distributionsmodell |
| PrintBuddy / printbudy | Ren releasegren, `39aecc4`; skrivarbunden produkt | NOT_PROVISIONABLE tills server-/SaaS-modell är godkänd |
| Printhaus | Katalog finns, entydig repo-/distributionsrot behöver kompletteras | MANUAL_SETUP_REQUIRED, ingen antagen READY |
| Bara Vara Jag / baravara | Ren gren och webb-/produktkod | MANUAL_SETUP_REQUIRED; adapter/data-/Auth-granskning återstår |
| OPERA, Triply, AuroraPark, Allstars, DONNAGINA, Glasnovic, ONARLY DEV, RefHub | Separata repositories/produkter identifierade; vissa med egen driftmodell | Inventerade, inte automatiskt provisioneringsklara |
| CASELINE / Night Fare | Spel | NOT_PROVISIONABLE |
| ONARLY HQ / ARENAHUB | Namn finns i uppdraget men inte säkert mappade till en egen godkänd produktidentitet | NOT_PROVISIONABLE tills identitets-/distributionsbeslut finns |

QABGO:s huvudkrav är [issue #8](https://github.com/Glasso-design/onarly-drive/issues/8).
Senare ren QABGO-arbetsyta hittades på `codex/qabgo-solo-master-20261020`,
HEAD `01d27b5ccd9e669d8dfb8e3fe9f785332a35d397`. Den används som pinnad lokal
granskningskälla, **inte som ett nytt produktionsreleasegodkännande**.
Ordinarie ONARLY-DRIVE-root ligger på en äldre Customer-gren och är därför
inte en komplett fyrappsprodukt. Ingen branch byts eller slås samman.

## Återanvändning och avgränsning

- Factory-kärnan är separat från UI och produktkod under services/platform-factory.
  Inga provisioneringsmotorer skapas i produktrepona.
- Hub:s kanoniska produkt-ID:n refereras med källproveniens. Factory beskriver
  adapterförmågor och instanser; den duplicerar inte kommersiella planer,
  abonnemang eller ONARLY-konton.
- BerryIT:s befintliga organisations-/projektregister och centrala
  permissions/grants/MFA/audit används. Ingen ny Super Admin-modell.
- Factory-schema ligger utanför supabase/migrations och installeras endast
  uttryckligen i ny isolerad testdatabas. Blockerade produktionsmigrationer
  förändras eller kopplas inte till automatisk installation.
- Connector Engine förblir read-only. Factory-providers är en separat
  privilegierad gräns; monitoring kopplas genom registrerade referenser.
- QABGO:s befintliga åkeri/workspace-skapande ersätter inte en ny databas/runtime.
  Inga befintliga kunddata, produktionskonfigurationer, pilotpriser eller sessionsdata används.

## Leverantörsbelägg, 2026-10-24

Tenant API kräver partnerbehörighet: [Cloudflare Tenant](https://developers.cloudflare.com/tenant/get-started/).
Standalone kräver behörig befintlig användare, begränsat antal nya Free-konton,
user-owned token/OAuth och stabil Idempotency-Key:
[kontoskapande](https://developers.cloudflare.com/fundamentals/account/create-account/).
Detta får inte ersättas med massregistrering eller automatiserad verifiering.

R2:s 10 GB är ingen per-instans gratisgaranti. Standardlagring kostar enligt
granskad prislista $0.015/GB-månad före delad free tier, samt operationer:
[R2 pricing](https://developers.cloudflare.com/r2/pricing/).
Kvoten måste verkställas av Factory/uppladdningsbroker; bucketkapacitet är inte
en 10 GB-kvot: [R2 limits](https://developers.cloudflare.com/r2/platform/limits/).
Routing kräver verifierad destination och är ingen mailbox:
[Email Routing](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/).

Riktiga molnkonton, DNS, e-post och kostnader är inte godkända. Lokala MOCK-resultat
och riktiga lokala PostgreSQL-prov ska redovisas separat; inget annonseras som
STAGING eller PRODUCTION utan genomförd verifiering.
