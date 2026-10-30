// MASTER PASS 2 — migration rehearsal of 20261029090000_registration_gotrue_metadata through REAL GoTrue.
//
//   node verify-berryit.mjs seed | up | down | reup
//
// Runs only on a throwaway GitHub-hosted runner against the repo's own self-hosted stack
// (deploy/berryit-support/compose.yaml: supabase/postgres 17.6.1.136, GoTrue v2.196.0, PostgREST v14.12) on loopback.
// Registrations use the exact call shape of shared/support-registration.ts: the registrar's aal2 JWT calls the
// support_registration_context RPC through PostgREST, then GoTrue POST /admin/users with email_confirm:false,
// ban_duration 876000h, user_metadata and app_metadata.berryit_manual_customer = that context.
// Every check prints PASS / FAIL / FINDING; exit 1 only on FAIL.
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

if (process.env.GITHUB_ACTIONS !== "true") throw new Error("runs only on the throwaway CI runner");
const DIR = process.env.MP2_DIR;
const G = "http://127.0.0.1:8700";
const ANON = process.env.MP2_ANON_KEY;
const SERVICE = process.env.MP2_SERVICE_ROLE_KEY;
const M1_FIXED = process.env.MP2_EXPECT_M1_FIXED === "1";
const phase = process.argv[2];
const fxPath = `${DIR}/fixture.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sql(query) {
  const out = execFileSync("docker", ["exec", "-i", "berryit-support-db", "psql", "-v", "ON_ERROR_STOP=1", "-tA", "-U", "supabase_admin", "-d", "postgres"],
    { input: `select coalesce(json_agg(t), '[]'::json) from (${query}) t;`, encoding: "utf8" });
  return JSON.parse(out.trim() || "[]");
}
const sqlExec = (s) => execFileSync("docker", ["exec", "-i", "berryit-support-db", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-U", "supabase_admin", "-d", "postgres"], { input: s, encoding: "utf8" });
const one = (q) => sql(q)[0] ?? null;

async function call(method, path, { token, key = ANON, body } = {}) {
  const r = await fetch(`${G}${path}`, { method, headers: { apikey: key, Authorization: `Bearer ${token ?? key}`, "Content-Type": "application/json", Accept: "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: r.status, json };
}
const admin = (method, path, body) => call(method, `/auth/v1${path}`, { key: SERVICE, body });
const jwtClaims = (t) => JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString());

function base32(secret) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += a.indexOf(c).toString(2).padStart(5, "0");
  const bytes = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, at = Date.now()) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", base32(secret)).update(c).digest(); const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}
async function login(email, password) {
  const r = await call("POST", "/auth/v1/token?grant_type=password", { body: { email, password } });
  return { status: r.status, token: r.json.access_token, body: r.json };
}
async function enrollMfa(token, name) {
  const f = await call("POST", "/auth/v1/factors", { token, body: { factor_type: "totp", friendly_name: name } });
  if (!f.json.id) throw new Error(`enroll failed ${f.status} ${JSON.stringify(f.json).slice(0, 200)}`);
  const up = await stepUp(token, f.json.id, f.json.totp.secret);
  return { factorId: f.json.id, secret: f.json.totp.secret, token: up };
}
async function stepUp(token, factorId, secret) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ch = await call("POST", `/auth/v1/factors/${factorId}/challenge`, { token, body: {} });
    const v = await call("POST", `/auth/v1/factors/${factorId}/verify`, { token, body: { challenge_id: ch.json.id, code: totp(secret) } });
    if (v.json.access_token) return v.json.access_token;
    await sleep(31000); // a TOTP code can be used once per 30 s window
  }
  throw new Error("MFA verify failed");
}
async function aal2(fx, who) {
  const l = await login(fx.emails[who], fx.password);
  if (!l.token) throw new Error(`login ${who} ${l.status}`);
  return stepUp(l.token, fx.factors[who].factorId, fx.factors[who].secret);
}
async function context(token, org) {
  return call("POST", "/rest/v1/rpc/support_registration_context", { token, body: { p_organization_id: org } });
}
// shared/support-registration.ts: the exact createUser attributes.
const registerBody = (email, ctx) => ({ email, password: randomBytes(18).toString("base64url"), email_confirm: false, ban_duration: "876000h",
  user_metadata: { full_name: "MP2 Registrerad Kund", phone: "070-000 00 00" }, app_metadata: { berryit_manual_customer: ctx } });
const auditRows = (id) => sql(`select action, coalesce(actor_id::text, 'NULL') actor, metadata->>'source' source, scope::text from public.support_admin_audit where target_id = '${id}' order by id`);
const auditText = (rows) => rows.map((r) => `${r.action}(${r.actor === "NULL" ? "NULL" : "actor"}${r.source ? "," + r.source : ""})`).join(", ") || "none";
const profile = (id) => one(`select role, organization_id, login_activation_pending pending, registered_by, is_active from public.profiles where id = '${id}'`);
const calls = () => Number(one("select coalesce(sum(calls),0)::int n from pg_stat_user_functions where funcname = 'handle_auth_user_registration_metadata'")?.n ?? 0);
const authRows = (email) => Number(one(`select count(*)::int n from auth.users where email = '${email}'`).n);

const results = [];
function check(name, ok, detail, finding = null) {
  const status = ok ? "PASS" : finding ? "FINDING" : "FAIL";
  results.push(status);
  console.log(`${status} ${finding && !ok ? `[${finding}] ` : ""}${name} -> ${detail}`);
}
const run = randomBytes(3).toString("hex");
const mail = (n) => `mp2.${n}.${phase}.${run}@example.test`;

async function seed() {
  const password = `Mp2-${randomBytes(12).toString("hex")}!`;
  console.log(`::add-mask::${password}`);
  const fx = { password, emails: {}, users: {}, orgs: {}, sessions: {}, factors: {} };
  for (const k of ["A", "B", "C_empty"]) {
    sqlExec(`insert into public.organizations(name) values ('MP2 Kund ${k} AB');`);
    fx.orgs[k] = one(`select id from public.organizations where name = 'MP2 Kund ${k} AB'`).id;
  }
  for (const k of ["sa", "admin2", "tech", "custA", "custB", "custPriv"]) {
    fx.emails[k] = `mp2.${k.toLowerCase()}@example.test`;
    const r = await admin("POST", "/admin/users", { email: fx.emails[k], password, email_confirm: true, user_metadata: { full_name: `MP2 ${k}` } });
    if (!r.json.id) throw new Error(`create ${k}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    fx.users[k] = r.json.id;
  }
  const U = fx.users;
  sqlExec(`update public.profiles set role='admin' where id in ('${U.sa}','${U.admin2}');
update public.profiles set role='technician' where id='${U.tech}';
update public.profiles set organization_id='${fx.orgs.A}' where id='${U.custA}';
update public.profiles set organization_id='${fx.orgs.B}' where id='${U.custB}';
insert into public.support_role_grants(grantee_id,role_key,scope,reason) values ('${U.sa}','BERRYIT_SUPPORT_SUPER_ADMIN','global','MP2 rehearsal owner decision (CI runner)');
insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,reason) values ('${U.tech}','BERRYIT_SUPPORT_TECHNICIAN','organization','${fx.orgs.A}','MP2 rehearsal scoped technician');`);
  for (const k of ["sa", "admin2"]) {
    const l = await login(fx.emails[k], password);
    const m = await enrollMfa(l.token, `mp2-${k}`);
    fx.factors[k] = { factorId: m.factorId, secret: m.secret };
    fx.sessions[`${k}_aal2`] = jwtClaims(m.token).session_id;
    console.log(`::add-mask::${m.secret}`);
  }
  fx.sessions.sa_aal1 = jwtClaims((await login(fx.emails.sa, password)).token).session_id;
  // OLD path through REAL GoTrue on the base schema: the pass-1 bug produces half-registered accounts.
  const saTok = await aal2(fx, "sa");
  for (const [k, org] of [["halfA", fx.orgs.A], ["halfPriv", null]]) {
    fx.emails[k] = `mp2.${k.toLowerCase()}@example.test`;
    const ctx = await context(saTok, org);
    const r = await admin("POST", "/admin/users", registerBody(fx.emails[k], ctx.json));
    if (!r.json.id) throw new Error(`register ${k}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    fx.users[k] = r.json.id;
  }
  // Correct registration through the single-INSERT path (fixtures / older GoTrue): SQL, as the base schema expects.
  fx.users.regOld = randomUUID(); fx.emails.regOld = "mp2.regold@example.test";
  sqlExec(`insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, banned_until, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '${fx.users.regOld}', 'authenticated', 'authenticated', '${fx.emails.regOld}',
 '${JSON.stringify({ provider: "email", providers: ["email"], berryit_manual_customer: { actor_id: U.sa, session_id: fx.sessions.sa_aal2, organization_id: fx.orgs.A } })}',
 '{"full_name":"MP2 regOld"}', now() + interval '876000 hours', now(), now());`);
  // All of this is "existing" data, created a day before the migration.
  sqlExec("update auth.users set created_at = created_at - interval '1 day'; update public.profiles set created_at = created_at - interval '1 day';");
  writeFileSync(fxPath, JSON.stringify(fx, null, 1), { mode: 0o600 });
  // The SIM driver (bi_rehearsal.py) reads the same ids without secrets.
  writeFileSync(`${DIR}/ids.json`, JSON.stringify({ users: fx.users, orgs: fx.orgs, sessions: fx.sessions }, null, 1));
  const half = sql(`select u.email, p.organization_id is null org_null, p.login_activation_pending pending, p.registered_by is null reg_null, u.banned_until > now() banned,
    (select count(*)::int from public.support_admin_audit a where a.target_id = u.id::text and a.action = 'customer_registered') reg_audit
    from auth.users u join public.profiles p on p.id = u.id where u.raw_app_meta_data ? 'berryit_manual_customer' order by u.email`);
  console.log(`::notice title=seed (REAL GoTrue, base schema dabecfe)::orgs 3, users ${Object.keys(fx.users).length} (2 Super Admin/admin with TOTP, 1 technician, 3 customers, 1 INSERT-path registration, 2 registrations through the real GoTrue admin API on the base = half-registered): ${JSON.stringify(half)}`);
}

async function registration(fx, label, org) {
  const tok = await aal2(fx, "sa");
  const ctx = await context(tok, org);
  const email = mail(label);
  const r = await admin("POST", "/admin/users", registerBody(email, ctx.json));
  return { r, id: r.json.id, email, ctx: ctx.json };
}

async function verifyUp(fx, tag) {
  const U = fx.users;
  const c0 = calls();
  // 1. Organisation registration through REAL GoTrue.
  const reg = await registration(fx, "orgA", fx.orgs.A);
  const p = reg.id && profile(reg.id);
  const rows = reg.id ? auditRows(reg.id) : [];
  const nReg = rows.filter((x) => x.action === "customer_registered").length;
  check(`${tag}: admin-create via GoTrue (org A) -> organisation, activation lock, registrar`, reg.r.status < 300 && p?.organization_id === fx.orgs.A && p.pending === true && p.registered_by === U.sa && p.role === "customer",
    `HTTP ${reg.r.status} profile ${JSON.stringify(p)}`);
  check(`${tag}: customer_registered audit exactly once`, nReg === 1, `audit rows for the new account: ${auditText(rows)}`);
  check(`${tag}: ALL audit rows per registration = 1 (orchestrator M1)`, rows.length === 1, `${rows.length} rows: ${auditText(rows)}`, M1_FIXED ? null : "M1");
  const banned = await login(reg.email, "gissning-123-ABC");
  check(`${tag}: new account cannot log in before activation`, banned.status !== 200, `token HTTP ${banned.status}`);
  const priv = await registration(fx, "priv", null);
  const pp = priv.id && profile(priv.id);
  const prow = priv.id ? auditRows(priv.id) : [];
  check(`${tag}: admin-create via GoTrue (private, org null) -> scope global`, priv.r.status < 300 && pp?.organization_id === null && pp.pending === true && prow.some((x) => x.action === "customer_registered" && x.scope === "global"),
    `HTTP ${priv.r.status} audit ${auditText(prow)}`);
  if (tag !== "UP") return;

  // 2. Exactly once: activation-like admin update, login, email change, password recovery, password change, MFA, metadata, logout.
  const before = JSON.stringify(auditRows(reg.id)); const pBefore = JSON.stringify(profile(reg.id));
  const steps = [];
  const pw = `Mp2-${randomBytes(10).toString("hex")}!`; console.log(`::add-mask::${pw}`);
  steps.push(["admin activate (ban none, confirm, password)", (await admin("PUT", `/admin/users/${reg.id}`, { ban_duration: "none", email_confirm: true, password: pw })).status]);
  let l = await login(reg.email, pw); steps.push(["login", l.status]);
  const newMail = mail("orgA-changed");
  steps.push(["PUT /user email (autoconfirm)", (await call("PUT", "/auth/v1/user", { token: l.token, body: { email: newMail } })).status]);
  const cur = one(`select email from auth.users where id = '${reg.id}'`).email;
  const link = await admin("POST", "/admin/generate_link", { type: "recovery", email: cur });
  steps.push(["admin generate_link recovery", link.status]);
  const hashed = link.json.hashed_token ?? link.json.properties?.hashed_token;
  const ver = await call("POST", "/auth/v1/verify", { body: { type: "recovery", token_hash: hashed } });
  steps.push(["verify recovery token", ver.status]);
  const pw2 = `Mp2-${randomBytes(10).toString("hex")}!`; console.log(`::add-mask::${pw2}`);
  steps.push(["PUT /user password (reset)", (await call("PUT", "/auth/v1/user", { token: ver.json.access_token, body: { password: pw2 } })).status]);
  l = await login(cur, pw2); steps.push(["login with new password", l.status]);
  const m = await enrollMfa(l.token, "mp2-customer"); steps.push(["MFA enroll+verify (aal2)", jwtClaims(m.token).aal === "aal2" ? 200 : 0]);
  steps.push(["PUT /user data", (await call("PUT", "/auth/v1/user", { token: m.token, body: { data: { nick: "mp2" } } })).status]);
  steps.push(["MFA unenroll", (await call("DELETE", `/auth/v1/factors/${m.factorId}`, { token: m.token })).status]);
  steps.push(["admin app_metadata update", (await admin("PUT", `/admin/users/${reg.id}`, { app_metadata: { mp2_note: 1 } })).status]);
  steps.push(["logout", (await call("POST", "/auth/v1/logout", { token: m.token })).status]);
  await sleep(11500); // cumulative function stats of GoTrue's pooled backends are flushed when idle
  const after = JSON.stringify(auditRows(reg.id)); const pAfter = JSON.stringify(profile(reg.id));
  const dCalls = calls() - c0;
  const required = steps.filter(([n]) => !n.startsWith("PUT /user email")); // email change depends on mailer config, reported only
  check("UP: email change, password reset, MFA, metadata and admin updates do not re-fire side effects", before === after && pBefore === pAfter && required.every(([, s]) => s > 0 && s < 300),
    `steps ${steps.map(([n, s]) => `${n}=${s}`).join("; ")} | audit unchanged=${before === after} profile unchanged=${pBefore === pAfter} | trigger function calls in this phase: ${dCalls} (it runs, then returns early)`);

  // 3. A normal user cannot escalate through their own metadata.
  const nEmail = mail("normal");
  const nUser = await admin("POST", "/admin/users", { email: nEmail, password: pw, email_confirm: true, user_metadata: { full_name: "MP2 normal" } });
  const nl = await login(nEmail, pw);
  const saTok = await aal2(fx, "sa");
  const liveCtx = (await context(saTok, fx.orgs.A)).json;
  const e1 = await call("PUT", "/auth/v1/user", { token: nl.token, body: { data: { berryit_manual_customer: liveCtx, role: "admin", organization_id: fx.orgs.A } } });
  const e2 = await call("PUT", "/auth/v1/user", { token: nl.token, body: { app_metadata: { berryit_manual_customer: liveCtx } } });
  const e3 = await call("PATCH", `/rest/v1/profiles?id=eq.${nUser.json.id}`, { token: nl.token, body: { role: "admin", organization_id: fx.orgs.A, login_activation_pending: true, registered_by: U.sa } });
  const e4 = await call("POST", "/rest/v1/rpc/support_registration_context", { token: nl.token, body: { p_organization_id: fx.orgs.A } });
  const np = profile(nUser.json.id);
  const marker = one(`select raw_app_meta_data ? 'berryit_manual_customer' m from auth.users where id = '${nUser.json.id}'`).m;
  check("UP: normal user cannot escalate via PUT /user data, PUT /user app_metadata, PostgREST profile PATCH or the context RPC",
    np.role === "customer" && np.organization_id === null && np.pending === false && np.registered_by === null && marker === false && e2.status >= 400 && e4.status >= 400 && auditRows(nUser.json.id).every((x) => x.action !== "customer_registered"),
    `data=${e1.status} app_metadata=${e2.status} ${e2.json.error_code ?? e2.json.msg ?? ""} profile PATCH=${e3.status} rpc=${e4.status} -> profile ${JSON.stringify(np)}, marker in app_metadata=${marker}`);

  // 4. Admin API cannot convert an EXISTING account (pre-migration customer), even with a valid live aal2 context.
  const pc0 = JSON.stringify(profile(U.custPriv));
  const conv = await admin("PUT", `/admin/users/${U.custPriv}`, { app_metadata: { berryit_manual_customer: liveCtx } });
  const convMarker = one(`select raw_app_meta_data ? 'berryit_manual_customer' m from auth.users where id = '${U.custPriv}'`).m;
  check("UP: admin API marker on an existing account is refused and rolled back", conv.status >= 400 && JSON.stringify(profile(U.custPriv)) === pc0 && convMarker === false,
    `HTTP ${conv.status} ${conv.json.msg ?? conv.json.message ?? ""}; profile unchanged, marker stored=${convMarker}`);

  // 5. Fail closed through REAL GoTrue (reviewer M5): no 2xx and no auth.users row.
  const aal1Tok = (await login(fx.emails.sa, fx.password)).token;
  const aal1Ctx = { actor_id: U.sa, session_id: jwtClaims(aal1Tok).session_id, organization_id: fx.orgs.A };
  const t2 = await aal2(fx, "sa"); const ctxOut = (await context(t2, fx.orgs.A)).json;
  const lo = await call("POST", "/auth/v1/logout?scope=local", { token: t2 });
  const deny = [];
  for (const [n, ctx] of [["registrar aal1 session", aal1Ctx], ["registrar logged out", ctxOut], ["unknown organisation", { ...liveCtx, organization_id: randomUUID() }], ["admin without Super Admin grant", { actor_id: U.admin2, session_id: fx.sessions.admin2_aal2, organization_id: fx.orgs.A }]]) {
    const e = mail("deny-" + n.replace(/\W+/g, "-"));
    const r = await admin("POST", "/admin/users", registerBody(e, ctx));
    deny.push([n, r.status, authRows(e)]);
  }
  check("UP: refused registrations through REAL GoTrue leave no account (fail closed)", deny.every(([, s, n]) => s >= 400 && n === 0),
    `${deny.map(([n, s, c]) => `${n}: HTTP ${s}, auth.users rows ${c}`).join("; ")} (logout ${lo.status})`);

  // 6. Half-registered accounts from before the migration are NOT repaired by it (runbook item).
  const h0 = JSON.stringify(profile(U.halfPriv));
  const hu = await admin("PUT", `/admin/users/${U.halfPriv}`, { app_metadata: { mp2_probe: 1 } });
  check("UP: half-registered pre-migration account: admin update OK, account stays half-registered (needs manual repair)", hu.status < 300 && JSON.stringify(profile(U.halfPriv)) === h0 && auditRows(U.halfPriv).every((x) => x.action !== "customer_registered"),
    `HTTP ${hu.status}; profile ${h0}`);
}

async function verifyDown(fx) {
  const reg = await registration(fx, "afterDown", fx.orgs.A);
  const p = reg.id && profile(reg.id);
  const rows = reg.id ? auditRows(reg.id) : [];
  check("DOWN: base behaviour is back - GoTrue admin-create gives a half-registered account again (expected after rollback)",
    reg.r.status < 300 && p?.organization_id === null && p.pending === false && p.registered_by === null && rows.every((x) => x.action !== "customer_registered"),
    `HTTP ${reg.r.status} profile ${JSON.stringify(p)} audit ${auditText(rows)}`);
}

const fx = phase === "seed" ? null : JSON.parse(readFileSync(fxPath, "utf8"));
if (phase === "seed") await seed();
else if (phase === "up") await verifyUp(fx, "UP");
else if (phase === "reup") await verifyUp(fx, "RE-UP");
else if (phase === "down") await verifyDown(fx);
const fails = results.filter((r) => r === "FAIL").length;
if (phase !== "seed") {
  const s = `${results.filter((r) => r === "PASS").length} PASS, ${results.filter((r) => r === "FINDING").length} FINDING, ${fails} FAIL`;
  console.log(`${phase}: ${s}`);
}
process.exit(fails ? 1 : 0);
