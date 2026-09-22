# BERRYiT V2

Företagssajt och teknisk portfolio för BERRYiT – *Teknik som bara fungerar.*
Vi fixar tekniken du har och hjälper dig bygga tekniken du behöver.

| | |
|---|---|
| Canonical root | `C:\projects\berryit` |
| GitHub | https://github.com/Glasso-design/berryit.git |
| Branch | `main` |
| Lokal port | `3501` (registrerad i `C:\projects\PORTS.md`) |
| Status | Baseline – **ej driftsatt** |

Stack: Next.js 16.3.5 (App Router, typed routes) · React 19 · TypeScript · Tailwind CSS 4 · zod 4.
Språk: svenska (`lang="sv"`). Package manager: npm.

## Kommandon

```bash
npm install          # eller: npm ci
npm run dev          # http://localhost:3501
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # production build
npm start            # kör production build på 3501
```

Det finns ingen testsvit ännu.

## Miljövariabler

Se `.env.example`. Lägg lokala värden i `.env.local` (ignoreras av git). Inga secrets i repot.

| Variabel | Syfte | Krävs för live |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Kanonisk bas-URL (metadataBase, canonical, OpenGraph, sitemap, robots, JSON-LD), t.ex. `https://berryit.se`. | Rekommenderas |
| `CONTACT_WEBHOOK_URL` | Mottagare för kontaktformuläret. POST `multipart/form-data` med `summary` (text), `data` (JSON) och `files`. | Ja |

Bas-URL:en löses i `src/lib/site-url.ts`: `NEXT_PUBLIC_SITE_URL` → `SITE_URL` (äldre namn) →
`VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → `http://localhost:3501`. Tomma eller ogiltiga värden hoppas över,
värden utan protokoll får `https://`, och bygget kraschar aldrig på grund av URL-konfiguration.
Sätt ändå `NEXT_PUBLIC_SITE_URL=https://berryit.se` i Vercel (Production) så att canonical inte blir en `*.vercel.app`-adress.

Saknas `CONTACT_WEBHOOK_URL` svarar `/api/contact` **503** med ett tydligt meddelande om att kontaktfunktionen
inte är ansluten. Formuläret behåller användarens uppgifter. Ingen falsk success.

## Innehåll

All text och data som ändras ofta ligger i `src/content/`:

| Fil | Innehåll |
|---|---|
| `src/content/site.ts` | Namn, budskap, navigation, kontaktuppgifter (null = dolt), arbetslägen, utvecklingsnivåer |
| `src/content/services.ts` | Tjänstelistor per område |
| `src/content/projects.ts` | Egna produkter (portfolio) |
| `src/content/cases.ts` | Kundcase |
| `src/content/home.ts` | BERRYiT HEMMA: tjänsteområden, besöksexempel, smart hem, RUT-text, Sunvolt |

Kontaktformulärets val och valideringsschema: `src/lib/contact.ts` (delas av klient och API).
Metadata-hjälpare: `src/lib/seo.ts`.

## Routes

| Route | Innehåll |
|---|---|
| `/` | Startsida |
| `/it-teknik` `/ljud-ljus` `/webb` `/appar-system` | Tjänsteområden |
| `/hemma` | BERRYiT HEMMA – privat/hem-erbjudandet (tjänster, samma besök, RUT, smart hem, Sunvolt) |
| `/teknikhjalp-hemma` · `/smart-hem` · `/rut-avdrag` | Hemma-undersidor |
| `/privat` | 308-redirect till `/hemma` |
| `/foretag` (inkl. automation & AI) · `/om` | Målgrupper / om |
| `/projects` | Egna produkter + kundcase (`#cases`) |
| `/projects/[slug]` | Produktsida |
| `/cases/[slug]` | Kundcase: Problemet → Lösningen → Vad BERRYiT gjorde → Teknik → Resultatet |
| `/cases` | Redirect till `/projects#cases` |
| `/kontakt` | Stegvist formulär: Hemma / Företag → flera områden → läge. `?kund=hem|foretag&area=<område>&intent=<läge>` förväljer val |
| `/api/contact` | POST – validerar (zod) och vidarebefordrar till webhook |
| `/sitemap.xml` `/robots.txt` `/icon.png` `/apple-icon.png` | Genereras |

