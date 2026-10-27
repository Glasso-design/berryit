# ONARLY Platform Factory — local review V1

## PASS 2 provider implementation (2026-10-25)

Concrete Cloudflare account/R2/DNS/routing adapters, SigV4 multipart quota broker,
TLS verifier, separately gated transactional sending and provider-status UI now
extend this implementation. See [contracts and remaining activation gates](../../docs/platform-factory/pass2-providers.md).
Real provider traffic remains denied by default; job execution and SQL remain
MOCK-only. Local/synthetic verification is not live Cloudflare, MFA/SSO or
external backup verification. No real account, DNS record or mail was created.
Run `npm run test:factory` and `npm run test:factory-ui` for the expanded suite.
The separate owned PostgreSQL/QABGO test is `tests/provider-postgres.test.mjs`
with the same explicit environment/metadata guards documented below.

Central engine, not a provisioning copy in every product. BerryIT supplies the
existing authenticated identity, project/organization scope, dynamic
permissions, MFA and append-only support audit. The Hub product IDs are
referenced by the capability overlay in `registry.mjs`.

**Live provisioning is disabled in code and SQL.** `READY` on a MOCK job means
`instances.status = SIMULATED`, never a deployed or healthy customer service.
QABGO remains `ADAPTER_IN_DEVELOPMENT`. No product is live-approved.

## Boundaries

```
BerryIT web / Desktop shared FactoryWorkspace
  → verified user RPC (web: existing supportActor → POST /api/control/factory)
  → public.factory_* authorization → existing has_resource_permission
  → durable factory.jobs / instances / resources / audit
  → separate server worker with fenced leases and fresh authorization
  → reviewed product adapter → allowlisted provider
```

Hub and QABGO administration only open this central interface. No product token
is passed in a URL or exchanged implicitly. Configure `VITE_FACTORY_CONTROL_URL`
only after approving the central HTTPS origin. Missing configuration is BLOCKED.
Cross-product SSO and real Supabase HTTP/MFA were not verified by this pass.

`db/001_factory.sql` is an atomic **isolated-test installation script**, outside
`supabase/migrations`. It requires `factory.install_environment=isolated-test`
and the existing complete BerryIT project/role schema. It must not be added to
the blocked production upgrade chain or run on production. It adds four
server-defined permissions, uses existing roles/grants, and grants no customer,
developer or technician implicit provisioning access.

`worker.mjs` composes the persistent SQL queue and MOCK provider. Its explicit
environment gate rejects unknown/production configuration. A browser neither
executes nor schedules provisioning. Resume keeps the same job and stable
provider idempotency keys. SQL claims use SKIP LOCKED, expiring leases and
revision fencing. Role/account/session revocation is checked before each step.
Technical/external checks cannot be ticked off by a manual RPC.
Product add-ons come from that adapter's server-defined checklist. Selected
add-ons become mandatory external blockers; they do not activate agreements,
payments, subscriptions or new permissions.

## Providers and resource safety

- `providers/mock.mjs`: durable resources and injected faults, no network/shell.
- `providers/cloudflare.mjs`: reviewed account/R2/DNS/email HTTP request plans;
  injected MOCK transport only, no global fetch or live activation switch.
- Tenant, limited standalone and managed-resource modes are explicit. Missing
  dedicated account capability blocks; there is no shared-account fallback.
- Routing requires a verified destination. Mailboxes and transactional sending
  require separate provider approval. Routing is never described as an inbox.
- Default object quota for **new** platforms: **1 GB (1,000,000,000 bytes)**.
  Existing instances keep their stored quota; an explicitly configured larger
  quota remains supported. API, UI and adapters share the same default.
  SQL locks reservations before
  upload, trusts worker-observed size, quarantines oversized objects, and keeps
  ambiguous reservations charged. Complete inventories reconcile usage;
  warnings count used plus reserved bytes at 80/90/100 percent.
- `providers/local-storage.mjs` stores real synthetic bytes in an isolated SQL
  namespace. It verifies object ownership/checksum and actual size. This proves
  the local quota/isolation contract, not real R2 IAM or multipart behavior.
- Database, runtime, backup and logs are separate from the object quota. R2's
  shared free tier is not treated as 10 GB free for each instance.
- `providers/backup.mjs`: bounded AES-256-GCM archive with authenticated identity,
  complete DB/object/config parts and SHA-256 checksums. Recovery keys remain
  separate from the archive. The PostgreSQL test restores real synthetic data,
  product runtime keys and least-privilege ACLs to a **new** owned database,
  persists restored object bytes and verifies runtime health and login.
