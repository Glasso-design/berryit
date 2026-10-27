# Platform Factory PASS 2 — provider contracts and activation gates

2026-10-25. Extends the existing Factory, SQL registry, grants, QABGO adapter,
worker and shared UI. MASTERPASS evidence remains unchanged.

## Execution boundary

CloudflareApiClient and R2S3Provider implement real HTTPS contracts. Their
default authorizers deny traffic. Tests use synthetic credentials/transports;
HTTP tests remap the fixed provider hostname to their own loopback server.
No real Cloudflare credential was loaded or live provider called.

The existing ProviderRegistry accepts HTTP_PROVIDER for discovery/inspection.
Its job selector, FactoryEngine and isolated SQL still enforce MOCK. Production
schema/worker promotion needs a separate reviewed release after the gates below.
Neither a UI choice nor a signed review bypasses this deployment boundary.

The future operator host supplies a server secret-store and ProviderActivation's
authorizer. Its Ed25519 trust anchor is server configuration. A signed manifest
binds exact write paths/intents/input hashes, account/zone allowlists, code SHA,
an expiry of at most one hour, and approved HTTP/MFA/SSO, external encrypted
backup and restore evidence hashes. No live signed approval is supplied here.
Product R2 uses its own fixed binding and quota-broker authorization; the generic
account activation gate cannot authorize product object writes.

## Account, DNS, TLS and email

| Capability | Concrete contract and safeguards |
|---|---|
| Tenant | GET /user/tenants with explicit partner X-Auth-Email/X-Auth-Key; verified unit and separate recent provisioning-entitlement attestation |
| Dedicated managed account | POST /accounts with unit.id, external_metadata ownership marker and stable Idempotency-Key |
| Standalone | POST /accounts, standalone=true, user-owned Bearer token; verified age/email/Super Administrator membership and separately verified remaining allowance |
| Managed resources | Approved existing account, explicitly not a dedicated account |
| Tokens | Correct user/account /tokens/verify endpoint; active/not-before/expiry and local revocation checks on every retry |
| R2 bucket | POST /accounts/{id}/r2/buckets; deterministic instance name; cf-r2-jurisdiction=eu/us; EU is a jurisdiction, not a location hint |
| DNS | Active approved zone/account; exact instance CNAME, ownership comment/tag; collisions refuse adoption |
| Routing | Verified destination in account; exact instance email domain; literal matcher/forward action; no mailbox claim |
| Transactional mail | POST /accounts/{id}/email/sending/send; separate beta entitlement, SPF/DKIM/DMARC verification and per-message approval; ambiguous send is not retried |
| Mailbox | NOT_AVAILABLE unless a separate approved provider is configured |
| TLS | Approved hostname, public DNS address pinned to443, WebPKI/hostname/expiry verification; private/mapped/link-local destinations denied |

Read probes only prove read capability. Write permissions remain UNVERIFIED.
Missing account eligibility fails closed; counting visible accounts does not
prove the standalone creation allowance. Tenant units do not themselves prove
paid entitlement. No credentials are inferred or downgraded to a broader kind.

ResourceRegistry persists intents before HTTP, verifies current job input,
instance, lease, session and permission, and uniquely registers external refs.
Changed input, competing leases and cross-instance reference collisions fail.
GET and documented idempotent account creation retry at most three times with
bounded backoff. Other mutation timeouts retain the original ambiguous intent.
DNS/routing reconcile exact ownership markers. Buckets have no ownership tags:
an ambiguous bucket create is MANUAL_RECOVERY, never name-based adoption or a
second bucket. No cleanup/delete is executed.

Changing a dedicated request to shared resources requires the separate
factory_approve_account_mode RPC, reason, current MFA and create/manage rights
in the actual job scope. The approval's session/current rights are rechecked
before use. There is no automatic fallback.

## R2 quota and multipart broker

Default logical quota for new platforms (updated 2026-10-25):
**1 GB (1,000,000,000 bytes)**. Existing stored instance quotas are unchanged;
explicitly configured larger quotas remain supported. The API, UI, QABGO
template and adapter use this default. No database backfill is required.
DB, runtime, backups and logs are
separate. This is not a Cloudflare spending cap/free allowance. Physical storage,
unfinished multipart parts and API operations can be billable. URL replay can
cause extra requests despite a fixed final object size.

The broker reuses factory.instances/upload_reservations. A row lock charges the
entire reservation before R2 initiation. The limited factory_broker DB role can
execute only two binding-authenticated RPCs and has no table/general worker
access. Its fixed binding contains an existing product tenant, instance, bucket,
jurisdiction and a hash of a random server-only secret. No parallel customer or
identity model is created. Revoked bindings reject the next broker operation.

qabgoStorageRoutes mounts on the existing QABGO router. Unchanged Core auth
reloads active session/membership/permissions. Routes require dispatch plus
sites.manage and the server's fixed tenant. Caller tenant/instance/account/bucket/
object-key/role fields are not accepted. Product users receive no central Factory
roles or R2 credentials. A future approved product host must mount this composition
and route its R2 flows through it; PASS2 changes no QABGO source.

1. Reserve immutable instance/key/subject/size atomically; max128 unfinished
   uploads per instance and32 per subject. There is no automatic cleanup.
2. Server initiates one MPU under instanceUUID/reservationUUID. An ambiguous
   initiate stays charged and requires manual provider reconciliation.
3. A120-second UploadPart URL binds method, bucket, key, upload ID, number,
   exact Content-Length and Content-MD5. It grants no PutObject, complete, list,
   delete or abort. A registered part digest cannot change. Non-final parts are
   8MiB. MD5 is supported by R2 UploadPart; SigV4 supplies authorization.
