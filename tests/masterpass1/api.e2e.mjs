// MASTER PASS 1 — REAL chain tests against the throwaway stack on the CI runner:
//   Next.js route handler (next start) / GoTrue / PostgREST / Storage / RLS /
//   ONARLY AI adapter container  ->  SIM ONARLY AI gateway (tests/masterpass1/gateway-stub.mjs)
// Nothing here talks to a shared environment; lib.mjs refuses non-loopback targets.
import test from "node:test";
import assert from "node:assert/strict";
import { fx, G, WEB, sql, sqlExec, stub, json, login, loginAal2, rest, ai, route, evidence } from "./lib.mjs";

const T = {}; // tokens
const S = {}; // shared state
const run = Date.now().toString(36);
const ok = (label, detail = "") => { evidence(`PASS ${label}${detail ? " — " + detail : ""}`); };

test("A0 stack: gateway, GoTrue, adapter health and disabled signup", async () => {
  assert.equal((await fetch(`${G}/health`)).status, 200);
  assert.equal((await fetch(`${G}/auth/v1/health`, { headers: { apikey: fx.anonKey } })).status, 200);
  const health = await json(await fetch(`${G}/ai/v1/health`));
  assert.deepEqual(health, { status: "ok", gateway: "configured" });
  const signup = await fetch(`${G}/auth/v1/signup`, { method: "POST", headers: { apikey: fx.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: `x${run}@mp1.example.test`, password: "Mp1-not-allowed-123!" }) });
  assert.notEqual(signup.status, 200, "public signup must be disabled");
  ok("stack health + signup disabled", `signup HTTP ${signup.status}`);
});

test("A1 auth: wrong password rejected, all synthetic users log in", async () => {
  const bad = await login("techa", "fel-lösenord-123");
  assert.equal(bad.status, 400);
  for (const name of ["techa", "custa", "custb"]) {
    const r = await login(name);
    assert.equal(r.status, 200, `${name} login ${JSON.stringify(r.body).slice(0, 200)}`);
    T[name] = r.token;
  }
  const sa = await loginAal2("saapi");
  T.saapi = sa.token; T.saapiAal1 = sa.aal1;
  const payload = JSON.parse(Buffer.from(T.saapi.split(".")[1], "base64url").toString());
  assert.equal(payload.aal, "aal2");
  ok("login + TOTP aal2 via GoTrue", "saapi aal2");
});

test("A2 authority: support_access_context per role; Super Admin requires aal2", async () => {
  const ctx = async (token) => json(await rest(token, "/rpc/support_access_context", { method: "POST", body: "{}" }));
  const tech = await ctx(T.techa), cust = await ctx(T.custa), saLow = await ctx(T.saapiAal1), sa = await ctx(T.saapi);
  assert.equal(tech.isStaff, true); assert.equal(tech.isSuperAdmin, false);
  assert.equal(cust.isStaff, false);
  assert.equal(saLow.isSuperAdmin, false, "aal1 must not be Super Admin");
  assert.equal(sa.isSuperAdmin, true);
  ok("authority context", `tech perms=${(tech.permissions ?? []).length} sa(aal1)=${saLow.isSuperAdmin} sa(aal2)=${sa.isSuperAdmin}`);
});

