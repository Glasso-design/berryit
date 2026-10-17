# Desktop connection repair — 2026-10-16

## Result

Local branch `feat/support-desk`, base `0357a64e7d0284a30259cbf7b78b6c7a1e155b91`.
No commit, push, server deployment, migration or live customer-data change.

**Connection and packaging verified; complete deployed support workflow BLOCKED.**
The NSIS installer is built, not installed over the running copy. A real user
login/MFA and native WebView2 UI have not been verified in this pass.

## Confirmed causes

1. The generic 0.1.0 installer had no production connection profile. Setup was
   intentional, not an absent backend implementation.
2. The running installed executable is 0.1.0, modified 2026-10-13 16:17 Swedish
   time, before the Complete Support Workflow commit. Path:
   `%LOCALAPPDATA%\Packages\<host-package>\LocalCache\Local\BERRYiT Control Center\berryit-control-center.exe`.
   SHA-256: `cdbdad6e07bec53a55d0a3d72545dcc91e44d36c0f034d9a0e78dc9546289ede`.
3. Both existing Desktop development defaults and the installed configuration
   point to `http://127.0.0.1:8700`, but no local tunnel was listening.
4. Read-only SSH checks confirmed the dedicated BerryIT backend on
   `prod-node-01` / `100.100.11.6`, under
   `/home/ubuntu/berryit-support/deploy/berryit-support`. Its five containers run;
   Auth and DB are healthy. Gateway binds only the server's `127.0.0.1:8700`.
   There is no verified direct Desktop endpoint on the tailnet address:8700.

## Local changes

- New 0.1.1 version across npm/Tauri/Cargo metadata, without dependency upgrades.
- Git-ignored `.env.production.local` with the verified loopback URL and existing
  public anon key. Its fingerprint matches the deployed BerryIT key; role is
  `anon`. No administrative key or private SSH identity enters the bundle.
- Vite exposes only three allowlisted public settings. Builds reject incomplete
  profiles, unsafe origins and administrative keys, including `sb_secret_`.
- Login displays a reachable connection state, blocks submission while offline,
  offers retry and access to existing connection settings before authentication.
- Setup retains connection defaults and reports save failures with a recoverable
  loading state. Health checks always have an eight-second timeout.
- `desktop/scripts/connect-backend.ps1` creates only a local, loopback-bound SSH
  forward using the existing trusted identity, strict host checking and batch
  mode. It verifies both gateway identity and Auth, reuses a working connection,
  and refuses an occupied unverified port. No remote command or service change.

The helper was run successfully. Gateway `/health` and `/auth/v1/health` both
returned 200 from Windows. A second run reused the existing connection.
No scheduled task or automatic startup was installed; rerun after reboot or
loss of SSH transport:

```powershell
npm run connect --prefix desktop
```

Transport metadata and log: `desktop/.local/backend-tunnel.json`. To undo only
this transport, verify its recorded PID, process start time and SSH forwarding
arguments still match before terminating that exact helper. Do not terminate
other SSH processes. No server rollback is required.

## Verification actually performed

| Check | Result |
|---|---|
| `npm test --prefix desktop` | PASS: 138 tests, 10 files; 10 new connection/build-security checks |
| Desktop TypeScript | PASS |
| Root lint / TypeScript with Next type generation | PASS |
| `npm run db:test` | PASS: 271 isolated RLS/MFA/security checks |
| `npm run db:repair-test` | PASS: 22 isolated security-repair tests |
| `npm run test:support-workflow` | PASS: 3/3, including isolated PGlite browser journey |
| `npm run test:desktop-connection` | PASS: 3/3 against actual built frontend, synthetic Auth health, other external requests blocked |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib --locked --offline` | PASS: 8/8 in normal Windows user context |
| TypeScript + Vite production build | PASS |
| `npm run package --prefix desktop` | PASS: Rust/MSVC release + NSIS x64 installer |
| Frontend credential scan | PASS: expected public key present; actual local service-role key absent |
| Native installed UI / real account login | NOT VERIFIED: Computer Use app approval timed out; no authentication was submitted |
| Full workflow against deployed backend | BLOCKED: missing server migrations and unverified Control Center server |

Initial sandbox failures are not counted as successful checks: Credential
Manager returned Windows error 5 in four tests, Playwright's browser cache was
not available in the sandbox, and NSIS packaging initially failed on DNS.
These checks subsequently passed using the existing normal Windows toolchain
and caches. No test was skipped or security gate weakened.

Remaining build warnings: Zod/Rollup comment annotations, JS chunk above 500 kB,
and the existing Node shell-spawn deprecation in the packaging script. No
dependency mass upgrade was performed. Installer is **unsigned**.

## Artifact

- `C:\projects\berryit\desktop\dist-installer\BerryIT-Control-Center-Setup.exe`
- Original versioned artifact:
  `desktop/src-tauri/target/release/bundle/nsis/BERRYiT Control Center_0.1.1_x64-setup.exe`
- Size: 2,651,323 bytes (2.53 MiB).
- Installer SHA-256:
  `537fd6f3e7881962ce2465ec248b574d7d12740ccfa28b7d76f298dd7c0f4329`.
- Compiled app FileVersion/ProductVersion: `0.1.1`.
- Compiled app SHA-256:
  `d65ce43bdef990740499fe86af0f65c04997ac17aaf0e967c846d0eb40bee6d6`.

Close the old app before installing. This installer uses the verified local
transport profile; other PCs need separately approved access and do not receive
this user's SSH identity. Existing saved client configuration remains authoritative.

## Server blockers — left unchanged

The live migration ledger contains only the six initial migrations through
`20261013091000_support_authority_hardening.sql`. Eight repository migrations
are absent: MFA enforcement, AI, Connector Engine, Monitoring, Communications,
ONARLY DESK, Security & CI Repair, and Complete Support Workflow.

Consequently the latest workflow must not be described as deployed or secure
for production solely because the Desktop builds or Auth responds. A separate
reviewed migration/deployment gate is required. `controlUrl` remains empty:
the server-side customer-registration endpoint was not verified as deployed.
No customer registration, ticket write, email or remote-support session was
performed against the live backend.
