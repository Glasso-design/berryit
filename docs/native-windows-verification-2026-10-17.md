# BerryIT — native Windows-verifiering, 2026-10-17

## Resultat

**PASS för de begärda native-flödena mot den befintliga isolerade teststacken.**
Riktig Windows WebView2 användes, inte Chromium med ersatt Tauri-transport.
Lösenordsinloggning och TOTP genomfördes genom appens formulär. Ingen verklig
produktions-AI-inferens utfördes. Resultatet innebär inte verifierad produktion.

## Avgränsning och skydd

- Repository: `C:\projects\berryit`, branch `feat/support-desk`.
- HEAD oförändrad: `0357a64e7d0284a30259cbf7b78b6c7a1e155b91`.
- Alla 103 tidigare modifierade/nya filer jämfördes mot sparade SHA-256-hashar:
  samtliga är byte-oförändrade. Denna rapport är den enda nya versionshanterbara
  filen från återupptagandet. Testbevis och hjälpfiler ligger i ignorerade
  `test-results/native-verification/`.
- Befintlig `berryit-iso-83a2f62f` återanvändes på core-node-01: sju redan
  körande containrar, gateway på serverns loopback-port 8750. Ingen ny stack,
  containerstart, omstart, migration eller serverkonfigurationsändring gjordes.
- Befintlig SSH-tunnel återanvändes: `127.0.0.1:18750` till testgatewayen.
  Gateway och Auth svarade HTTP 200. Samtliga sju containrar var fortfarande
  uppe efter testerna, med cirka tolv timmars upptid.
- Samma befintliga `BerryIT-Native-Test.exe` återanvändes. Inget nytt bygge
  gjordes under återupptagandet. Den separata testkopian har frontend som
  tidigare bytejämförts med samtliga fem filer i den nybyggda produktionsfrontenden.
  Testkopians Rust-skillnad är Credential Manager-namnrymden; Tauri-konfigurationen
  har separat identifierare, produktnamn och fönstertitel.
- Testprofil: `se.berryit.controlcenter.native20261017`, separat från både
  den vanliga installationen och den tidigare ISOTEST-profilen. Backend och
  control-origin pekar till testtunneln; bara teststackens publika anon-nyckel
  finns i klientkonfigurationen. Inga administrativa nycklar infördes i appen.
- Den vanliga Windows-installationen, dess konfiguration och Credential
  Manager-session lästes eller ändrades inte. Utloggningen i testet berörde
  endast den separata testprofilen.
- Ingen commit, push, deployment, produktionsmigration eller datarensning.

Slutlig Git-status: **50 modifierade spårade filer, 54 nya filer, 0 staged**
(104 opublicerade filer totalt, inklusive denna nya rapport). De 103 filer
som redan fanns i arbetsytans diff är oförändrade.

## Verifierat genom native WebView2

Runtime rapporterade **Edg/155.0.4283.60**, protokoll 1.3, native-dokument
`http://tauri.localhost/`. Alla klick, fältvärden, tangenttryckningar och
bekräftelser gjordes med Windows Computer Use. CDP användes för feldiagnostik,
inte för att logga in, navigera, fylla formulär eller anropa Tauri-kommandon.

