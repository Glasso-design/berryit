# BERRYiT Control Center — Windows-desktop

IT-support och administration för BERRYiT:s egna projekt och externa kunder.
Tauri 2 + React + TypeScript, paketerat som ett vanligt Windows-program.

Kundportalen är kvar i Next.js (`../src`). Desktopappen är en egen klient mot
samma backend, inte en inpackad webbplats.

## Vad som delas med webben

Allt gemensamt ligger i [`../shared`](../shared/README.md) och läses som källkod
via sökvägsalias — ingen kopiering, inget byggsteg:

| Delat | Följd |
|---|---|
| `domain.ts` | Samma svar på "vem är personal" och "krävs MFA" i båda klienterna |
| `schemas.ts` | Samma validering och samma felmeddelanden |
| `api.ts` | Samma tabeller, kolumner, gränser och sökfilter |
| `nav.ts` | Samma tio moduler, och samma uppgift om vilka som saknar backend |
| `theme.ts`, `tokens.css` | Samma tema och samma `#C10C43` |
| `ui/Icon.tsx` | Samma ikoner |
| `../src/assets/brand/*` | Samma godkända logotypfiler |

Paketet publiceras inte och byggs inte separat. npm workspaces undveks medvetet:
det hade dragit in Vite och Tauri CLI i webbens installation på Vercel.

## Autentisering

Desktopappen återanvänder backendens GoTrue, men **inte** webbens
cookie-/SSR-lösning — den förutsätter en server i mitten, vilket en desktopklient
inte har.

* **Inloggning:** e-post och lösenord direkt mot GoTrue, därefter TOTP för
  Super Admin. Ingen publik registrering.
* **Sessionslagring:** Windows Credential Manager via Rust
  ([`src-tauri/src/secure_store.rs`](src-tauri/src/secure_store.rs)). Inte
  `localStorage`, inte en fil i klartext. Credential Manager tar högst 2560 byte
  per post, så sessionen delas upp i flera poster och sätts ihop vid läsning.
* **Förnyelse:** `autoRefreshToken` i Supabase-klienten; den förnyade sessionen
  skrivs tillbaka till Credential Manager.
* **Nätverk:** alla anrop går genom Rust (`tauri-plugin-http`), inte genom
  WebView2. Anropen omfattas därför inte av webbläsarens origin-regler, och
  gatewayen behöver inga CORS-undantag för appen.
* **Behörighet:** avgörs av RLS i databasen. Appen speglar bara resultatet —
  en klient som räknar fel får ändå inga rader.
* **Nycklar:** endast den publika anon-nyckeln. Klienten vägrar starta mot en
  service-role-nyckel ([`src/config.ts`](src/config.ts)).

### Blockerat: PKCE med systemwebbläsare och redirect

Flödet "öppna systemwebbläsaren, logga in, kom tillbaka med en kod" går inte att
bygga mot dagens backend, och ingen osäker genväg har byggts i stället. Det
krävs:

1. **En publik HTTPS-origin** för auth. I dag nås backenden bara över Tailscale
   eller en lokal tunnel, och `GOTRUE_SITE_URL` pekar på `localhost`.
2. **Ett flöde som utfärdar auktoriseringskoder.** `GOTRUE_DISABLE_SIGNUP=true`,
   ingen OAuth-leverantör är konfigurerad och ingen SMTP finns, så varken
   social inloggning eller magisk länk kan användas.

Klienten är förkonfigurerad med `flowType: "pkce"` så att flödet blir rätt den
dag en leverantör tillkommer, men det är inte i bruk i dag.

## Krav för att bygga

Node 20+, Rust (stable, MSVC) och Visual Studio Build Tools. **Teknikern som ska
använda programmet behöver inget av detta** — installeraren innehåller allt.

