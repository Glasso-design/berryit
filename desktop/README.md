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
npm run package       # bygger dist-installer/BerryIT-Control-Center-Setup.exe
cd src-tauri && cargo test   # testar lagringen mot riktig Credential Manager
```

`npm run dev` startar bara webbdelen på port 3601 (utan Tauri). Backendanropen
lyder då webbläsarens origin-regler och fungerar bara om gatewayen skickar
CORS-headers — kör `tauri:dev` när auth ska testas.

## Konfiguration

Programmet levereras **utan** inbyggd backendadress. Vid första start frågar det
efter adress och anon-nyckel, testar anslutningen och sparar den i
`%APPDATA%\se.berryit.controlcenter\config.json`. Filen innehåller ingen session
och inget lösenord. Adressen kan ändras efteråt under Inställningar.

Under utveckling läses förval från `.env.development.local`:

```
BERRYIT_PUBLIC_BACKEND_URL=http://127.0.0.1:8700
BERRYIT_PUBLIC_ANON_KEY=<anon-nyckel>
```

Endast `BERRYIT_PUBLIC_*` når bundlen (`envPrefix` i `vite.config.ts`), så en
hemlighet kan inte följa med av misstag. Filen laddas bara i utvecklingsläge —
produktionsbygget blir alltid okonfigurerat.

Klienten tillåter `http://` bara mot loopback och Tailscale (100.64.0.0/10).
Allt annat måste vara `https://`.

## Moduler

Fem moduler är anslutna i Desktop: Dashboard, Kunder, Support Desk,
Ask ONARLY AI och Inställningar. AI-vyn använder endast BerryITs
serveradapter under /ai/v1; gateway-token och providerhemligheter finns aldrig
i klienten. Projekt, Kommunikation, Infrastruktur, Monitoring och Integrationer
saknar backend och är märkta "ej ansluten" redan i menyn.

## Installation

`dist-installer/BerryIT-Control-Center-Setup.exe` (NSIS, per användare, svenska
och engelska). Kräver WebView2, som ingår i Windows 10/11.

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
