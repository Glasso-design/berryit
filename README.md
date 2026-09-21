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

Kontaktformulärets val och valideringsschema: `src/lib/contact.ts` (delas av klient och API).
Metadata-hjälpare: `src/lib/seo.ts`.

## Routes

| Route | Innehåll |
|---|---|
| `/` | Startsida |
| `/it-teknik` `/ljud-ljus` `/webb` `/appar-system` | Tjänsteområden |
| `/foretag` (inkl. automation & AI) · `/privat` · `/om` | Målgrupper / om |
| `/projects` | Egna produkter + kundcase (`#cases`) |
| `/projects/[slug]` | Produktsida |
| `/cases/[slug]` | Kundcase: Problemet → Lösningen → Vad BERRYiT gjorde → Teknik → Resultatet |
| `/cases` | Redirect till `/projects#cases` |
| `/kontakt` | Stegvist formulär. `?area=<område>&intent=<läge>` förväljer val |
| `/api/contact` | POST – validerar (zod) och vidarebefordrar till webhook |
| `/sitemap.xml` `/robots.txt` `/icon.svg` | Genereras |

### Dynamiska projekt och case

Lägg till en post i `projects.ts` eller `cases.ts` – ingen ny route behövs. Posten får automatiskt:
statiskt genererad sida (`generateStaticParams`), metadata/canonical, kort på listsidor och sitemap-post.
Okänd slug ger 404 (`notFound()`). Slugs måste vara unika.

Fält utan verifierad information (logotyp, screenshots, plattform, teknik, status, länk, resultat) lämnas
tomma och döljs automatiskt i gränssnittet.

## Innehållsregel

Inga påhittade uppgifter. Telefon, e-post, org.nr, adress, kundresultat, KPI:er, testimonials,
certifieringar och partnerskap publiceras bara när ägaren har bekräftat dem.
Egna produkter (ONARLY, ONARLY DRIVE, QabGo, …) visas som exempel på vad vi byggt/utvecklar; varje
varumärke behåller sin egen identitet och ingen får märkas som lanserad utan verifiering.

## Kända placeholders (TBD)

- Riktig BERRYiT-logotyp – nu ett typografiskt ordmärke (`src/components/Logo.tsx`) och en enkel `icon.svg`
- Telefon, e-post, org.nr, adress – `src/content/site.ts` (`contact`)
- Logotyper, screenshots, plattform, teknik och status per produkt – `src/content/projects.ts`
  (produktkorten visar tills vidare en genererad yta i varumärkets accentfärg)
- AuroraPark-case: resultat först efter lansering och kundens godkännande – `src/content/cases.ts`
- OpenGraph-bild
- Mottagare bakom `CONTACT_WEBHOOK_URL`

## Blockers innan live

1. Kontaktmottagare + `CONTACT_WEBHOOK_URL`
2. Verifierade kontaktuppgifter (minst e-post) och org.nr
3. Integritetstext (formuläret samlar personuppgifter och filer)
4. Rate limiting på `/api/contact` (idag endast honeypot + validering)
5. Riktig logotyp
6. `NEXT_PUBLIC_SITE_URL`, hosting, domän/DNS – separat deployment-gate
