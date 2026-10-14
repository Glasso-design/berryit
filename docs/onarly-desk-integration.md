# ONARLY DESK i Support Desk (PASS 2G)

ONARLY DESK använder den installerade RustDesk-klienten. BerryIT har inget
verifierat serverbaserat sessions-API. Connectorn gör därför inga HTTP-anrop,
rapporterar aldrig att en faktisk anslutning är aktiv och behöver ingen token.

## Det som registreras

- Enheter kopplas till en befintlig kundorganisation och har ett numeriskt
  RustDesk-ID. Teknikern kopierar ID:t och öppnar själv den installerade klienten.
- En sessionsbegäran kopplas till ett befintligt ärende, en enhet och ansvarig
  tekniker. Organisationerna måste matcha. Aktiv DESK-rättighet krävs.
- Teknikern registrerar manuellt kundgodkännandets metod och anteckning, därefter
  manuell start och avslut. Databasen tidsstämplar varje steg och skriver
  oföränderlig sessionshistorik samt `support_admin_audit`.
- Varje session har `provenance = manual` och
  `actual_connection_status = unknown`. Kundens faktiska godkännande i RustDesk
  krävs fortfarande. En BerryIT-post kan aldrig bekräfta anslutningen.

Åtkomst styrs av befintliga `tickets.*`-grants, RLS och
`onarly_support_entitlements` (`onarly_desk` / `remote_support`). Externa
konsulter använder `support_role_grants` med organisationsscope, obligatorisk
utgångstid, företag och uppdragsgivande organisation. Uppdragsgivaren kan vara
en annan organisation än kunden; scope gäller alltid kunden. Återkallelse och utgång
gäller direkt. Ingen ny global roll införs.

Privatkunder har i dag ärenden utan `organization_id`. DESK-rättigheter är
organisationskopplade, så privatkundsstöd kräver en separat ändring av den
befintliga kund- och rättighetsmodellen. Ingen parallell kundmodell skapas här.

## Framtida verifierad integration

Ett framtida API måste dokumentera autentisering, kund- och enhetsidentitet,
sessions-ID, serververifierade start/slut-händelser, kundgodkännande och
idempotent händelseleverans. En separat aktivering och säkerhetsgranskning
krävs innan sådana data får märkas automatiskt verifierade.

## Lokal verifiering

`npm run db:test` kör migrationer och RLS-tester i en ny, tillfällig PGlite-
databas. Det ansluter inte till Supabase och raderar inga konton. Filerna
`seed-users.mjs` och `seed.mjs` finns inte i denna repoarbetsyta eller dess
Git-historik; ingen kod för generell `E2E%`-rensning finns i repot.