| Kontroll | Resultat | Faktiskt observerat |
|---|---|---|
| Riktig lösenordsinloggning och TOTP | PASS | Utloggning i testprofilen, e-post/lösenord genom Windows-formuläret, obligatorisk MFA-grind, aktuell TOTP och därefter Dashboard med testdata |
| Kallstart och sparad session | PASS | Testkopian återöppnades med samma isolerade profil; Dashboard återställdes. Även normal start utan diagnostik verifierades sist |
| Kunder | PASS | Kundtabellen fylldes med syntetiska privatpersoner och företagskunder; ingen vit skärm |
| Projekt | PASS | Registret laddades; nytt projekt skapades utan repository, server eller integration och beskrivningen redigerades genom UI |
| Support Desk | PASS | Ärendelista, formulär och detaljer för BIT-2026-0006 öppnades. Kundmeddelanden, interna anteckningar, bilagor, historik och DESK-paneler renderades |
| Navigering | PASS | Dashboard, Kunder, Projekt, Support Desk, Monitoring, Infrastruktur och Ask ONARLY AI öppnades genom native-menyn; återgång mellan vyer fungerade |
| Dynamiska roller | PASS | Ny organisationsbegränsad roll med enbart `projects.read` skapades och tilldelades ett befintligt syntetiskt konto för endast det UI-skapade projektet |
| Monitoring/Infrastruktur | PASS | Syntetiska incidenter, noder och tjänster visades. Monitoring markerade 13 resurser som ej anslutna; saknade mätningar presenterades inte som fungerande drift |
| Sök felet och samtycke | PASS | Rätt UI-projekt valdes, exakt backendunderlag förhandsgranskades, skickaknappen var spärrad före samtycke, uttryckligt samtycke gavs och syntetiskt Gateway-svar visades |
| AI till supportärende | PASS | Appens separata bekräftelsedialog visades och accepterades; BIT-2026-0007 skapades och dess detaljer öppnades i Support Desk |
| JavaScript/React | PASS inom observerad testperiod | 0 ohanterade JavaScript-undantag och 0 konsolfel registrerades. Ingen vit skärm eller React-hook-krasch observerades under flödena |

Panelrendering är inte ett påstående om nya tester av filuppladdning,
meddelandesändning, DESK-fjärrsession eller alla ärendestatusövergångar. Sådana
åtgärder ingick inte i detta native-pass.

## Syntetiska UI-poster och backendverifiering

- Projekt: **Native UI Verification 20261017**.
- Organisation: befintlig syntetisk **Isolerad Annan Kund AB**.
- Backend återläste projektets ändrade beskrivning och revision **2**.
- Roll: **Native UI Reader 20261017**.
- Servern lagrar exakt permission `projects.read`. UI-granten gäller det
  befintliga syntetiska utvecklarkontot och endast projektet ovan. Den är aktiv
  utan sluttid i teststacken; inga testposter eller tilldelningar rensades.
- Supportärende: **BIT-2026-0007 · AI: Sök felet**. Det innehåller syntetisk
  konversation och det uttryckligt märkta testsvar som visades i native-appen.

Körningsspecifika konto- och resursidentifierare finns enbart i de lokala,
Git-ignorerade testbevisen och publiceras inte med rapporten.

Projekt, permissions och grant kontrollerades dessutom i en SQL-transaktion
med `BEGIN READ ONLY` i exakt teststackens databascontainer. SQL-skrivningar
användes inte för att skapa UI-posterna.

**Fem nya riktiga HTTP/JWT/RLS-kontroller: 5/5 PASS:**

1. Befintligt syntetiskt utvecklarkonto loggar in mot riktig GoTrue.
2. Den UI-tilldelade rollen ger läsning av exakt det tilldelade projektet i
   målorganisationen.
3. Det otilldelade syskonprojektet i samma organisation döljs av RLS.
4. Direkt skyddat RPC-anrop för projektändring nekas för läsrollen.
5. Direkt RPC-försök att skapa en administrativ roll nekas.

Detta skiljer verifieringen av backendens rättigheter från presentationen i UI.
Behörighetsbesluten gjordes inte med klientens rollflaggor eller dolda knappar.

## AI-begränsning och samtycke

Den befintliga `berryit-iso-83a2f62f-fakegw` delar nätverksnamnrymd med
testets AI-adapter. Adapterns Gateway-adress är dess lokala port 8899.
Tidigare kontrollerad serveradapterkod matchar repositoryts filhashar.
Ingen begäran skickades till produktions-ONARLY AI.