test("B1 route handler: technician creates, works and closes a ticket for own-scope customer", async () => {
  const overview = await json(await route(T.techa, "overview"));
  assert.ok(overview.data, JSON.stringify(overview).slice(0, 300));
  const customers = overview.data.customers.map((c) => c.id);
  assert.ok(customers.includes(fx.users.custa), "tech sees customer A");
  assert.ok(!customers.includes(fx.users.custb), "tech must not see customer B");
  const created = await json(await route(T.techa, "create", { input: { customerId: fx.users.custa, subject: `MP1 VPN ${run}`, description: "Syntetiskt ärende från MASTER PASS 1.", category_key: "natverk" } }));
  assert.match(created.data ?? "", /^[0-9a-f-]{36}$/, JSON.stringify(created));
  S.ticketA = created.data;
  const foreign = await route(T.techa, "create", { input: { customerId: fx.users.custb, subject: `MP1 foreign ${run}`, description: "Ska nekas av RLS-scope.", category_key: "natverk" } });
  assert.equal(foreign.status, 400, "creating for another tenant's customer must fail");
  for (const [action, args] of [["message", { id: S.ticketA, body: "Hej! Vi tittar på det. (MP1)", staff: true }], ["note", { id: S.ticketA, body: "INTERNAL-MP1-SECRET felsökning" }], ["update", { id: S.ticketA, changes: { status_key: "pagar" } }]]) {
    const r = await route(T.techa, action, args);
    assert.equal(r.status, 200, `${action}: ${JSON.stringify(await json(r)).slice(0, 300)}`);
  }
  // IT SUPPORT (technician) has tickets.write but not tickets.reassign: assignment is refused by the DB
  // and the detail must say so (canAssign=false) so the UI does not offer a control that always fails.
  const selfAssign = await route(T.techa, "update", { id: S.ticketA, changes: { assignee_id: fx.users.techa } });
  assert.equal(selfAssign.status, 400);
  assert.equal((await route(T.saapi, "update", { id: S.ticketA, changes: { assignee_id: fx.users.techa } })).status, 200, "Super Admin assigns");
  assert.equal((await json(await route(T.saapi, "detail", { id: S.ticketA }))).data.canAssign, true);
  const detail = (await json(await route(T.techa, "detail", { id: S.ticketA }))).data;
  assert.equal(detail.canWork, true);
  assert.equal(detail.canAssign, false, "technician detail must expose canAssign=false");
  assert.equal(detail.ticket.status_key, "pagar");
  assert.equal(detail.ticket.assignee_id, fx.users.techa);
  assert.equal(detail.notes.length, 1);
  assert.ok(detail.events.some((e) => e.event_type === "status_changed"), "history has status change");
  const row = sql(`select reference, organization_id, requester_id, status_key from public.tickets where id='${S.ticketA}'`)[0];
  assert.match(row.reference, /^BIT-\d{4}-\d{4,}$/);
  assert.equal(row.organization_id, fx.orgs.a);
  S.refA = row.reference;
  ok("ticket lifecycle via /api/control/support", `${row.reference} org=A status=pagar`);
});

test("B2 attachments: multipart upload -> Storage -> signed URL, internal file hidden from customer", async () => {
  const upload = async (token, name, content, visibility) => {
    const form = new FormData();
    form.set("action", "upload"); form.set("args", JSON.stringify({ id: S.ticketA, visibility }));
    form.set("file", new File([content], name, { type: "text/plain" }));
    return fetch(`${WEB}/api/control/support`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  };
  const exe = new FormData();
  exe.set("action", "upload"); exe.set("args", JSON.stringify({ id: S.ticketA, visibility: "customer" }));
  exe.set("file", new File(["MZ"], "verktyg.exe", { type: "application/x-msdownload" }));
  const badType = await fetch(`${WEB}/api/control/support`, { method: "POST", headers: { Authorization: `Bearer ${T.techa}` }, body: exe });
  assert.equal(badType.status, 400, "disallowed MIME type must be refused");
  const otherTenant = new FormData();
  otherTenant.set("action", "upload"); otherTenant.set("args", JSON.stringify({ id: S.ticketA, visibility: "customer" }));
  otherTenant.set("file", new File(["x"], "intrang.txt", { type: "text/plain" }));
  const custBUpload = await fetch(`${WEB}/api/control/support`, { method: "POST", headers: { Authorization: `Bearer ${T.custb}` }, body: otherTenant });
  assert.equal(custBUpload.status, 400, "other tenant cannot attach to the ticket");
  const pub = await upload(T.techa, "kund.txt", "MP1 kundsynlig fil", "customer");
  assert.equal(pub.status, 200, JSON.stringify(await json(pub)));
  const internal = await upload(T.techa, "intern.txt", "MP1 intern fil", "internal");
  assert.equal(internal.status, 200, JSON.stringify(await json(internal)));
  const rows = sql(`select a.id, a.file_name, a.visibility, a.upload_completed_at is not null as done, (select count(*) from storage.objects o where o.bucket_id='ticket-attachments' and o.name=a.storage_path)::int as objects from public.ticket_attachments a where a.ticket_id='${S.ticketA}' order by a.file_name`);
  assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.done && r.objects === 1), JSON.stringify(rows));
  S.attPublic = rows.find((r) => r.visibility === "customer").id; S.attInternal = rows.find((r) => r.visibility === "internal").id;
  const signed = (await json(await route(T.custa, "download", { attachmentId: S.attPublic }))).data;
  assert.ok(String(signed).startsWith(G + "/storage/v1/object/sign/"), String(signed));
  const file = await fetch(signed);
  assert.equal(file.status, 200); assert.equal(await file.text(), "MP1 kundsynlig fil");
  const denied = await route(T.custa, "download", { attachmentId: S.attInternal });
  assert.equal(denied.status, 400, "customer must not get the internal attachment");
  const unsigned = await fetch(`${G}/storage/v1/object/ticket-attachments/tickets/${S.ticketA}/x`);
  assert.notEqual(unsigned.status, 200);
  const audit = sql(`select count(*)::int n from public.support_admin_audit where action='attachment_download_requested' and actor_id='${fx.users.custa}'`)[0].n;
  assert.ok(audit >= 1, "download is audited");
  ok("attachment chain", `2 objects in Storage, signed download exact bytes, internal denied, audit rows=${audit}`);
});

