# PASS 2G: verifierad byggväg

Next.js 16.3.5 använder Turbopack som standard. På den lokala Windows-miljön
med Node.js 24.19.0 och npm 11.17.0 avbryts `next build` med exitkod 1 när
Turbopack bearbetar `src/app/globals.css` genom PostCSS. Den interna orsaken är
`evaluate_webpack_loader` → `creating new process` → `node process exited before
we could connect to it with exit code: 0`; barnprocessens stdout/stderr är tomma.
Samma fel har uppstått både i begränsad och förhöjd körning. Ett enkelt Node.js-
barnprocessanrop fungerar. Det går därför inte att tillskriva felet ett generellt
förbud mot barnprocesser. Endast Node.js 24 finns installerad här, så en möjlig
versionsspecifik orsak är inte utesluten.

`next build --webpack` bygger samma applikationskod, CSS och routes till en
produktionsartefakt. Next.js dokumenterar `--webpack` som en stödd opt-out från
Turbopack för produktionsbyggen. `npm run build` använder därför explicit Webpack.
Ingen produktdesign eller applikationskod ändrades för detta. CI kör samma kommando
med Node.js 24 på Ubuntu; CI-resultatet måste följas upp på GitHub efter push.

Security & CI Repair Gate 2026-10-14: `npm run typecheck` kör nu automatiskt
`next typegen` genom `pretypecheck`. Det skapar `next-env.d.ts` och route-typer
innan `tsc --noEmit`, även i en ren checkout. Genererade filer ska fortsatt
vara ignorerade av Git. Typkontroll och Webpack-produktionsbygge har verifierats
efter att `.next`, `next-env.d.ts` och TypeScripts inkrementella cache tagits bort.
Webpack är fortsatt den explicita produktionsvägen; ingen Turbopack-återtestning
eller ändring av design, typsnitt eller paketversion har gjorts i reparationspasset.

Google Fonts hämtas under byggtiden av Next.js. Om nätåtkomsten till Google Fonts
saknas avbryts även Webpack-bygget; det ska rapporteras som ej verifierat i den
miljön. En fullständig produktionsbuild har verifierats lokalt med nätåtkomst.

Testkommandona `db:test` och `db:upgrade-test` kör endast nya PGlite-databaser
i minnet. De kräver explicit `--environment=isolated-pglite` och avbryter om
extern databaskonfiguration finns. Inga cleanup-kommandon finns. Deras
negativa skyddstester körs med `npm run db:safety-test`.

De äldre filerna `seed-users.mjs` och `seed.mjs` finns varken i repositoryt
eller dess Git-historik. Deras tidigare beteende kan därmed inte granskas som
åtgärdat. De får inte köras utanför denna versionshanterade testväg.