- Cleanup is a scoped review only. No automatic deletion exists. Upgrade,
  suspend, backup and restore requests are recorded as WAITING_FOR_APPROVAL;
  no operational action runs from the UI.

## QABGO template

Base: `Glasso-design/ONARLY-DRIVE` commit
`01d27b5ccd9e669d8dfb8e3fe9f785332a35d397`.
The template pins 124 Core files, 19 immutable migrations and 275 frontend/shared
files. It includes an explicitly local-review-only two-file Factory UI overlay.
This is **not** a signed production release approval.

The local operator fixture uses the existing product services and migrations,
never `.env`, pilot seeds or a source database. It creates distinct database
owners/app credentials, runtime keys and loopback runtimes. The existing
ONARLY profile is linked to a disabled product identity; synthetic tests activate
it explicitly without mail. Drivers/customers/bookings/vehicles are empty before
test fixtures are added. No prices, payment agreements or business integrations
are invented. Company information and approved pricing remain manual blockers.

## Reproduce local checks (workspace root, Node 24)

```
npm run test:factory
npm run test:factory-ui
npm run db:test
npm run test:support-workflow
npm run test:project-access
npm run test:ai-diagnostics
npm test --prefix desktop
npm run lint
npm run typecheck
npm run build
npm run build --prefix desktop
npm run test:desktop-connection
```

`build` uses the documented Next.js Webpack path. Run `typecheck` and the web
build sequentially: both generate `.next/types`. Generated `test-results`
artifacts are excluded from lint/typecheck; current application/test sources are
still included. No dependencies or development tools were installed.

The real PostgreSQL test is optional and separately gated. On this workstation
it reuses existing PostgreSQL 16 binaries without touching another cluster:

```
powershell -NoProfile -File services/platform-factory/tests/postgres/start.ps1 -Environment isolated-factory -Port 19840 -Directory C:\projects\berryit\test-results\platform-factory-20261024\postgres-NEW-UNIQUE-RUN
node services/platform-factory/tests/build-qabgo.mjs --environment=isolated-factory-build
node services/platform-factory/tests/local-qabgo.test.mjs --environment=isolated-factory-postgres --metadata=C:/projects/berryit/test-results/platform-factory-20261024/postgres-NEW-UNIQUE-RUN/connection.local.json
node services/platform-factory/tests/postgres/stop.mjs --environment=isolated-factory-postgres --metadata=C:/projects/berryit/test-results/platform-factory-20261024/postgres-NEW-UNIQUE-RUN/connection.local.json
```

Choose a vacant port and new directory; the starter refuses reuse. Protected
metadata contains synthetic credentials: **never commit, print or publish it**.
The source path in local tests is operator configuration for the reviewed QABGO
worktree. Production URLs cannot be submitted through the Factory form.
Stop verifies the run marker, directory, port and absence of other client
sessions. It stops only the owned test cluster and deletes nothing.

## Add the next product without another engine

1. Resolve its canonical Hub product identity and approved SaaS distribution.
   Unsupported desktop clients/games remain NOT_PROVISIONABLE.
2. Supply a versioned, checksum-pinned clean template; exclude customer data,
   `.env`, source secrets, sessions and pilot seed/pricing data.
3. Implement the adapter contract in `contract.mjs`: six resource profiles,
   supported versions, DAG checklist and nine operation methods. Unsupported
   operations must fail closed rather than execute a generic shell command.
4. Register it with ProductRegistry and the capability overlay. Unknown versions
   must remain denied by SQL. Installing catalog metadata is a separate operator
   task and does not grant users permissions or live approval.
5. Run the common security/idempotency/quota/restore tests with two owners and
   isolated resources, then product-specific HTTP/browser tests. `sdk.test.mjs`
   demonstrates a second synthetic adapter using the unchanged engine.
6. Add only a central Factory entry point to the product admin panel. Reuse
   FactoryWorkspace/API; do not copy the engine, grants or customer registry.
7. Obtain separate release, provider capability, budget, backup/recovery and
   staging approvals before any live activation. No switch in this local package
   bypasses those gates.

Recommended next adapter: VISI after its Auth/Storage/data-residency review.
HQ/ARENAHUB need an identity/distribution decision first. Hub/Radio, Printhaus
and BerryIT follow their clean-template and backup gates. PrintBuddy/DESK require
an approved SaaS model; they are not automatically server products.