test("B3 customer view: own ticket, staff reply visible, internal note and internal file hidden", async () => {
  const detail = (await json(await route(T.custa, "detail", { id: S.ticketA }))).data;
  assert.equal(detail.canWork, false);
  assert.equal(detail.notes.length, 0);
  assert.ok(detail.messages.some((m) => m.is_from_staff));
  assert.deepEqual(detail.attachments.map((a) => a.file_name), ["kund.txt"]);
  assert.ok(!JSON.stringify(detail).includes("INTERNAL-MP1-SECRET"));
  assert.ok(!JSON.stringify(detail).includes("intern.txt"));
  const reply = await route(T.custa, "message", { id: S.ticketA, body: "Tack, VPN fungerar fortfarande inte. (MP1)", staff: false });
  assert.equal(reply.status, 200, JSON.stringify(await json(reply)));
  ok("customer isolation of internal data");
});

test("B4 negative: wrong role / other tenant / forged staff flag / invalid input / origin", async () => {
  const results = {};
  // customer B cannot read customer A's ticket
  results.otherCustomerDetail = (await route(T.custb, "detail", { id: S.ticketA })).status;
  assert.equal(results.otherCustomerDetail, 400);
  // customer A forging staff flag, status change, internal note
  results.forgedStaff = (await route(T.custa, "message", { id: S.ticketA, body: "Jag låtsas vara support", staff: true })).status;
  results.customerUpdate = (await route(T.custa, "update", { id: S.ticketA, changes: { status_key: "stangt" } })).status;
  results.customerNote = (await route(T.custa, "note", { id: S.ticketA, body: "kund försöker skriva intern anteckning" })).status;
  assert.equal(results.forgedStaff, 400); assert.equal(results.customerUpdate, 400); assert.equal(results.customerNote, 400);
  const forgedRows = sql(`select count(*)::int n from public.ticket_messages where ticket_id='${S.ticketA}' and body='Jag låtsas vara support'`)[0].n;
  assert.equal(forgedRows, 0);
  // customer B ticket via PostgREST, technician A has no scope there
  const created = await json(await rest(T.custb, "/tickets", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ requester_id: fx.users.custb, organization_id: fx.orgs.b, subject: `MP1 B ${run}`, description: "Kund B:s eget ärende via PostgREST.", category_key: "dator", source: "portal" }) }));
  assert.ok(Array.isArray(created) && created[0]?.id, JSON.stringify(created).slice(0, 300));
  S.ticketB = created[0].id; S.refB = created[0].reference; S.subjectB = created[0].subject;
  results.techOtherTenantDetail = (await route(T.techa, "detail", { id: S.ticketB })).status;
  results.techOtherTenantUpdate = (await route(T.techa, "update", { id: S.ticketB, changes: { status_key: "lost" } })).status;
  results.techOtherTenantMessage = (await route(T.techa, "message", { id: S.ticketB, body: "intrång", staff: true })).status;
  assert.equal(results.techOtherTenantDetail, 400); assert.equal(results.techOtherTenantUpdate, 400); assert.equal(results.techOtherTenantMessage, 400);
  assert.equal(sql(`select status_key from public.tickets where id='${S.ticketB}'`)[0].status_key, "mottaget");
  // PostgREST direct IDOR / anon / forged JWT
  assert.deepEqual(await json(await rest(T.custa, `/tickets?id=eq.${S.ticketB}&select=id`)), []);
  const anon = await fetch(`${G}/rest/v1/tickets?select=id`, { headers: { apikey: fx.anonKey } });
  const anonBody = await anon.text();
  assert.ok(anonBody === "[]" || anon.status === 401 || anon.status === 403, anonBody.slice(0, 200));
  results.forgedJwt = (await fetch(`${G}/rest/v1/tickets?select=id`, { headers: { apikey: fx.anonKey, Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.forged" } })).status;
  assert.equal(results.forgedJwt, 401);
  // invalid input
  results.shortSubject = (await route(T.techa, "create", { input: { customerId: fx.users.custa, subject: "x", description: "kort", category_key: "natverk" } })).status;
  results.badUuid = (await route(T.techa, "detail", { id: "not-a-uuid" })).status;
  results.unknownAction = (await route(T.techa, "drop_tables", {})).status;
  results.badStatus = (await route(T.techa, "update", { id: S.ticketA, changes: { status_key: "raderad" } })).status;
  results.emptyMessage = (await route(T.techa, "message", { id: S.ticketA, body: "   ", staff: true })).status;
  for (const k of ["shortSubject", "badUuid", "unknownAction", "badStatus", "emptyMessage"]) assert.equal(results[k], 400, k);
  const big = await fetch(`${WEB}/api/control/support`, { method: "POST", headers: { Authorization: `Bearer ${T.techa}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "note", args: { id: S.ticketA, body: "x".repeat(130000) } }) });
  results.oversized = big.status; assert.equal(big.status, 413);
  // no session / cookie request with foreign Origin
  results.noAuth = (await fetch(`${WEB}/api/control/support`, { method: "POST", headers: { "Content-Type": "application/json", Origin: WEB }, body: JSON.stringify({ action: "overview", args: {} }) })).status;
  results.foreignOrigin = (await fetch(`${WEB}/api/control/support`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ action: "overview", args: {} }) })).status;
  results.bearerForeignOrigin = (await fetch(`${WEB}/api/control/support`, { method: "POST", headers: { Authorization: `Bearer ${T.techa}`, "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ action: "overview", args: {} }) })).status;
  assert.equal(results.noAuth, 401); assert.equal(results.foreignOrigin, 403); assert.equal(results.bearerForeignOrigin, 403);
  ok("negative matrix support route", JSON.stringify(results));
});

test("B5 double submit: two identical concurrent create requests", async () => {
  const subject = `MP1 dubbel ${run}`;
  const input = { input: { customerId: fx.users.custa, subject, description: "Dubbelklick-simulering MASTER PASS 1.", category_key: "dator" } };
  const statuses = (await Promise.all([route(T.techa, "create", input), route(T.techa, "create", input)])).map((r) => r.status);
  const n = sql(`select count(*)::int n from public.tickets where subject='${subject}'`)[0].n;
  evidence(`INFO double-submit API: statuses=${statuses} tickets=${n} (no idempotency key in the API; UI test covers button lock)`);
  assert.deepEqual(statuses, [200, 200]);
});

test("B6 close, reopen with reason, history visible to customer", async () => {
  for (const status of ["lost", "stangt"]) assert.equal((await route(T.techa, "update", { id: S.ticketA, changes: { status_key: status } })).status, 200);
  const shortReason = await route(T.techa, "reopen", { id: S.ticketA, reason: "x" });
  assert.equal(shortReason.status, 400);
  const reopened = await route(T.techa, "reopen", { id: S.ticketA, reason: "Kunden återkom: VPN tappar igen (MP1)" });
  assert.equal(reopened.status, 200, JSON.stringify(await json(reopened)));
  const detail = (await json(await route(T.custa, "detail", { id: S.ticketA }))).data;
  assert.ok(detail.events.some((e) => e.payload?.reopened === true && String(e.payload.reason).includes("VPN tappar igen")));
  assert.ok(!["lost", "stangt"].includes(detail.ticket.status_key));
  ok("close/reopen", `status after reopen=${detail.ticket.status_key}`);
});

test("B7 audit log access: Super Admin (aal2) reads, technician/customer/aal1 get nothing", async () => {
  const read = async (token) => json(await rest(token, "/support_admin_audit?select=id,action&order=created_at.desc&limit=50"));
  const sa = await read(T.saapi), low = await read(T.saapiAal1), tech = await read(T.techa), cust = await read(T.custa);
  assert.ok(Array.isArray(sa) && sa.length > 0, JSON.stringify(sa).slice(0, 200));
  assert.deepEqual(low, []); assert.deepEqual(tech, []); assert.deepEqual(cust, []);
  ok("support_admin_audit RLS", `sa=${sa.length} rows, aal1/tech/customer=0`);
});

test("B8 customer registration via /api/control/customers (GoTrue admin + DB trigger + audit)", async () => {
  const mail = `ny.kund.${run}@mp1.example.test`;
  const denied = await route(T.techa, null, { full_name: "Nekad Kund", email: `nekad.${run}@mp1.example.test`, phone: "", organization_id: fx.orgs.a }, "/api/control/customers");
  assert.equal(denied.status, 400, "technician without admin+MFA must be refused");
  const deniedAal1 = await route(T.saapiAal1, null, { full_name: "Nekad Kund 2", email: `nekad2.${run}@mp1.example.test`, phone: "", organization_id: fx.orgs.a }, "/api/control/customers");
  assert.equal(deniedAal1.status, 400, "Super Admin at aal1 must be refused");
  assert.equal(sql(`select count(*)::int n from auth.users where email like 'nekad%.${run}@mp1.example.test'`)[0].n, 0, "no auth user created on refusal");
  const r = await route(T.saapi, null, { full_name: "MP1 Registrerad Kund", email: mail, phone: "070-000 00 00", organization_id: fx.orgs.a }, "/api/control/customers");
  const body = await json(r);
  assert.equal(r.status, 201, JSON.stringify(body));
  const profile = sql(`select p.role, p.organization_id, p.login_activation_pending, p.registered_by, p.full_name from public.profiles p where p.id='${body.id}'`)[0];
  evidence(`INFO registration profile: ${JSON.stringify(profile)}`);
  assert.equal(profile.role, "customer");
  assert.equal(profile.organization_id, fx.orgs.a, "registered customer must belong to the chosen organisation");
  assert.equal(profile.login_activation_pending, true, "login must be pending activation");
  assert.equal(profile.registered_by, fx.users.saapi);
  const audit = sql(`select count(*)::int n from public.support_admin_audit where action='customer_registered' and target_id='${body.id}'`)[0].n;
  assert.equal(audit, 1, "registration audited");
  const visible = (await json(await route(T.techa, "overview"))).data.customers.some((c) => c.id === body.id);
  assert.equal(visible, true, "registered org-A customer is selectable for org-A technician");
  const loginNew = await fetch(`${G}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: fx.anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email: mail, password: "gissning-123-ABC" }) });
  assert.notEqual(loginNew.status, 200);
  ok("customer registration", JSON.stringify(profile));
});

test("B9 revocation is immediate for an already issued JWT", async () => {
  const before = (await route(T.techa, "detail", { id: S.ticketA })).status;
  assert.equal(before, 200);
  sqlExec(`update public.support_role_grants set revoked_at=now(), revoked_by='${fx.users.saapi}', revoke_reason='MP1 test av omedelbar återkallelse' where grantee_id='${fx.users.techa}' and revoked_at is null;`);
  const after = (await route(T.techa, "detail", { id: S.ticketA })).status;
  const aiAfter = (await ai(T.techa, "/conversations", { method: "POST", body: JSON.stringify({ organizationId: fx.orgs.a, title: "efter återkallelse" }) })).status;
  sqlExec(`insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,reason) values('${fx.users.techa}','BERRYIT_SUPPORT_TECHNICIAN','organization','${fx.orgs.a}','MP1 återställd scoped tekniker');`);
  assert.equal(after, 400); assert.equal(aiAfter, 403);
  ok("immediate revocation", `route ${before}->${after}, ai create ${aiAfter}`);
});

// ------------------------------------------------------------------ ONARLY AI
test("C1 AI adapter auth + tenant scoped context", async () => {
  assert.equal((await ai(null, "/context")).status, 401);
  assert.equal((await ai("garbage-token-garbage", "/context")).status, 401);
  const ctx = await json(await ai(T.techa, "/context"));
  const orgs = ctx.organizations.map((o) => o.id);
  assert.ok(orgs.includes(fx.orgs.a)); assert.ok(!orgs.includes(fx.orgs.b), "tech must not see org B");
  assert.equal(ctx.gateway.available, true);
  ok("ai context scoped", `orgs=${orgs.length}`);
});

test("C2 AI permission checks: customer and other-tenant conversation creation are refused", async () => {
  const cust = await ai(T.custa, "/conversations", { method: "POST", body: JSON.stringify({ organizationId: fx.orgs.a, title: "kund försöker" }) });
  const other = await ai(T.techa, "/conversations", { method: "POST", body: JSON.stringify({ organizationId: fx.orgs.b, title: "annan kund" }) });
  assert.equal(cust.status, 403, JSON.stringify(await json(cust)));
  assert.equal(other.status, 403);
  const invalid = await ai(T.techa, "/conversations", { method: "POST", body: JSON.stringify({ organizationId: "nope", title: "x" }) });
  assert.equal(invalid.status, 400);
  const notJson = await ai(T.techa, "/conversations", { method: "POST", body: "a=b", headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  assert.equal(notJson.status, 415);
  const huge = await ai(T.techa, "/conversations", { method: "POST", body: JSON.stringify({ organizationId: fx.orgs.a, title: "x".repeat(40000) }) });
  assert.equal(huge.status, 413);
  ok("ai permission + input checks", `customer=${cust.status} otherTenant=${other.status} invalid=400 415 413`);
});

test("C3 AI ask: consent required, tenant-only sources reach gateway, citations filtered, audit written", async () => {
  const conv = await json(await ai(T.techa, "/conversations", { method: "POST", body: JSON.stringify({ organizationId: fx.orgs.a, serviceKey: "natverk", title: `MP1 AI ${run}` }) }));
  assert.ok(conv.conversation?.id, JSON.stringify(conv));
  S.conv = conv.conversation.id;
  const before = stub.requests().length;
  const noConsent = await ai(T.techa, `/conversations/${S.conv}/messages`, { method: "POST", body: JSON.stringify({ text: "Varför tappar VPN?", approvedForAi: false }) });
  assert.equal(noConsent.status, 400); assert.equal((await json(noConsent)).error.code, "CONSENT_REQUIRED");
  assert.equal(stub.requests().length, before, "no gateway call without consent");
  assert.equal(sql(`select count(*)::int n from public.ai_messages where conversation_id='${S.conv}'`)[0].n, 0);
  stub.mode("ok");
  const r = await ai(T.techa, `/conversations/${S.conv}/messages`, { method: "POST", body: JSON.stringify({ text: "Varför tappar VPN anslutningen?", approvedForAi: true }) });
  const body = await json(r);
  assert.equal(r.status, 201, JSON.stringify(body).slice(0, 400));
  const sent = stub.requests().at(-1);
  assert.equal(sent.authOk, true, "adapter must send the server token as Bearer");
  assert.deepEqual(sent.bodyKeys, ["message"]);
  assert.ok(sent.message.includes(S.refA), "org A ticket reference is a source");
  assert.ok(!sent.message.includes(S.refB) && !sent.message.includes(S.subjectB), "org B data must never reach the gateway");
  assert.ok(!sent.message.includes("INTERNAL-MP1-SECRET"), "internal notes are not sent");
  assert.ok(body.response.verifiedFacts.length >= 1);
  assert.ok(body.response.verifiedFacts.every((f) => !f.sourceIds.includes("FOREIGN-TENANT-1")));
  assert.ok(body.response.sources.every((s) => s.id !== "FOREIGN-TENANT-1"));
  assert.ok(body.response.recommendedActions.some((a) => a.risk === "approval-required"), "unknown risk normalised to approval-required");
  const stored = sql(`select role, provider, model from public.ai_messages where conversation_id='${S.conv}' order by created_at`);
  assert.deepEqual(stored.map((m) => m.role), ["user", "assistant"]);
  assert.equal(stored[1].model, "sim-gateway-model");
  S.assistantMsg = body.message.id;
  const audit = sql(`select action from public.ai_audit_events where conversation_id='${S.conv}'`).map((a) => a.action);
  assert.ok(audit.includes("ai.response.created"));
  ok("ai ask chain", `facts=${body.response.verifiedFacts.length} sources=${body.response.sources.map((s) => s.id).join(",")}`);
});

test("C4 AI ask with empty knowledge base and no matching tickets", async () => {
  const conv = (await json(await ai(T.techa, "/conversations", { method: "POST", body: JSON.stringify({ organizationId: fx.orgs.a, serviceKey: "skrivare", title: `MP1 tom KB ${run}` }) }))).conversation;
  const r = await ai(T.techa, `/conversations/${conv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Skrivaren skriver inte ut.", approvedForAi: true }) });
  const body = await json(r);
  assert.equal(r.status, 201, JSON.stringify(body).slice(0, 300));
  assert.ok(stub.requests().at(-1).message.includes("Inga verifierade källor hittades."));
  assert.equal(body.response.verifiedFacts.length, 0, "no fact without an authorised source");
  assert.ok(body.response.missingInformation.length > 0);
  ok("empty KB", `hypotheses=${body.response.hypotheses.length}`);
});

test("C5 AI provider failures: down, 503, 500, 401, html, garbage, timeout -> stable codes + audit", async () => {
  const conv = (await json(await ai(T.techa, "/conversations", { method: "POST", body: JSON.stringify({ organizationId: fx.orgs.a, title: `MP1 fel ${run}` }) }))).conversation;
  S.failConv = conv.id;
  const ask = async () => { const r = await ai(T.techa, `/conversations/${conv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Testa felhantering", approvedForAi: true }) }); return [r.status, (await json(r)).error?.code]; };
  const results = {};
  stub.stop(); results.down = await ask(); stub.start(); await new Promise((r) => setTimeout(r, 1500));
  for (const mode of ["http503", "http500", "unauthorized", "html", "garbage"]) { stub.mode(mode); results[mode] = await ask(); }
  stub.mode("slow"); const t0 = Date.now(); results.slow = await ask(); results.slowMs = Date.now() - t0;
  stub.mode("ok");
  evidence(`INFO provider failures: ${JSON.stringify(results)}`);
  assert.deepEqual(results.down, [502, "GATEWAY_UNAVAILABLE"]);
  assert.deepEqual(results.http503, [503, "GATEWAY_UNAVAILABLE"]);
  assert.deepEqual(results.http500, [502, "GATEWAY_UNAVAILABLE"]);
  assert.deepEqual(results.unauthorized, [502, "GATEWAY_AUTH_ERROR"]);
  assert.deepEqual(results.html, [502, "GATEWAY_RESPONSE_INVALID"]);
  assert.equal(results.garbage[0], 502);
  assert.deepEqual(results.slow, [504, "GATEWAY_TIMEOUT"]);
  const failures = sql(`select metadata->>'code' code from public.ai_audit_events where conversation_id='${conv.id}' and action='ai.request.failed'`).map((r) => r.code);
  assert.equal(failures.length, 7, JSON.stringify(failures));
  const msgs = sql(`select role from public.ai_messages where conversation_id='${conv.id}'`).map((m) => m.role);
  evidence(`INFO messages persisted after 7 failed asks: ${JSON.stringify(msgs)}`);
  assert.equal(msgs.filter((m) => m === "assistant").length, 0, "no fake assistant answer on failure");
  // recovery: same conversation works again
  const [status] = await ask();
  assert.equal(status, 201);
  ok("provider failure matrix", JSON.stringify(results));
});

test("C6 AI -> support ticket (explicit confirmation) and KB promotion used by next answer", async () => {
  assert.equal((await ai(T.techa, `/conversations/${S.conv}/tickets`, { method: "POST", body: JSON.stringify({ confirm: false }) })).status, 400);
  const t = await json(await ai(T.techa, `/conversations/${S.conv}/tickets`, { method: "POST", body: JSON.stringify({ confirm: true }) }));
  assert.match(t.ticket?.reference ?? "", /^BIT-/, JSON.stringify(t));
  const ticket = sql(`select organization_id, requester_id, source, external_channel, category_key from public.tickets where id='${t.ticket.id}'`)[0];
  assert.deepEqual(ticket, { organization_id: fx.orgs.a, requester_id: fx.users.techa, source: "api", external_channel: "onarly-ai", category_key: "natverk" });
  const overview = (await json(await route(T.techa, "overview"))).data;
  assert.ok(overview.tickets.some((x) => x.id === t.ticket.id), "AI ticket visible in Support Desk overview");
  const userMsg = sql(`select id from public.ai_messages where conversation_id='${S.conv}' and role='user' limit 1`)[0].id;
  const wrong = await ai(T.techa, `/conversations/${S.conv}/knowledge`, { method: "POST", body: JSON.stringify({ assistantMessageId: userMsg, title: "Fel källa", problem: "VPN tappar", verifiedSolution: "Byt DNS" }) });
  assert.equal(wrong.status, 400); assert.equal((await json(wrong)).error.code, "NO_VERIFIED_SOLUTION");
  const kb = await json(await ai(T.techa, `/conversations/${S.conv}/knowledge`, { method: "POST", body: JSON.stringify({ assistantMessageId: S.assistantMsg, title: `MP1 VPN DNS-lösning ${run}`, problem: "VPN tappar anslutningen", verifiedSolution: "Sätt intern DNS på VPN-adaptern." }) }));
  assert.ok(kb.knowledge?.id, JSON.stringify(kb));
  const next = await ai(T.techa, `/conversations/${S.conv}/messages`, { method: "POST", body: JSON.stringify({ text: "Händer det igen?", approvedForAi: true }) });
  assert.equal(next.status, 201);
  const prompt = stub.requests().at(-1).message;
  assert.ok(prompt.includes(`MP1 VPN DNS-lösning ${run}`) && /\[KB-[0-9A-F]{12}\] knowledge/.test(prompt), "verified KB entry is used as source");
  const custKb = await json(await rest(T.custa, "/ai_knowledge_entries?select=id"));
  const otherKb = await json(await rest(T.custb, "/ai_knowledge_entries?select=id"));
  assert.deepEqual(custKb, []); assert.deepEqual(otherKb, []);
  const actions = sql(`select action from public.ai_audit_events where conversation_id='${S.conv}' order by created_at`).map((a) => a.action);
  assert.ok(actions.includes("ai.ticket.created") && actions.includes("ai.knowledge.verified"), JSON.stringify(actions));
  ok("ai ticket + KB", `${t.ticket.reference}; audit=${actions.join(",")}`);
});

test("C7 AI cross-tenant reads and audit visibility", async () => {
  const convB = (await json(await ai(T.saapi, "/conversations", { method: "POST", body: JSON.stringify({ organizationId: fx.orgs.b, title: `MP1 B-konversation ${run}` }) }))).conversation;
  assert.ok(convB?.id, "Super Admin can open org B conversation");
  const read = await ai(T.techa, `/conversations/${convB.id}/messages`);
  const list = await json(await ai(T.techa, `/conversations?organizationId=${fx.orgs.b}`));
  const kb = await ai(T.techa, `/conversations/${convB.id}/knowledge`, { method: "POST", body: JSON.stringify({ assistantMessageId: S.assistantMsg, title: "Stöld av lösning", problem: "abc", verifiedSolution: "abc" }) });
  const ticket = await ai(T.techa, `/conversations/${convB.id}/tickets`, { method: "POST", body: JSON.stringify({ confirm: true }) });
  assert.equal(read.status, 403); assert.deepEqual(list.conversations, []); assert.equal(kb.status, 403); assert.equal(ticket.status, 403);
  const saAudit = await json(await rest(T.saapi, "/ai_audit_events?select=action&limit=200"));
  const techAudit = await json(await rest(T.techa, "/ai_audit_events?select=action"));
  assert.ok(saAudit.length > 0); assert.deepEqual(techAudit, []);
  ok("ai cross-tenant", `read=${read.status} kb=${kb.status} ticket=${ticket.status}; audit sa=${saAudit.length} tech=0`);
});

test("C8 AI rate limit (20/min per user) answers 429 without calling the gateway", async () => {
  const before = stub.requests().length;
  const statuses = [];
  for (let i = 0; i < 21; i++) statuses.push((await ai(T.saapi, `/conversations/${S.conv}/messages`, { method: "POST", body: JSON.stringify({ text: "spam", approvedForAi: false }) })).status);
  assert.equal(statuses.at(-1), 429, JSON.stringify(statuses));
  assert.equal(stub.requests().length, before);
  ok("ai rate limit", `last=${statuses.at(-1)}`);
});
