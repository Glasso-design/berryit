# @berryit/shared

Gemensam källkod för **webben** (Next.js, `src/`) och **desktopappen** (Tauri, `desktop/`).

Här ligger det som måste vara identiskt i båda klienterna:

| Fil | Innehåll |
|---|---|
| `domain.ts` | Domäntyper och behörighetslogik (roller, status, prioritet, AccessContext) |
| `schemas.ts` | Zod-validering för formulär och inkommande data |
| `api.ts` | API-kontrakt mot den självhostade backenden (sökvägar, kolumnval, gränser) |
| `nav.ts` | Control Center-navigationen – samma tio moduler i båda klienterna |
| `theme.ts` | Temaval (dark/light) och temafärger |
| `tokens.css` | Designtokens och Tailwind-mappning, inklusive BERRYiT-rött `#C10C43` |

## Hur det konsumeras

Paketet byggs inte och publiceras inte. Båda klienterna läser källkoden direkt
via en sökvägsalias (`@berryit/shared/*`):

* webben: `tsconfig.json` → `paths`
* desktopappen: `tsconfig.json` → `paths` och `vite.config.ts` → `resolve.alias`

Valet är medvetet: npm workspaces hade dragit in desktopappens beroenden
(Vite, Tauri CLI, Rust-bindningar) i webbens installation på Vercel. Ingen
byggsteg behövs eftersom båda klienterna redan kompilerar TypeScript.

## Regler

* Inget här får importera `next/*`, `react-dom`, Tauri-API:er eller Node-moduler.
  Koden ska fungera i både en server-rendering och en WebView2-klient.
* Ingen hemlighet, ingen nyckel och ingen miljöberoende URL hårdkodas här.