Det nya UI-projektet saknar mätvärden, tjänstestatus och råloggar.
Förhandsgranskningen innehöll rätt projekt-/organisations-ID, `facts: []` och
explicit saknad information. Svaret sade **SYNTETISKT TESTSVAR**, saknade
verifierbar modellstruktur och bevisade ingen felorsak. Appen visade dessa
begränsningar. Detta verifierar transport, scope, samtycke och presentation;
det verifierar inte en riktig modells diagnostiska förmåga.

Den separata föregående HTTP-verifieringen omfattade även en syntetisk incident
med faktiskt registrerat incidentunderlag. Den får inte förväxlas med
native-testets nya projekt med tomt faktaunderlag.

## Feldiagnostik och testverktygsavvikelser

Den första lokala diagnoslyssnaren använde Playwrights CDP-anslutning, vars
standardbeteende automatiskt avvisade appens `window.confirm`. Därför skapades
inget ärende vid första försöket. Lyssnaren stoppades och ersattes med råa,
läsande CDP `Runtime`/`Log`-händelser utan dialoghantering. Därefter observerades
den riktiga native-dialogen, accepterades genom UI och BIT-2026-0007 skapades.
Ingen produktändring gjordes för att få testet att lyckas.

Computer Use avvisade även vissa klick där accessibility-geometrin låg utanför
fönstret eller över en WebView-popup. Läget observerades på nytt och de stegen
utfördes genom aktuell skärmbild eller native-tangentbord. Dessa verktygsfel
räknas inte som lyckade appåtgärder.

Den tillfälliga testprocessens debugport var loopback-bunden till 18751.
Efter testerna stängdes endast testkopian och diagnoslyssnaren. Samma befintliga
EXE startades normalt igen; Dashboard öppnades med testsessionen. Debugporten
kontrollerades därefter som **inte nåbar**. SSH-testtunneln på 18750 och den
normalt startade separata testkopian lämnades tillgängliga.

## Testbevis och regressioner

Aktuella native-bevis finns lokalt i `test-results/native-verification/`:

- `native-results.json`, `native-console.json`, `webview-version.json`.
- `native-kunder.txt`, `native-projects.txt`, `native-project-created.txt`,
  `native-project-edited.txt`, `native-role-created.txt`,
  `native-role-assignment.txt`, `native-ticket-details.txt`.
- `native-ai-preview.txt`, `native-ai-response.txt`,
  `native-ai-ticket-created.txt`, `native-fresh-login.txt`,
  `native-final-restart.txt`.
- `ui-role-http-results.json` och `ui-role-http-check.log`: 5/5 PASS.
- `final-integrity.json`: 103 ursprungliga filer oförändrade.

Regressioner från det direkt föregående verifieringspasset, inte omkörda här:
Desktop **139/139 PASS**, isolerad RLS **272/272 PASS**, AI-adapter **14/14 PASS**.
Detta pass ändrade ingen produktkod och gjorde inget nytt produktionsbygge.

Artefakternas SHA-256 kontrollerades igen:

| Artefakt | SHA-256 |
|---|---|
| Separat native-testkopia | `9cfd3129323613ef1a970056290d0552c4cac9bacc30f0746687e257c5bd7637` |
| Befintlig vanlig release-EXE i byggkatalogen | `4cb811bd84af3e4a227797a0d3b6be9f3bb060e2f85e71c381c90fdbd0123570` |
| Befintlig Windows-installerare | `dc5d6f39393edc25262bfbc8786c7f6d2e08ba849caa1fee3aaf6e3c787b9036` |

## Kvarstår / BLOCKED

**Ingen återstående blockerare för de begärda native-flödena i teststacken.**
En riktig AI-modells felanalys och produktionsanslutning är inte verifierade
och har avsiktligt inte körts. Produktionsinstallation med normal profil,
produktionsmigrationer och deployment omfattas inte av detta PASS.
Ingen installerare kördes eller installerades över användarens befintliga app.

Före ett separat produktionsbeslut behövs den redan planerade driftgrinden
för migrationsordning, backup/restore, backendanslutning och verklig Gateway.
Detta pass godkänner inga sådana produktionsåtgärder.
