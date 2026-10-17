# BERRYiT Support Desk – självhostad stack (PASS 1C)

Isolerad backend på `prod-node-01` med eget compose-projekt, nätverk, volymer, secrets och databas.
Den valfria AI-adaptern gör ett autentiserat server-till-server-anrop till ONARLY AI Gateway utan att dela lagring eller administrativa hemligheter med Desktop.

| | |
|---|---|
| Värd | `prod-node-01` (OVH), `/home/ubuntu/berryit-support/deploy/berryit-support` |
| Compose-projekt | `berryit-support` |
| Nätverk | `berryit-support-net` |
| Volymer | `berryit-support-db-data`, `-storage-data`, `-gateway-data` |
| Publik exponering | **ingen** – gatewayen binder `127.0.0.1:8700` |
| Databas | aldrig exponerad, endast internt i nätverket |

## Tjänster

| Container | Image | Roll |
|---|---|---|
| `berryit-support-db` | supabase/postgres:17.6.1.136 | PostgreSQL med Supabase-rollerna |
| `berryit-support-auth` | supabase/gotrue:v2.196.0 | Auth/JWT, inbjudningsbaserad, MFA (TOTP) på |
| `berryit-support-rest` | postgrest/postgrest:v14.12 | REST-API ovanpå RLS |
| `berryit-support-storage` | supabase/storage-api:v1.60.4 | Privata bilagor + signed URLs |
| `berryit-support-gateway` | caddy:2.11-alpine | Intern gateway (`/auth/v1`, `/rest/v1`, `/storage/v1`) |

Next.js-appen körs **inte** här ännu – den läggs till när portalen byggs (PASS 2).
Images byggs aldrig på servern; de hämtas färdiga från registry.

## Drift

```bash
./generate-secrets.sh           # en gång; skapar secrets/stack.env (0600 i 0700)
./stack.sh up                   # hämtar images och startar
./stack.sh ps | logs | resources
./migrate.sh ../../supabase/migrations
./security-gate.sh              # endast separat isolerad och märkt teststack
./backup.sh                     # databas + filstorage
./restore-test.sh               # återställer till tillfällig databas och verifierar
./stack.sh down                 # stoppar, behåller volymer
```

Superanvändaren i `supabase/postgres` är **`supabase_admin`** (rollen `postgres`
är degraderad i imagen). Alla skript använder den som standard.

## Säkerhet

- Inga publika portar. Åtkomst sker via SSH/Tailscale tills DNS och proxy beslutas.
- Secrets genereras på värden, ligger `0600` i `0700`-katalog och kopieras aldrig
  från någon annan stack.
- `anon` saknar rättigheter på applikationstabellerna; RLS gäller för `authenticated`;
  `service_role` används bara server-side.
- Publik självregistrering är avstängd (`GOTRUE_DISABLE_SIGNUP=true`).
- Bilagor ligger i en privat bucket och nås via signed URLs. Storage-policyn visar
  bara filer som är registrerade som kundsynliga bilagor på ett ärende användaren får se.
- Alla tabeller i `public` har RLS, inklusive `schema_migrations`.

## Backup

`security-gate.sh` kräver `BERRYIT_TEST_ENV=isolated`, ett separat
`BERRYIT_TEST_PROJECT`, `BERRYIT_TEST_STACK_ID` (UUID), en separat nyckelfil och
en testgateway på annan port än 8700. Testdatabasen måste ha motsvarande
`berryit.test_environment=isolated` och `berryit.test_stack_id` som
databasinställningar. Skriptet avbryter innan någon testdata skapas om
teststacken inte kan verifieras. Cleanup sker endast efter godkända kontroller
och för ID:n skapade i samma körning; vid fel lämnas data kvar i teststacken.
Det befintliga projektet `berryit-support` på `prod-node-01` nekas alltid.

`backup.sh` gör `pg_dump -Fc` av databasen och en tar av storage-volymen till
`./backups` (umask 077, SHA-256-manifest, ingen automatisk gallring). `restore-test.sh` återställer senaste
dumpen till en tillfällig databas, kontrollerar tabeller, policies och RLS, och
släpper endast den databas som samma körning skapat och ägarmärkt.
Ett fel från `pg_restore` avbryter nu grinden; en delvis lyckad återställning
räknas aldrig som PASS. SQL och migrationsledger skrivs i samma transaktion.
Detta bevisar inte att DB-dump och filstorage är en konsistent gemensam snapshot.
Den fullständiga backup-/restore-grinden finns i `../../docs/master-integration-pass1-2026-10-16.md`.

**Offsite-backup är BLOCKED.** Destinationen är inte beslutad, så backupen finns
bara på samma värd som databasen. Stacken är därför **inte produktionsklar**.
Nästa steg kräver: val av offsite-mål, kryptering (t.ex. age/gpg), schemalagd
överföring och ett restore-test från offsite-kopian.

## Control Center readiness

Stacken är byggd som grund för BERRYiT IT Control Center. Så här är den förberedd –
**ingenting av detta är implementerat än**, och ingen integration är aktiverad:

| Område | Vad som redan finns | Vad som saknas |
|---|---|---|
| Centralt kundregister | `organizations`, `profiles` med organisationstillhörighet och kontaktperson | kundkort, adresser, avtalsdata |
| Projektregister | – | egen tabell; kopplas till `organizations` |
| IT Support Desk | komplett datamodell, RLS, auktoritetsmodell, bilagor, historik | portal- och teknikergränssnitt (PASS 2–3) |
| ONARLY AI Gateway | services/onarly-ai-adapter + /ai/v1-route finns i repo | migration, image, secrets och compose-profil måste aktiveras före drift |
| Chatt och AI-bottar | `ticket_messages` har `is_from_staff` och författare | kanal/bot-identitet, samtyckeshantering |
| Infrastruktur och monitoring | containrar är namngivna och isolerade; `uptime-kuma` finns på värden | egna healthchecks och mätpunkter för BERRYiT |
| GitHub/Vercel | – | läsande integrationer, egna tokens, aldrig i klienten |
| ONARLY DESK fjärrsupport | `onarly_support_entitlements` som beslutsregister + revision | faktisk koppling mot ONARLY DESK; kräver separat godkännande |
| Centralt aktivitetsflöde | `ticket_events` och `support_admin_audit` (append-only) | sammanslagen vy över flera källor |

Principen är att BERRYiT är **auktoritet för support**, medan varje ONARLY-produkt
behåller sin egen åtkomstkontroll för produktdriften.


## ONARLY AI-adapter

Adaptern är en separat servergräns och delar inga providerhemligheter med
Desktop. Bygg imagen utanför produktionsservern, sätt värdena från
onarly-ai.env.example i den skyddade stack.env och aktivera sedan explicit:

    ./migrate.sh ../../supabase/migrations
    docker compose --profile onarly-ai up -d ai-adapter gateway

Kommandona ovan är en runbook och körs inte av repositorytesterna. Se
../../docs/onarly-ai-assistant.md för endpoint-, behörighets- och
verifieringskontrakt.