### Dynamiska projekt och case

Lägg till en post i `projects.ts` eller `cases.ts` – ingen ny route behövs. Posten får automatiskt:
statiskt genererad sida (`generateStaticParams`), metadata/canonical, kort på listsidor och sitemap-post.
Okänd slug ger 404 (`notFound()`). Slugs måste vara unika.

Fält utan verifierad information (logotyp, screenshots, plattform, teknik, status, länk, resultat) lämnas
tomma och döljs automatiskt i gränssnittet.

## Varumärke

Logotypen ligger i `brand/` (original + genererade varianter, se `brand/README.md`).
Sajten använder mörk-bakgrundsvarianten (`src/assets/brand/berryit-logo-dark.png`) via `src/components/Logo.tsx`.
Favicon/app-ikon (`src/app/icon.png`, `apple-icon.png`) och delningsbild (`public/brand/berryit-og.png`) är
genererade från originalet. Accentfärgen `--berry` är logons röda `#C10C43`.

**BERRYiT HEMMA** är en sekundär lockup (masterlogo + "HEMMA" på samma baslinje, tunn takvinkel i logoröd) –
`src/components/hemma.tsx` → `HemmaLockup`. Masterlogon ändras aldrig. **Sunvolt** ingår aldrig i BERRYiT-logon;
samarbetet visas i en separat partneryta (`SunvoltPartner`). Ingen godkänd Sunvolt-logotyp finns – namnet visas som text.

**Bekräftat av ägaren (2026-09-22):** BERRYiT har F-skatt (`site.fSkatt`, visas på `/rut-avdrag` och i footern)
och får skriva "I samarbete med Sunvolt".

**RUT:** texterna följer Skatteverkets villkor för fiber- och it-tjänster (kontrollerat 2026-09-22) och lovar aldrig
att en tjänst automatiskt omfattas. Material, utrustning och resor omfattas inte. Inga procentsatser/tak anges.

## Tema (mörkt / ljust)

Mörkt är standard. Färger är semantiska tokens i `src/app/globals.css` (`ink`, `paper`, `muted`, `line`, `field`, `fog` …)
med värden för `[data-theme="dark"]` och `[data-theme="light"]`; `--berry` (#C10C43) är samma i båda.
`src/lib/theme.ts` innehåller ett litet skript som körs i `<head>` före första rendering: sparat val
(`localStorage: berryit-theme`) → annars `prefers-color-scheme` → annars mörkt. `ThemeToggle` i headern växlar och sparar.
Logotyper och HEMMA-lockup renderas i båda godkända varianterna och CSS visar rätt (`.on-dark-only` / `.on-light-only`).
Projektytor är låsta till mörkt (`data-theme="dark"`) eftersom varumärkesnamnen visas i egna accentfärger.

## Innehållsregel

Inga påhittade uppgifter. Telefon, e-post, org.nr, adress, kundresultat, KPI:er, testimonials,
certifieringar och partnerskap publiceras bara när ägaren har bekräftat dem.
Egna produkter (ONARLY, ONARLY DRIVE, QabGo, …) visas som exempel på vad vi byggt/utvecklar; varje
varumärke behåller sin egen identitet och ingen får märkas som lanserad utan verifiering.

## Kända placeholders (TBD)

- Telefon, e-post, org.nr, adress – `src/content/site.ts` (`contact`)
- Logotyper, screenshots, plattform, teknik och status per produkt – `src/content/projects.ts`
  (produktkorten visar tills vidare en genererad yta i varumärkets accentfärg)
- AuroraPark-case: resultat först efter lansering och kundens godkännande – `src/content/cases.ts`
- Mottagare bakom `CONTACT_WEBHOOK_URL`
- Sunvolt: godkänd logotyp och webbadress (formuleringen "I samarbete med Sunvolt" är godkänd)

## Blockers innan live

1. Kontaktmottagare + `CONTACT_WEBHOOK_URL`
2. Verifierade kontaktuppgifter (minst e-post) och org.nr
3. Integritetstext (formuläret samlar personuppgifter och filer)
4. Rate limiting på `/api/contact` (idag endast honeypot + validering)
5. `NEXT_PUBLIC_SITE_URL`, hosting, domän/DNS – separat deployment-gate