```bash
npm install
npm run tauri:dev     # kör appen med hot reload
npm test              # enhetstester för delad logik
npm run typecheck
npm run package:owner # kräver validerad publik profil; versionsmärkt ägarinstallerare
npm run package:generic # separat paket utan anslutningsförval
npm run connect       # lokal SSH-tunnel med redan befintlig, betrodd SSH-identitet
cd src-tauri && cargo test   # testar lagringen mot riktig Credential Manager
```

`npm run dev` startar bara webbdelen på port 3601 (utan Tauri). Backendanropen
lyder då webbläsarens origin-regler och fungerar bara om gatewayen skickar
CORS-headers — kör `tauri:dev` när auth ska testas.

## Konfiguration

Standardbygget är ett ägarbygge och avbryts om backend-origin eller publik
klientnyckel saknas eller är ogiltig. `npm run package:owner` läser förval från
`.env.production.local` och visar inloggningen direkt. Ett generiskt paket måste
begäras med `npm run package:generic`; det tömmer samtliga anslutningsförval även
om en lokal ägarprofil finns, och frågar efter adress och anon-nyckel vid första
start. Befintlig sparad
konfiguration har företräde. Manuellt angivna uppgifter sparas i
`%APPDATA%\se.berryit.controlcenter\config.json`. Filen innehåller ingen session
och inget lösenord. Anslutningen kan ändras från inloggningen och under Inställningar.

Under utveckling läses förval från `.env.development.local`:

```
BERRYIT_PUBLIC_BACKEND_URL=http://127.0.0.1:8700
BERRYIT_PUBLIC_ANON_KEY=<anon-nyckel>
BERRYIT_PUBLIC_CONTROL_URL=https://control.example.test
```

Control Center-URL är valfri för befintligt ärendearbete men krävs för manuell
kundregistrering från Desktop. Samma värde kan anges i Setup/Inställningar.
Endast origin godtas, utan sökväg, query eller inloggningsuppgifter. Kunden
registreras av servern med inloggningen spärrad; ingen e-post skickas.
Separat aktivering kräver behörig administratör i Auth och uppdatering av
profilens `login_activation_pending`. Kundregistrering kräver levande MFA2.
Webbläsarvarianten av Desktop behöver uttrycklig origin i serverns
`CONTROL_ALLOWED_ORIGINS`; native använder Bearer över befintlig HTTP-plugin.
Serverns service-role-nyckel får aldrig läggas i Desktop-konfigurationen.

Den isolerade helresan beskrivs i
[`docs/complete-support-workflow-v1.md`](../docs/complete-support-workflow-v1.md).

Endast de tre uttryckligen tillåtna variablerna ovan når bundlen. Vite avvisar
ofullständiga profiler, osäkra origins, service-role-JWT och `sb_secret_`-nycklar.
Produktionsprofilen är lokal och git-ignorerad; den innehåller bara publika
anslutningsvärden. Ingen serverhemlighet eller privat SSH-nyckel kopieras till appen.

### Verifierad anslutning på denna Windows-dator, 2026-10-16

BerryITs befintliga backend finns på `prod-node-01` (`100.100.11.6`) och
gatewayen lyssnar endast på serverns `127.0.0.1:8700`. Tailscale i sig exponerar
inte den porten. Den lokala distributionsprofilen använder därför
`http://127.0.0.1:8700` via en krypterad SSH-tunnel:

```powershell
npm run connect --prefix desktop
```

Hjälpen använder datorns redan befintliga `~/.ssh/prod-node-home`, strikt
värdnyckelkontroll och `BatchMode`; den skapar inga nycklar och ändrar inget på
servern. Endast Windows-loopback exponeras. Gatewayens identitet och Auth måste
båda svara korrekt innan anslutningen rapporteras som fungerande. En fungerande
anslutning återanvänds. Hjälpen vägrar ersätta en annan tjänst på port 8700.
Kör hjälpen igen efter Windows-omstart eller tappad SSH-anslutning. Ingen
autostart eller schemalagd uppgift installeras. Status och SSH-logg ligger i
git-ignorerade `desktop/.local/`. Installeraren distribuerar inte denna identitet;
andra datorer behöver separat godkänd nätverksåtkomst.

