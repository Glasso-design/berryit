# BerryIT — Windows ägarinstallerare och inloggning, 2026-10-23

## Resultat

**Byggd: JA. Native-inloggning/MFA och läsning/navigation i begärda moduler:
PASS mot isolerad backend. Produktionsanvändning: BLOCKED.**
Arbetet utgår från `feat/support-desk`, HEAD
`dabecfe34e71a1ffc7e98fd1be6968a23fd91df2`. Ingen commit eller push.
Inga backendbehörigheter, migrationer eller produktionsfiler ändrades.

## Faktiskt installerat och observerat

- Den normala Windows-installationen är **0.1.1** i
  `C:\Users\glasn\AppData\Local\BERRYiT Control Center`.
  Dess befintliga fönster visade redan **Logga in**, med ett tydligt offlinefel.
  Det tidigare rapporterade Setup-fönstret kunde inte reproduceras där.
- En separat äldre **0.1.0** finns i Claudes virtualiserade LocalCache.
  Även en äldre `config.json` finns i dess Roaming-katalog. Konfigurationen
  innehåller publik anslutning till lokal loopback 8700; nyckelvärdet publiceras inte.
- Tidigare paketering tillät tom distributionsprofil och valde installerare
  efter ändringstid. Därmed kunde ett generiskt eller fel tidigare paket
  distribueras utan ett uttryckligt val. Utan komplett sparad konfiguration eller
  byggförval visar klientens befintliga kod **Anslut till BERRYiT**.
  Detta är en verifierad lucka i paketeringen, inte bevis för vilken äldre
  installerare användaren faktiskt startade.
- Den lokala ägarprofilen använder `http://127.0.0.1:8700`, avsett för den
  befintliga backendens SSH-tunnel. En fungerande tunnel till produktion
  startades inte i detta pass, så den befintliga installationens session berördes inte.

## Korrigering

- Ägarpaket är standard och kräver komplett backend-origin och publik klientnyckel
  innan Rust/NSIS startas. Origins, credentials/path/query, tillåtna protokoll,
  JWT-roll/algoritm/utgångstid samt administrativa nyckeltyper kontrolleras.
- `package:generic` kräver ett uttryckligt separat val och tömmer samtliga
  anslutningsförval även om `.env.production.local` finns.
- `controlUrl` förblir valfri enligt befintligt kontrakt. Ingen serveradress
  hittades på. Avancerad kundregistrering kräver en separat verifierad Control Center-server.
- Endast de tre avsedda publika variablerna når Vite-bundlen. React-dedupe behålls.
- NSIS-kopian måste vara nybyggd och ha exakt förväntad version; ingen fallback
  till äldre filer. Version **0.1.2** är konsekvent i npm, Tauri och Rust.
- Separata versionsmärkta distributionsmappar och manifest med SHA-256 används.
  Manifestet innehåller enbart publik profilfingerprint, aldrig nyckelvärdet.
- Ingen sessions-, konfigurations-, autentiserings- eller auktoriseringskod ändrades.

## Färdig artifact

```text
C:\projects\berryit\desktop\dist-installer\owner\BerryIT-Control-Center-Owner-0.1.2-x64-Setup.exe
```

| Egenskap | Verifierat värde |
|---|---|
| Version / Windows FileVersion / ProductVersion | 0.1.2 |
| Plattform / typ | Windows x64, NSIS, per användare |
| Storlek | 2 662 117 byte |
| SHA-256 | `73646b99b3ef22aa4efec333331ff0137a6322175d205111bb0551d4ade785d6` |
| Authenticode | **NotSigned**; automatisk uppdatering är fortfarande avstängd |
| Publik profil | Fingerprint matchar befintlig BerryIT-backend; Auth-health HTTP 200 |

Intilliggande `.exe.json` beskriver bygget. Denna ägarartifact har inte installerats
över den befintliga Windows-installationen. Dess avsedda produktionsprofil har
inte använts för native-inloggning i detta pass.

