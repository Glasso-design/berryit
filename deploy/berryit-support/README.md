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
./registration-check.sh         # skrivskyddad: halvregistrerade kundkonton (exit 3 = träffar)
./stack.sh down                 # stoppar, behåller volymer
```

Superanvändaren i `supabase/postgres` är **`supabase_admin`** (rollen `postgres`
är degraderad i imagen). Alla skript använder den som standard.

### Migrering med låsgräns

`migrate.sh` kör varje fil i **en** transaktion (`psql --single-transaction`, även
när SQL läses från stdin; verifierat med psql 16 och 17). Migreringar som tar lås
på `auth.users` begränsar därför först i filen `lock_timeout` till **högst 2 s** och
`statement_timeout` till högst 60 s, för just den transaktionen. Har operatören
redan satt ett kortare värde behålls det (MASTER PASS 3, fynd F-B6), t.ex.
`{ echo "set local lock_timeout = '1s';"; cat <fil>; } | … psql --single-transaction`.
Filen vägrar köra utanför en transaktion (SQLSTATE `25P01`, ingenting ändras). Skälet: en migrering som *väntar* på sitt lås ställer alla nya
skrivningar på tabellen i kö bakom sig, även GoTrues inloggningar
(`last_sign_in_at`). Utan tidsgräns står inloggningarna still tills den
blockerande transaktionen är klar.

`20261029090000_registration_gotrue_metadata.sql` tar `ShareRowExclusiveLock` på
`auth.users` (`create or replace trigger`). Läsare påverkas inte; skrivare väntar
högst 2 s (uppmätt: en inloggning som köar bakom en väntande migrering tar ≈1 s
i stället för ≈4 s med den tidigare gränsen 5 s).

Om `migrate.sh` avbryts med `canceling statement due to lock timeout`
(SQLSTATE `55P03`):

1. Ingenting av den migreringen är applicerat: hela transaktionen, även raden i
   `public.schema_migrations`, är tillbakarullad. Tidigare migreringar i samma
   körning är redan klara och hoppas över nästa gång.
2. Se vad som blockerade (skrivskyddat):

   ```bash
   docker exec -i berryit-support-db psql -U supabase_admin -d postgres -c \
     "select pid, usename, application_name, state, now() - xact_start as xact_age, left(query, 80) as query
        from pg_stat_activity
       where pid in (select unnest(pg_blocking_pids(pid)) from pg_stat_activity)
          or (state like 'idle in transaction%' and xact_start < now() - interval '1 minute');"
   ```

3. Vänta tills den transaktionen är klar. Avbryt den inte utan att veta vad den
   är (`pg_cancel_backend` bara efter beslut).
4. Kör `./migrate.sh ../../supabase/migrations` igen. Försöket är säkert att
   upprepa: migreringen är idempotent och ledgern skrivs bara när allt lyckats.
5. Slår gränsen till upprepade gånger: kör i ett servicefönster med låg trafik.
   Höj inte tidsgränsen i migreringsfilen.

Återställning finns i `../../supabase/rollback/20261029090000_registration_gotrue_metadata_rollback.sql`.
Den har egen `BEGIN`/`COMMIT` och körs som `supabase_admin`:

```bash
docker exec -i berryit-support-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f - \
  < ../../supabase/rollback/20261029090000_registration_gotrue_metadata_rollback.sql
```

Den vägrar innan något ändras om rollen varken är superuser eller ägare av
`auth.users`, eller om någon av de två funktionerna inte har exakt den repeterade
kroppen (md5-vakt). Den tar `AccessExclusiveLock` på `auth.users` (även läsare
väntar), väntar därför högst 2 s (kortare operatörsvärde behålls), återställer
`audit_support_registry_changes()` och tar bort ledger-raden i samma transaktion
så att `migrate.sh` kan applicera igen. En andra körning är ofarlig.

### GoTrue- eller Supabase Auth-uppgradering med BERRYiT-triggers

BERRYiT har triggers på `auth.users` (`auth_user_created`, och
`auth_user_registration_metadata` som är `after update of raw_app_meta_data`).
Kolumnlistan är avsiktlig: funktionen körs bara när app_metadata ändras, inte vid
varje inloggning. Den skapar ett beroende i `pg_depend`, så en GoTrue-migrering som
gör `ALTER COLUMN raw_app_meta_data TYPE …` eller `DROP COLUMN` på kolumnen
misslyckas så länge triggern finns.

Därför gäller:

- **Varje** uppgradering av GoTrue/Supabase Auth (image-tagg i `compose.yaml`, eller
  hostad Supabase Auth) repeteras först på en kopia med triggrarna på plats, aldrig
  direkt i drift: `./restore-test.sh`-kopia eller isolerad teststack →
  `migrate.sh` → byt GoTrue-image → låt GoTrue köra sina migreringar → kontrollera:
  1. GoTrue startar och `/auth/v1/health` visar den nya versionen;
  2. `auth.schema_migrations` har fått de nya versionerna;
  3. triggern finns kvar och är aktiv
     (`select tgenabled from pg_trigger where tgname = 'auth_user_registration_metadata'` ger `O`);
  4. en kundregistrering via `/api/control/customers` ger organisation,
     aktiveringsspärr, registrar och **exakt en** audit-rad, och en nekad
     registrering (aal1-session) lämnar noll rader.
- Läs GoTrue-versionens migreringar innan uppgraderingen. Rör någon av dem
  `raw_app_meta_data` med `ALTER`/`DROP`: kör återställningen ovan före GoTrue-
  uppgraderingen och `migrate.sh` (framåt) efteråt.
- CI repeterar detta på varje masterpass-körning: stacken startar med
  `supabase/gotrue:v2.196.0`, får migreringarna och uppgraderas sedan till den
  version som supabase CLI pinnar (`MP2_GOTRUE_UPGRADE_IMAGE`, nu `v2.197.0`;
  testet M3 i `tests/masterpass1/ops.e2e.mjs`).

### Halvregistrerade kundkonton

`./registration-check.sh` listar konton som registrerades via
`/api/control/customers` innan `20261029090000` fanns, där profilen saknar
organisation, aktiveringsspärr, registrar eller audit-rad. Kontrollen är
skrivskyddad och reparerar ingenting. Kör den på varje stack där
`20261014235633_complete_support_workflow.sql` redan applicerats. Hantering av träffar:
`../../docs/masterpass2-registration-check.md`.

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