4. Server lists all parts/pages, checks size/digest/order, completes and verifies
   final HEAD size and instance/reservation metadata before committing once.
5. Lost completion response: after lease expiry, HEAD the same immutable object
   and commit once. No replacement MPU/object and no double counting.
6. Full paginated inventory uses a DB revision fence. Concurrent mutations reject
   stale inventories. Observed but unsettled reservations stop reconciliation;
   unknown objects block storage for review. Ambiguous reservations stay charged.

Warnings use used+reserved at80/90/100%. No destructive R2 operation is exposed.
Above100,000 objects, inventory raises INVENTORY_REQUIRES_BATCH_REVIEW rather
than returning incomplete success; larger instances need a reviewed batch path.
No lifecycle/public access/CORS change is made. Before real use, restrict S3
credentials to the bucket, disable public access and approve exact CORS origins
and signed headers. SigV4 matches AWS's published vector and is independently
checked by the synthetic HTTP server. Real R2 signature/CORS/header enforcement
and jurisdiction are still external verification gates.

## Schema and Control Center

db/002_provider_broker.sql is forward-only after001 and the existing BerryIT
migrations. Its isolated-test guard remains; it is not in the production chain.
Historical migrations are unchanged. New private RLS tables: account_mode_approvals,
external_accounts, provider_intents, provider_status, storage_bindings,
multipart_uploads and multipart_parts. Instances gain a storage revision fence.
No authenticated direct writes. Definers use empty search_path and minimal
EXECUTE grants. Never grant factory_broker to anon/authenticated.

FactoryWorkspace reads the scoped provider-status RPC: observation time,
verification class, account mode/approval, capabilities/missing permissions,
DNS/email/TLS, quota/warnings, resource intent states, cost estimate and blockers.
Bounded worker publication excludes raw provider payloads, policies, credentials,
signed URLs and destinations. Technical checklist verification cannot be changed
by the client. SYNTHETIC_HTTP does not mean LIVE_VERIFIED. Stale observations
need a new server check; cost estimates are not verified invoices.

## Separate HTTP/MFA/SSO gate — prepared, not run live

tests/http-identity-gate.mjs defines15 mandatory cases: login/invalid password,
aal1 denial, real TOTP aal2, revoked session, tenant/project manipulation,
Factory PostgREST action, forged technical evidence, internal Storage attachment
denial, ONARLY→Factory/QABGO SSO, cross-tenant/replayed assertions and revocation.
Every loopback tunnel endpoint must return the approved synthetic run marker.
The harness creates no stack/account/tunnel and accepts no production URL/data.
Missing real runner/evidence is BLOCKED. Its negative/mock test is explicitly
SYNTHETIC_HARNESS_PASS. Existing remote stacks were not inspected this pass;
this is not an assertion that they are absent.

The separately approved environment needs GoTrue/PostgREST/Storage, actual MFA
factors, trusted SSO issuer/product audiences, two synthetic organizations and
refresh/revocation tests. Approve that environment/tunnels and record ownership,
then implement its real runner against the15 cases. Local QABGO password HTTP
login is real, but proves neither Supabase TOTP nor ONARLY SSO.

## Before the first real QABGO instance

- Verify partner unit/entitlement, or eligible standalone owner/remaining
  allowance, or explicit managed-resource isolation approval.
- Supply least-privilege server credentials/account-zone allowlists. Required
  capabilities: User Details Read/membership for standalone; partner Tenant key;
  account details/token verification; Workers R2 Storage Read/Write and scoped
  S3 object access; Zone Read/DNS Read/Write; Email Routing Addresses Read and
  Rules Read/Write; separate Email Sending entitlement/permission if ordered.
  Discover current permission-group IDs from Cloudflare; do not guess IDs.
  Verify the new account's credential distribution and actual bucket scope/CORS.
- Execute the separate isolated HTTP/MFA/SSO gate. Existing BerryIT identity,
  grants, RLS and MFA remain the authority; no live GoTrue/PostgREST/Storage/SSO
  verification was performed here.
- Verify approved external encrypted DB+objects+configuration backup, separate
  recovery identities/material, checksum/version/scope/retention evidence and
  actual restore/application access. Prior backup infrastructure remains BLOCKED;
  local synthetic encryption/restore is not external production recovery.
- Separately review/promote the forward production schema and worker composition
  (including leases, process supervision, product broker and per-account secrets).
  Existing deployment stays untouched and MOCK-only until then.
- Approve bounded synthetic LIVE provider verification before any real customer:
  account, bucket, multipart enforcement, DNS/TLS, recipient/routing. Also approve
  release/version, DB/runtime, identity activation, budget, monitoring and recovery.

## Primary references checked 2026-10-25

- [Tenant prerequisites](https://developers.cloudflare.com/tenant/get-started/)
- [Tenant unit discovery](https://developers.cloudflare.com/tenant/how-to/get-tenant-details/)
- [Account API](https://developers.cloudflare.com/api/resources/accounts/methods/create/)
- [Standalone eligibility](https://developers.cloudflare.com/fundamentals/account/create-account/)
- [R2 bucket API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)
- [R2 jurisdictions](https://developers.cloudflare.com/r2/reference/data-location/)
- [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Signed URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [AWS reference signature](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html)
- [Routing API](https://developers.cloudflare.com/api/resources/email_routing/)
- [Sending REST API](https://developers.cloudflare.com/email-service/api/send-emails/rest-api/)