## Faktiska tester

| Kontroll | Resultat |
|---|---|
| Desktop/Vitest | **PASS: 148/148**, 12 filer, inklusive nio nya paketeringstester och React-bundeltest |
| Desktop TypeScript | **PASS** |
| ESLint, uttryckligen inkluderade ändrade TS/MJS-filer | **PASS**, exit 0; normal repo-lint ignorerar Desktop |
| Node-syntax, båda MJS-skripten | **PASS** |
| Rust, `cargo test --locked` | **PASS: 8/8**, inklusive syntetiska Credential Manager-testnycklar |
| Produktionsfrontend, syntetisk Auth/MFA och modulrendering | **PASS: 10/10**; Playwright, externa anrop blockerade, inte native-auth |
| Ägarpaket: TypeScript, Vite, Rust/MSVC release, NSIS | **PASS**, faktisk installerare byggd |
| Explicit generisk Vite-byggväg | **PASS**, ägarens publika klientnyckel saknas i generisk bundle |
| Native WebView2, separat testkopia | **PASS för kallstart till e-postinloggning**, ingen manuell backend-/nyckelregistrering |
| Riktig native-inloggning och TOTP denna körning | **PASS**: användaren genomförde autentisering i riktiga Windows-appen; isolerad backend bekräftar senaste session `aal2`, verifierad TOTP och aktiv global Super Admin-tilldelning |
| Inställningar i native WebView2 | **PASS**: `aal2 (tvåfaktor verifierad)`, Super Admin, version 0.1.2, Windows Credential Manager och isolerad backend 18750 synliga. Inga inställningar ändrade |
| Kunder i aktuell native-testkopia | **PASS för läsning och uppdatering**: 50 kundrader, privatpersoner och företagskunder samt företagslista; uppdatering av kundregistret utan fel |
| Projekt i aktuell native-testkopia | **PASS för läsning/navigation**: 15 projekt, öppnat syntetiskt projekts detaljer, registrerad status, kopplingar, tilldelade användare och projektaktivitet. Inga projektändringar gjorda |
| Support Desk i aktuell native-testkopia | **PASS för läsning/navigation**: sju ärenden; BIT-2026-0005 öppnat med tekniker/status, kundmeddelanden, separata interna anteckningar, intern/kundsynlig bilagemetadata och historik inklusive återöppning. DESK visar okänd faktisk anslutningsstatus och saknad rättighet; ingen session startad |
| Återgång till Dashboard | **PASS**: Super Admin, fem mottagna och två pågående ärenden synliga efter modulrundan |
| JavaScript-/React-feldiagnostik | **PASS under observerad modulrunda**: läsande native WebView2-diagnostik 13:55–13:59 UTC, noll `pageerror`, noll console-errors, ingen vit skärm eller hook-krasch |
| Bevarande | **PASS**: elva originalfiler och samtliga 15 tidigare ocommittade filer matchar före-hashar |
| Diffkontroll | `git diff --check` utan whitespacefel; inga historiska migrationer ändrade |

Vite rapporterar befintliga tredjepartsannoteringar och chunkstorlek över 500 kB.
Inga beroenden eller utvecklingsverktyg installerades/uppgraderades.

## Native-isolering och manuell grind

Den befintliga stacken **berryit-iso-83a2f62f** på core kontrollerades, inte
återskapad eller omstartad. En lokal SSH-tunnel använder endast
`127.0.0.1:18750` → core `127.0.0.1:8750`; gateway och Auth svarar HTTP 200.

Den ignorerade testkopian finns i
`test-results/desktop-owner-20261023/BerryIT-Owner-Native-Test.exe` och har:

- Fönstertitel `BerryIT OWNER TEST 20261023 — isolated`.
- Egen appidentitet och Credential Manager-namespace
  `se.berryit.controlcenter.ownertest20261023`.
- Endast isolerad backend 18750 och dess publika testnyckel.
- Lokal diagnostikport 18752, enbart i testkopian; inte ägarpaketets konfiguration.

