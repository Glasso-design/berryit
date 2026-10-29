// MASTER PASS 2 — REAL operations tests on the throwaway CI stack, after
// api.e2e/ui.e2e (same fixture). Order matters: M4, M2, then M3 (M3 replaces
// the GoTrue container with a newer image).
//   M4  deploy/berryit-support/registration-check.sh (read-only) + repair template
//   M2  migrate.sh with lock_timeout: a waiting migration gives up, logins keep working, retry applies it
//   M3  GoTrue upgrade rehearsal with the BERRYiT trigger in place
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fx, G, sql, sqlExec, json, login, loginAal2, route, evidence } from "./lib.mjs";

const repo = process.env.MP1_REPO;
const here = `${repo}/deploy/berryit-support`;
const VERSION = "20261029090000_registration_gotrue_metadata.sql";
const runId = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (label, detail = "") => evidence(`PASS ${label}${detail ? " — " + detail : ""}`);

/** Runs a command, returns {code, out, ms}; killed after timeoutMs. */
function run(cmd, args, { input, env, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { env: env ?? process.env });
    let out = "";
    let settled = false;
    const done = (code) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ code, out, ms: Date.now() - t0 }); };
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.stdin.on("error", () => {});
    child.on("error", (error) => { out += `spawn failed: ${error.message}`; done(-1); });
    child.stdin.end(input ?? "");
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => done(code));
  });
}
const dbPsql = (extra = []) => ["exec", "-i", "berryit-support-db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres", ...extra];
const admin = (path, init = {}) => fetch(`${G}/auth/v1${path}`, { ...init, headers: { apikey: fx.serviceKey, Authorization: `Bearer ${fx.serviceKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
const maxAudit = () => sql("select coalesce(max(id),0)::bigint m from public.support_admin_audit")[0].m;

test("M4 registration-check.sh: read-only; clean stack 0 hits; finds a pre-fix half registration; manual repair completes it", async () => {
  const check = () => run(`${here}/registration-check.sh`, []);
  const clean = await check();
  assert.equal(clean.code, 0, `clean stack must have no half registrations:\n${clean.out.slice(-1500)}`);
  // Emulate an account registered BEFORE 20261029090000: GoTrue created the user
  // and wrote the marker by UPDATE, and no trigger reacted to it.
  const mail = `mp2.halv.${runId}@mp1.example.test`;
  const created = await json(await admin("/admin/users", { method: "POST", body: JSON.stringify({ email: mail, password: `Mp2-${randomUUID()}!`, email_confirm: false, user_metadata: { full_name: "MP2 Halvregistrerad" } }) }));
  assert.ok(created.id, JSON.stringify(created).slice(0, 200));
  sqlExec(`begin; set local session_replication_role = replica;
    update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('berryit_manual_customer',
      jsonb_build_object('actor_id','${fx.users.saapi}','session_id','${randomUUID()}','organization_id','${fx.orgs.a}')) where id='${created.id}';
    commit;`);
  const stateBefore = JSON.stringify(sql(`select organization_id, login_activation_pending, registered_by from public.profiles where id='${created.id}'`));
  const auditBefore = maxAudit();
  const found = await check();
  assert.equal(found.code, 3, `half registration must be reported (exit 3):\n${found.out.slice(-1500)}`);
  assert.ok(found.out.includes(created.id), "the half-registered user is listed");
  assert.match(found.out, /MP2-REGISTRATION-CHECK: 1 konto/);
  assert.equal(maxAudit(), auditBefore, "the check writes nothing");
  assert.equal(JSON.stringify(sql(`select organization_id, login_activation_pending, registered_by from public.profiles where id='${created.id}'`)), stateBefore, "the check changes nothing");
  // Manual repair, exactly as documented (explicit values + confirm=JA).
  const template = readFileSync(`${here}/checks/repair-half-registration.template.sql`, "utf8");
  const vars = ["-v", `user_id=${created.id}`, "-v", `organization_id=${fx.orgs.a}`, "-v", `registrar_id=${fx.users.saapi}`, "-v", `operator_id=${fx.users.saapi}`, "-v", "reason=MP2 CI-reparation enligt runbook"];
  const noConfirm = await run("docker", dbPsql(["--single-transaction", ...vars]), { input: template });
  assert.match(noConfirm.out, /confirm=JA saknas/);
  assert.equal(JSON.stringify(sql(`select organization_id, login_activation_pending, registered_by from public.profiles where id='${created.id}'`)), stateBefore, "no change without confirm");
  const repairAudit = maxAudit();
  const repaired = await run("docker", dbPsql(["--single-transaction", ...vars, "-v", "confirm=JA"]), { input: template });
  assert.equal(repaired.code, 0, repaired.out.slice(-1500));
  assert.deepEqual(sql(`select organization_id, login_activation_pending, registered_by from public.profiles where id='${created.id}'`),
    [{ organization_id: fx.orgs.a, login_activation_pending: true, registered_by: fx.users.saapi }]);
  const audit = sql(`select action, actor_id from public.support_admin_audit where id > ${repairAudit} order by id`);
  assert.ok(audit.some((a) => a.action === "customer_registration_repaired" && a.actor_id === fx.users.saapi), JSON.stringify(audit));
  const again = await run("docker", dbPsql(["--single-transaction", ...vars, "-v", "confirm=JA"]), { input: template });
  assert.notEqual(again.code, 0, "a second repair of the same account is refused");
  const after = await check();
  assert.equal(after.code, 0, after.out.slice(-1500));
  ok("M4 detection + manual repair", `clean=${clean.code} found=${found.code} repaired=${repaired.code} again=${again.code} after=${after.code} audit=${JSON.stringify(audit.map((a) => [a.action, a.actor_id ? "actor" : "no-actor"]))}`);
});

test("M2 migrate.sh: SET LOCAL applies; a migration waiting on auth.users gives up after lock_timeout, logins keep working, retry applies it", async () => {
  // (a) migrate.sh's exact psql form (docker exec psql --single-transaction, SQL on stdin) runs one transaction.
  const probe = await run("docker", dbPsql(["--single-transaction"]), { input: "set local lock_timeout = '4s';\nselect 'LT=' || current_setting('lock_timeout');\nselect 'PSQL-TXN=' || (now() <> statement_timestamp())::text;\n" });
  assert.equal(probe.code, 0, probe.out);
  assert.ok(probe.out.includes("LT=4s") && !/WARNING/.test(probe.out), `SET LOCAL must apply in migrate.sh's form:\n${probe.out}`);
  const psqlVersion = (await run("docker", ["exec", "berryit-support-db", "psql", "--version"])).out.trim();
  // (b) take the migration out of the ledger and hold a row lock on auth.users for 20 s.
  sqlExec(`delete from public.schema_migrations where version='${VERSION}';`);
  const blocker = run("docker", dbPsql(["-c", `begin; update auth.users set email = email where id='${fx.users.custb}'; select pg_sleep(20); commit;`]), { timeoutMs: 60_000 });
  await sleep(1500);
  const migrate = run(`${here}/migrate.sh`, [`${repo}/supabase/migrations`], { timeoutMs: 60_000 });
  await sleep(1000);
  const t0 = Date.now();
  const loginWhileWaiting = await login("custa"); // GoTrue updates auth.users.last_sign_in_at
  const loginMs = Date.now() - t0;
  const failed = await migrate;
  const ledgerAfterFailure = sql(`select count(*)::int n from public.schema_migrations where version='${VERSION}'`)[0].n;
  const held = await blocker;
  const retry = await run(`${here}/migrate.sh`, [`${repo}/supabase/migrations`], { timeoutMs: 60_000 });
  const ledgerAfterRetry = sql(`select count(*)::int n from public.schema_migrations where version='${VERSION}'`)[0].n;
  const trigger = sql("select tgenabled::text from pg_trigger where tgname='auth_user_registration_metadata' and tgrelid='auth.users'::regclass");
  const facts = { psqlVersion, migrateExit: failed.code, migrateMs: failed.ms, loginStatus: loginWhileWaiting.status, loginMs, ledgerAfterFailure, blockerExit: held.code, retryExit: retry.code, ledgerAfterRetry, trigger };
  evidence(`INFO M2 lock_timeout: ${JSON.stringify(facts)} migrate.sh: ${failed.out.replace(/\s+/g, " ").slice(-240)}`);
  assert.notEqual(failed.code, 0, `the waiting migration must give up (lock_timeout), it ran ${failed.ms} ms: ${failed.out.slice(-400)}`);
  assert.match(failed.out, /lock timeout/);
  assert.ok(failed.ms < 15_000, `migration gave up after ${failed.ms} ms`);
  assert.equal(ledgerAfterFailure, 0, "a failed migration writes no ledger row");
  assert.equal(loginWhileWaiting.status, 200);
  assert.ok(loginMs < 10_000, `login waited ${loginMs} ms behind the migration`);
  assert.equal(retry.code, 0, retry.out.slice(-600));
  assert.match(retry.out, /1 nya migrationer applicerade/);
  assert.equal(ledgerAfterRetry, 1);
  assert.deepEqual(trigger, [{ tgenabled: "O" }]);
  ok("M2 lock_timeout + retry", JSON.stringify(facts));
});

test("M3 GoTrue upgrade rehearsal: compose v2.196.0 -> supabase CLI-pinned GoTrue runs its migrations with the trigger in place; registration stays exact", async () => {
  const image = process.env.MP2_GOTRUE_UPGRADE_IMAGE;
  assert.ok(image, "MP2_GOTRUE_UPGRADE_IMAGE must name the CLI-pinned GoTrue image");
  const health = async () => { try { const r = await fetch(`${G}/auth/v1/health`, { headers: { apikey: fx.anonKey } }); return r.ok ? await r.json() : null; } catch { return null; } };
  const before = { version: (await health())?.version, migrations: sql("select count(*)::int n from auth.schema_migrations")[0].n };
  const env = { ...process.env, MP1_GATEWAY_TOKEN: "unused-for-auth-upgrade", MP2_GOTRUE_UPGRADE_IMAGE: image };
  const up = await run("docker", ["compose", "--project-directory", here, "--env-file", `${here}/secrets/stack.env`, "-f", `${here}/compose.yaml`,
    "-f", `${repo}/tests/masterpass1/compose.override.yaml`, "-f", `${repo}/tests/masterpass1/compose.gotrue-upgrade.yaml`,
    "--profile", "onarly-ai", "up", "-d", "--no-deps", "auth"], { env, timeoutMs: 300_000 });
  assert.equal(up.code, 0, up.out.slice(-1500));
  let now = null;
  for (let i = 0; i < 60; i++) { now = await health(); if (now && now.version !== before.version) break; await sleep(2000); }
  const after = { version: now?.version, migrations: sql("select count(*)::int n from auth.schema_migrations")[0].n };
  const trigger = sql(`select t.tgenabled::text, (select string_agg(a.attname, ',') from pg_attribute a where a.attrelid = t.tgrelid and a.attnum = any(t.tgattr)) cols
    from pg_trigger t where t.tgname='auth_user_registration_metadata' and t.tgrelid='auth.users'::regclass`);
  evidence(`INFO M3 GoTrue upgrade: ${JSON.stringify({ image, before, after, trigger })}`);
  const tag = (v) => String(v ?? "").replace(/^.*:/, "").replace(/^v/, "");
  assert.equal(tag(after.version), tag(image), `GoTrue now reports ${after.version}, expected ${image}`);
  assert.ok(after.migrations > before.migrations, `the new GoTrue ran its own migrations (${before.migrations} -> ${after.migrations}) with the trigger in place`);
  assert.deepEqual(trigger, [{ tgenabled: "O", cols: "raw_app_meta_data" }], "trigger survives unchanged");
  // REAL registration through the UPGRADED GoTrue, via the Next.js route, by a fresh Super Admin on aal2.
  const name = `saupg${runId}`;
  const u = await json(await admin("/admin/users", { method: "POST", body: JSON.stringify({ email: `${name}@mp1.example.test`, password: fx.password, email_confirm: true, user_metadata: { full_name: "MP2 upgrade admin" } }) }));
  assert.ok(u.id, JSON.stringify(u).slice(0, 200));
  sqlExec(`update public.profiles set role='admin' where id='${u.id}';
    insert into public.support_role_grants(grantee_id,role_key,scope,reason) values('${u.id}','BERRYIT_SUPPORT_SUPER_ADMIN','global','MP2 syntetisk (GoTrue-uppgradering på CI-runner)');`);
  const sa = await loginAal2(name);
  const mail = `mp2.upg.${runId}@mp1.example.test`;
  const auditBefore = maxAudit();
  const r = await route(sa.token, null, { full_name: "MP2 Kund efter uppgradering", email: mail, phone: "", organization_id: fx.orgs.a }, "/api/control/customers");
  const body = await json(r);
  assert.equal(r.status, 201, JSON.stringify(body));
  assert.deepEqual(sql(`select organization_id, login_activation_pending, registered_by from public.profiles where id='${body.id}'`),
    [{ organization_id: fx.orgs.a, login_activation_pending: true, registered_by: u.id }]);
  assert.deepEqual(sql(`select action, actor_id from public.support_admin_audit where id > ${auditBefore} order by id`), [{ action: "customer_registered", actor_id: u.id }]);
  // And a refusal through the upgraded GoTrue still leaves zero rows.
  const aal1 = await login(name);
  const sid = JSON.parse(Buffer.from(aal1.token.split(".")[1], "base64url").toString()).session_id;
  const deniedMail = `mp2.upg.nekad.${runId}@mp1.example.test`;
  const auditBeforeDenied = maxAudit();
  const denied = await admin("/admin/users", { method: "POST", body: JSON.stringify({ email: deniedMail, password: `Mp2-${randomUUID()}!`, email_confirm: false,
    app_metadata: { berryit_manual_customer: { actor_id: u.id, session_id: sid, organization_id: fx.orgs.a } } }) });
  assert.ok(denied.status >= 400, `aal1 marker must be refused by the upgraded GoTrue too, got ${denied.status}`);
  assert.deepEqual(sql(`select (select count(*) from auth.users where email='${deniedMail}')::int users, (select count(*) from public.support_admin_audit where id > ${auditBeforeDenied})::int audit`)[0], { users: 0, audit: 0 });
  ok("M3 GoTrue upgrade rehearsal", `${before.version} -> ${after.version}, auth migrations ${before.migrations} -> ${after.migrations}, trigger kept, registration 201 + 1 audit row, aal1 refusal ${denied.status} + 0 rows`);
});