`npm run test:desktop-connection` från repo-roten testar den byggda,
förkonfigurerade frontenden med syntetisk Auth-health och spärrade externa
anrop. Det är inte ett test av Windows WebView2 eller en verklig kontoinloggning.

**Serverblockerare:** den läsande driftkontrollen hittade bara de sex första
migrationerna till och med `20261013091000_support_authority_hardening.sql`.
Senare MFA-, Communications-, AI-, Connector-, Monitoring-, DESK-, Security
Repair- och Complete Support Workflow-migrationer är inte applicerade.
Auth är nåbar, men den nya supporthelheten är inte driftverifierad och får inte
rapporteras som klar. Ingen Next.js Control Center-server verifierades i
BerryIT-stacken; `controlUrl` lämnas tom och kundregistrering är blockerad.
Inga migrationer eller serverändringar ingår i denna Desktop-korrigering.

Klienten tillåter `http://` bara mot loopback och Tailscale (100.64.0.0/10).
Allt annat måste vara `https://`.

## Moduler

Fem moduler är anslutna i Desktop: Dashboard, Kunder, Support Desk,
Ask ONARLY AI och Inställningar. AI-vyn använder endast BerryITs
serveradapter under /ai/v1; gateway-token och providerhemligheter finns aldrig
i klienten. Projekt, Kommunikation, Infrastruktur, Monitoring och Integrationer
saknar backend och är märkta "ej ansluten" redan i menyn.

## Installation

`dist-installer/owner/BerryIT-Control-Center-Owner-<version>-x64-Setup.exe`
(NSIS, per användare, svenska och engelska). Det generiska paketet ligger separat
i `dist-installer/generic/`. Varje nytt paket har en intilliggande JSON-manifestfil
med version, SHA-256 och publik profilfingerprint, utan nyckelvärdet. Paketeringen
accepterar endast en nybyggd installerare med exakt förväntad version; den väljer
inte en äldre fil efter ändringstid. Äldre distributionsfiler ersätts inte.
Kräver WebView2, som ingår i Windows 10/11.

Profilvalidering granskar origin och klientnyckelns format/roll/utgångstid.
Den ersätter inte serveridentitetskontroll, fungerande transport eller databasens
behörighetskontroller. Ägarprofilen på denna dator använder en lokal SSH-tunnel;
installeraren distribuerar ingen privat SSH-identitet och startar ingen tunnel.
Ett paket kan därför öppna inloggningen korrekt samtidigt som anslutning eller
det driftsatta schemat blockerar fortsatt användning.

Automatisk uppdatering är **avstängd**. Den får inte aktiveras förrän
installeraren signeras — en osignerad uppdateringskanal är en väg rakt in i
klientdatorn.

## Säkerhet i korthet

* Ingen service-role-nyckel och inga administrativa hemligheter i klienten.
* Sessionen i Windows Credential Manager, aldrig i webblagring.
* Super Admin kommer inte förbi tvåfaktor — ingen modul renderas före aal2.
* Content Security Policy sätts i `tauri.conf.json`; webbvyn laddar inget
  externt och talar aldrig själv med backenden.
* Tauri-behörigheterna är minimala: fönstret, appens egna kommandon och HTTP mot
  den konfigurerade adressen. Inget filsystem, ingen shell.

## Lokal projekt-/rollutökning 2026-10-16

Projekt och dynamiska roller använder skyddade databasfunktioner; klienten
presenterar serverns förmågor. En äldre backend utan
`20261016090000_project_access.sql` stöder inte den nya klientens åtkomstkontrakt.
Distribuera därför inte detta lokala bygge mot nuvarande produktionsschema.
Se [rapport, tester och uppgraderingsgrind](../docs/project-access-master-2026-10-16.md).
Native release byggdes lokalt utan bundle; tidigare installerare ersattes inte.
Riktig Windows-inloggning/MFA mot isolerad Supabase återstår.