Computer Use-skillen förbjuder automatisering av autentiseringsdialoger.
Användaren klickade Försök igen vid behov, loggade in och genomförde TOTP själv.
Skrivskyddad serverkontroll 2026-10-23 13:53 UTC bekräftade en verifierad
TOTP-faktor och två levande `aal2`-sessioner för enbart det syntetiska kontot;
senaste session skapades 13:48:51 UTC och har MFA-faktor kopplad. Inga tokens
eller faktorhemligheter lästes ut. Support Desk-listan renderades med ärendedata.
Computer Use kunde först inte pålitligt återställa fönstret ("window is
minimized", "user input was detected"). Användaren återställde fönstret och
bekräftade "öppet"; därefter slutfördes klicktesterna i riktig WebView2.
Inställningarnas `aal2`-status verifierades även i UI utan att nyckelvärdet
publicerades. Kundregistret uppdaterades, ett projekt och ett ärende öppnades
och Dashboard kontrollerades efter navigationen. Testappen lämnades inloggad
på Dashboard. Inga testdata, rolltilldelningar eller inställningar ändrades.

Bevis finns lokalt i Git-ignorerade
`test-results/desktop-owner-20261023/native-functional-checks.json`,
`native-mfa.json` och `native-console-followup.json`. Testkopians SHA-256 är
`6b1488a237f0d33dc6dc2073bbaaaa5d5e8aea6aa295d08f3321e946d376a745`.
Den har samma produktkällkod som ägarbygget men separat publik testprofil,
appidentitet, Credential Manager-namespace och lokal diagnostik. Den är alltså
inte byte-identisk med den produktionskonfigurerade payloaden.

Verifieringen omfattar inte nya konton, sparade projekt-/ärendeändringar,
rolländringar, bilageöverföring eller AI-inferens. Kundregistrering och
repositoryläsning kräver fortfarande en godkänd Control Center-URL.
Lokala syntetiska kontouppgifter/koder visas endast av
det befintliga lokala hjälpskriptet, inte i verktygsutdata eller denna rapport.
Ingen Credential Manager-session från den normala installationen återanvänds.

## Verifierad produktionsblockerare och ägarstatus

Skrivskyddad SQL i `BEGIN READ ONLY` bekräftade **sex applicerade migrationer**
och att `public.support_access_context()` **saknas**. Den nya klienten kräver
den serverauktoriserade kontexten och ska fortsätta neka när kontraktet saknas.
Ingen frontendfallback eller rättighetsändring har införts.

I produktion finns **en aktiv global Super Admin-tilldelning** till aktiv profil med
verifierad MFA-faktor. Inga namn, e-postadresser, användar-ID eller grants
publicerades eller ändrades. Detta verifierar befintlig administrativ tilldelning,
inte en färsk godkänd MFA-session mot produktion i den nya klienten. Den riktiga
native-MFA-sessionen verifierades endast mot isolerad testbackend.

Före faktisk produktionsanvändning krävs separat godkänd backenduppgradering
enligt befintliga produktions-/backupgrindar samt fungerande godkänd transport.
Den osignerade installeraren och avsaknad av verifierad Control Center-server
kvarstår också som distributions-/funktionsbegränsningar. Ingen produktionsändring
gjordes för att kringgå dessa blockerare.

## Ändrade filer och Git

Åtta befintliga filer ändrades: Desktop README, package.json/lock, package.mjs,
Vite-konfiguration och Tauri/Cargo versionsfiler. Tre nya käll-/testfiler:
`distribution-profile.mjs`, dess typdeklaration och
`desktop/tests/distribution-profile.test.ts`. Denna rapport är ny.

Allt tidigare arbete är bevarat. Byggutdata, testkonton, profiler, SSH-loggar och
diagnostik ligger under befintligt Git-ignorerade sökvägar. Ingen commit, push,
deployment, migration eller ändring av backendbehörigheter utfördes.
