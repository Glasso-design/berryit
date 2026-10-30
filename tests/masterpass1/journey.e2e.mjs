// MASTER PASS 3 — the complete BERRYiT user journey, REAL, on the throwaway CI stack
// (GoTrue / PostgREST / Storage / supabase-postgres from deploy/berryit-support/compose.yaml,
// the Next.js Control Center via `next start`, the Desktop UI build in Chromium, the ONARLY AI
// adapter twice: with the SIM gateway on :8700 and WITHOUT any gateway on :8798, which is the
// production default because the ONARLY AI Gateway source does not exist).
// Runs after api.e2e/ui.e2e (same fixture) and before ops.e2e (which replaces GoTrue).
//   J1 registration: company + private customer (Super Admin, MFA), double click, lost answer -> retry
//   J2 tickets + assignment per role + technician workflow (web), private ticket isolation
//   J3 broken connection / lost answer in the web Support Desk: one ticket, one message, one note
//   J4 Desktop Support Desk offline -> error, text kept, retry -> one message
//   J5 AI not available (no gateway): API refuses before storing, Desktop shows it, web has no fake AI
//   J6 knowledge base: save a verified solution from an answer (SIM gateway), listed in the KB view
//   J7 Sök felet (M7) REAL: lost create answer + failed history reload -> ONE conversation, analysis
//   J8 audit trail: Super Admin reads it in the UI; technician does not; DB rows exact
//   J9 role assignment (permissions per role) through /api/control/access: grant gives access at once,
//      revoke removes it at once for the same JWT; technician and aal1 Super Admin are refused; audited
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { fx, G, WEB, sql, sqlExec, stub, totp, json, login, loginAal2, rest, route, evidence } from "./lib.mjs";
// lib.mjs refuses to run outside the throwaway CI runner and refuses non-loopback targets.

const shots = `${process.env.MP1_DIR}/screenshots`;
const run = Date.now().toString(36);
const AI_OFF = fx.aiDisabled ?? "http://127.0.0.1:8798";
const CONNECTION = "Ingen kontakt med servern";
const ok = (label, detail = "") => evidence(`PASS ${label}${detail ? " — " + detail : ""}`);
const q = (value) => String(value).replace(/'/g, "''");
let browser;
const S = {}; // shared journey state

test.before(async () => { await mkdir(shots, { recursive: true }); browser = await chromium.launch(); });
test.after(async () => { await S.sa?.context.close().catch(() => {}); await browser?.close(); });

const admin = (path, init = {}) => fetch(`${G}/auth/v1${path}`, { ...init, headers: { apikey: fx.serviceKey, Authorization: `Bearer ${fx.serviceKey}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
async function createUser(name, fullName) {
  const body = await json(await admin("/admin/users", { method: "POST", body: JSON.stringify({ email: `${name}@mp1.example.test`, password: fx.password, email_confirm: true, user_metadata: { full_name: fullName } }) }));
  assert.ok(body.id, `create ${name}: ${JSON.stringify(body).slice(0, 200)}`);
  return body.id;
}

async function webLogin(name, { viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport, locale: "sv-SE" });
  const page = await context.newPage();
  await page.goto(`${WEB}/control`);
  await page.waitForURL(/\/control\/login/);
  await page.getByLabel("E-post").fill(`${name}@mp1.example.test`);
  await page.getByLabel("Lösenord").fill(fx.password);
  await page.getByRole("button", { name: "Logga in" }).click();
  return { context, page };
}

async function noHorizontalOverflow(page, label) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  await page.screenshot({ path: `${shots}/${label}.png`, fullPage: true });
  evidence(`INFO 390px ${label}: scrollWidth=${m.sw} clientWidth=${m.cw}`);
  assert.ok(m.sw <= m.cw + 1, `${label}: horizontal overflow ${m.sw} > ${m.cw}`);
}

/** Waits for an alert containing `expected`; on timeout the assertion names what the alerts actually said. */
async function expectAlert(page, expected, label) {
  const hit = page.getByRole("alert").filter({ hasText: expected }).first();
  try { await hit.waitFor({ timeout: 20000 }); }
  catch { assert.fail(`${label}: expected an alert containing "${expected}", the page shows: ${JSON.stringify(await page.getByRole("alert").allTextContents())}`); }
  evidence(`INFO ${label}: alert "${(await hit.textContent()).slice(0, 160)}"`);
}

/** Lets the request reach the server, then drops the connection before the answer reaches the browser. */
async function loseAnswer(route, label) {
  const response = await route.fetch();
  evidence(`INFO lost answer injected (${label}): server answered HTTP ${response.status()}, browser sees a dropped connection`);
  await route.abort("connectionreset");
}

function desktopServer(root, target, aiTarget = target) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (/^\/(auth|rest|storage|ai)\/v1\//.test(url.pathname)) {
      const upstreamBase = url.pathname.startsWith("/ai/v1/") ? aiTarget : target;
      const upstream = httpRequest(upstreamBase + req.url, { method: req.method, headers: { ...req.headers, host: new URL(upstreamBase).host } }, (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); });
      upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(upstream);
      return;
    }
    const path = resolve(root, "." + (url.pathname === "/" ? "/index.html" : url.pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try { const body = await readFile(path); res.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream"); res.end(body); }
    catch { res.setHeader("Content-Type", "text/html"); res.end(await readFile(resolve(root, "index.html"))); }
  });
}

async function withDesktop(aiTarget, user, fn) {
  const server = desktopServer(resolve("desktop/dist"), fx.gateway, aiTarget);
  await new Promise((r) => server.listen(3602, "127.0.0.1", r));
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "sv-SE" });
  const page = await context.newPage();
  try {
    await page.goto("http://127.0.0.1:3602/");
    await page.getByRole("heading", { name: "Logga in" }).waitFor();
    await page.getByRole("status").filter({ hasText: "Ansluten till BERRYiT." }).waitFor({ timeout: 15000 });
    await page.getByLabel("E-post").fill(`${user}@mp1.example.test`);
    await page.getByLabel("Lösenord").fill(fx.password);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    await page.getByRole("navigation", { name: "Huvudmeny" }).waitFor({ timeout: 20000 });
    await fn(page, context);
  } finally {
    await context.close();
    await new Promise((r) => server.close(r));
  }
}
const desktopNav = (page, name) => page.getByRole("navigation", { name: "Huvudmeny" }).getByRole("button", { name, exact: true }).click();

// ---------------------------------------------------------------------------------------------- J1
test("J1 registration (web, Super Admin with MFA): company + private customer; double click and a lost answer register ONE account each", async () => {
  S.saId = await createUser(`sa3.${run}`, "MP3 Super Admin");
  sqlExec(`update public.profiles set role='admin' where id='${S.saId}';
    insert into public.support_role_grants(grantee_id,role_key,scope,reason) values ('${S.saId}','BERRYIT_SUPPORT_SUPER_ADMIN','global','MP3 syntetiskt ägarbeslut (CI-runner)');`);
  const { context, page } = await webLogin(`sa3.${run}`);
  S.sa = { context, page };
  await page.waitForURL(/\/control\/mfa/);
  const secret = (await page.locator("code").first().textContent()).trim();
  await page.getByLabel("Engångskod").fill(totp(secret));
  await page.getByRole("button", { name: /Aktivera tvåfaktor|Verifiera/ }).click();
  await page.waitForURL(`${WEB}/control`, { timeout: 20000 });
  await page.getByText("Inloggad som Super Admin").waitFor();

  await page.goto(`${WEB}/control/kunder`);
  const form = page.getByRole("form", { name: "Registrera kund" });
  await form.waitFor({ timeout: 20000 });
  // Company customer, double click on the submit button.
  S.company = { name: `MP3 Företagskund ${run}`, email: `mp3.foretag.${run}@mp1.example.test` };
  await form.getByLabel("Kundens namn").fill(S.company.name);
  await form.getByLabel("Kundens e-post").fill(S.company.email);
  await form.getByLabel("Kundens organisation").selectOption({ label: "MP1 Kund A AB" });
  await form.getByRole("button", { name: "Registrera kund utan aktiverad inloggning" }).dblclick();
  await page.getByRole("status").filter({ hasText: "Kund registrerad." }).waitFor({ timeout: 20000 });
  const companyRows = sql(`select u.id, p.organization_id, p.login_activation_pending, p.registered_by from auth.users u join public.profiles p on p.id=u.id where u.email='${S.company.email}'`);
  evidence(`INFO J1 company registration (double click): ${JSON.stringify(companyRows)}`);
  assert.equal(companyRows.length, 1, "double click registers exactly one account");
  assert.deepEqual(companyRows.map(({ organization_id, login_activation_pending, registered_by }) => ({ organization_id, login_activation_pending, registered_by })), [{ organization_id: fx.orgs.a, login_activation_pending: true, registered_by: S.saId }]);
  S.company.id = companyRows[0].id;

  // Private customer: the first answer is lost after the server registered the account.
  S.private = { name: `MP3 Privatkund ${run}`, email: `mp3.privat.${run}@mp1.example.test` };
  let lost = 0;
  await page.route((url) => url.pathname === "/api/control/customers", async (r) => { if (lost++ === 0) return loseAnswer(r, "registration"); return r.continue(); });
  await form.getByLabel("Kundens namn").fill(S.private.name);
  await form.getByLabel("Kundens e-post").fill(S.private.email);
  await form.getByLabel("Kundens organisation").selectOption({ label: "Privatperson — ingen organisation" });
  await form.getByRole("button", { name: "Registrera kund utan aktiverad inloggning" }).click();
  await expectAlert(page, CONNECTION, "J1 registration lost answer");
  assert.equal(await form.getByLabel("Kundens e-post").inputValue(), S.private.email, "the form keeps what was typed after a lost connection");
  await form.getByRole("button", { name: "Registrera kund utan aktiverad inloggning" }).click();
  await expectAlert(page, "Det finns redan ett konto med den e-postadressen", "J1 registration retry");
  await page.getByRole("cell", { name: S.private.name, exact: true }).waitFor({ timeout: 20000 });
  await page.unrouteAll({ behavior: "ignoreErrors" });
  const privateRows = sql(`select u.id, p.organization_id, p.login_activation_pending, p.registered_by from auth.users u join public.profiles p on p.id=u.id where u.email='${S.private.email}'`);
  evidence(`INFO J1 private registration (lost answer + retry): ${JSON.stringify(privateRows)}`);
  assert.equal(privateRows.length, 1, "a retry after a lost answer never creates a second account");
  assert.deepEqual({ organization_id: privateRows[0].organization_id, login_activation_pending: privateRows[0].login_activation_pending, registered_by: privateRows[0].registered_by }, { organization_id: null, login_activation_pending: true, registered_by: S.saId });
  S.private.id = privateRows[0].id;
  // Registered customers cannot log in until an administrator activates them separately:
  // unconfirmed address and a long ban in GoTrue, no password was ever handed out.
  const locked = sql(`select count(*)::int n from auth.users where id in ('${S.company.id}','${S.private.id}') and banned_until > now() + interval '10 years' and email_confirmed_at is null`)[0].n;
  assert.equal(locked, 2, "both registered accounts are locked until a separate activation");
  const audit = sql(`select target_id, action, actor_id, scope::text from public.support_admin_audit where target_id in ('${S.company.id}','${S.private.id}') order by id`);
  evidence(`INFO J1 audit rows: ${JSON.stringify(audit)}`);
  assert.deepEqual(audit, [
    { target_id: S.company.id, action: "customer_registered", actor_id: S.saId, scope: "organization" },
    { target_id: S.private.id, action: "customer_registered", actor_id: S.saId, scope: "global" },
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page, "j1-kunder-superadmin-390");
  await page.setViewportSize({ width: 1280, height: 900 });
  ok("J1 registration company + private", `1 account each; lost answer -> "finns redan"; 1 audit row each`);
});

// ---------------------------------------------------------------------------------------------- J2
test("J2 tickets: Super Admin creates for both customers and assigns; technician A works the company ticket, never sees the private one", async () => {
  const { page } = S.sa;
  await page.goto(`${WEB}/control/support`);
  const form = page.getByRole("form", { name: "Skapa supportärende" });
  await form.waitFor({ timeout: 20000 });
  const create = async (customerLabel, subject) => {
    await form.getByLabel("Välj kund").selectOption({ label: customerLabel });
    await form.getByLabel("Ämne").fill(subject);
    await form.getByLabel("Beskrivning").fill("Skapat i MASTER PASS 3-resan av Super Admin.");
    await form.getByLabel("Kategori").selectOption("dator");
    await form.getByRole("button", { name: "Skapa ärende" }).click();
    // The detail of the NEW ticket opens after a successful create (the notice text alone could be stale).
    await page.getByRole("article", { name: "Ärendedetaljer" }).getByRole("heading", { name: new RegExp(`· ${subject}$`) }).waitFor({ timeout: 20000 });
    return sql(`select id, reference, organization_id, requester_id from public.tickets where subject='${q(subject)}'`);
  };
  const priv = await create(`${S.private.name} · Privatperson`, `MP3 privat ärende ${run}`);
  assert.equal(priv.length, 1); assert.equal(priv[0].organization_id, null); assert.equal(priv[0].requester_id, S.private.id);
  S.privateTicket = priv[0];
  const detail = page.getByRole("article", { name: "Ärendedetaljer" });
  await detail.waitFor();
  const privateOptions = await detail.getByLabel("Tilldela tekniker").locator("option").allTextContents();
  assert.ok(!privateOptions.some((o) => o.startsWith("MP1 techa")), `an organisation-scoped technician must not be offered for a private customer: ${JSON.stringify(privateOptions)}`);
  const comp = await create(`${S.company.name} · MP1 Kund A AB`, `MP3 företagsärende ${run}`);
  assert.equal(comp.length, 1); assert.equal(comp[0].organization_id, fx.orgs.a);
  S.companyTicket = comp[0];
  await detail.getByLabel("Tilldela tekniker").selectOption(fx.users.techa);
  await page.getByRole("status").filter({ hasText: "Tilldelningen är uppdaterad." }).waitFor({ timeout: 20000 });
  const assigned = sql(`select t.assignee_id, (select count(*)::int from public.ticket_events e where e.ticket_id=t.id and e.event_type='assigned' and e.actor_id='${S.saId}') events from public.tickets t where t.id='${S.companyTicket.id}'`)[0];
  assert.deepEqual(assigned, { assignee_id: fx.users.techa, events: 1 });

  // Technician A (organisation scope A, no tickets.reassign)
  const tech = await webLogin("techa");
  await tech.page.waitForURL(`${WEB}/control`);
  await tech.page.goto(`${WEB}/control/support`);
  await tech.page.getByRole("table").waitFor({ timeout: 20000 });
  assert.equal(await tech.page.getByRole("button", { name: S.privateTicket.reference, exact: true }).count(), 0, "technician A must not see the private customer's ticket");
  await tech.page.goto(`${WEB}/control/support?arende=${S.companyTicket.reference}`);
  const work = tech.page.getByRole("article", { name: "Ärendedetaljer" });
  await work.waitFor({ timeout: 20000 });
  await work.getByText("MP1 techa").first().waitFor();
  assert.equal(await work.getByLabel("Tilldela tekniker").isDisabled(), true, "technician without tickets.reassign gets no live assignment control");
  const step = async (button, notice) => { await work.getByRole("button", { name: button, exact: true }).click(); await tech.page.getByRole("status").filter({ hasText: notice }).waitFor({ timeout: 20000 }); };
  await step("Markera som pågående", "Ärendet pågår.");
  await work.getByLabel("Nytt kundmeddelande").fill(`MP3 svar till kunden ${run}`);
  await step("Skicka kundmeddelande", "Kundmeddelandet är registrerat.");
  await work.getByLabel("Felsökning och utförd åtgärd").fill(`MP3 intern felsökning ${run}`);
  await step("Spara intern anteckning", "Intern arbetsanteckning sparad.");
  await work.getByLabel("Välj bilaga (högst 25 MB)").setInputFiles({ name: "logg.txt", mimeType: "text/plain", buffer: Buffer.from(`MP3 logg ${run}`) });
  await work.getByLabel("Bilagans synlighet").selectOption("internal");
  await step("Ladda upp bilaga", "Bilagan är uppladdad.");
  await step("Markera som löst", "Ärendet är löst.");
  await step("Avsluta ärende", "Ärendet är avslutat.");
  await work.getByLabel("Orsak till återöppning").fill(`Felet kom tillbaka (MP3 ${run})`);
  await step("Återöppna ärende", "Ärendet är återöppnat");
  await tech.page.getByLabel("Ärendehistorik").filter({ hasText: `Felet kom tillbaka (MP3 ${run})` }).waitFor();
  const state = sql(`select t.status_key, t.closed_at is not null closed_before, (select count(*)::int from public.ticket_messages m where m.ticket_id=t.id) msgs, (select count(*)::int from public.ticket_internal_notes n where n.ticket_id=t.id) notes, (select count(*)::int from public.ticket_attachments a where a.ticket_id=t.id and a.upload_completed_at is not null and a.visibility='internal') files, (select string_agg(e.event_type || coalesce(':' || e.to_value, ''), ',' order by e.created_at, e.id) from public.ticket_events e where e.ticket_id=t.id) events from public.tickets t where t.id='${S.companyTicket.id}'`)[0];
  evidence(`INFO J2 technician workflow: ${JSON.stringify(state)}`);
  assert.ok(!["lost", "stangt"].includes(state.status_key), `reopened ticket is open again: ${state.status_key}`);
  assert.deepEqual({ msgs: state.msgs, notes: state.notes, files: state.files }, { msgs: 1, notes: 1, files: 1 });
  for (const e of ["created", "assigned", "status_changed:pagar", "status_changed:lost", "status_changed:stangt"]) assert.ok(state.events.includes(e), `event ${e} in ${state.events}`);
  await tech.page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(tech.page, "j2-support-detail-technician-390");
  await tech.context.close();
  ok("J2 tickets + assignment + technician workflow", `${S.companyTicket.reference} (company, assigned by SA) worked by techa; ${S.privateTicket.reference} (private) invisible to techa`);
});

// ---------------------------------------------------------------------------------------------- J3
test("J3 broken connection (web): lost answer on create and on a message, offline note -> error shown, text kept, retry stores ONE", async () => {
  const { context, page } = await webLogin("techa");
  try {
    await page.waitForURL(`${WEB}/control`);
    await page.goto(`${WEB}/control/support`);
    const form = page.getByRole("form", { name: "Skapa supportärende" });
    await form.waitFor({ timeout: 20000 });
    let lostCreate = 0, lostMessage = 0;
    await page.route((url) => url.pathname === "/api/control/support", async (r) => {
      const body = r.request().postData() ?? "";
      if (body.includes('"action":"create"') && lostCreate++ === 0) return loseAnswer(r, "ticket create");
      if (body.includes('"action":"message"') && lostMessage++ === 0) return loseAnswer(r, "customer message");
      return r.continue();
    });
    const subject = `MP3 tappad anslutning ${run}`;
    const options = await form.getByLabel("Välj kund").locator("option").allTextContents();
    await form.getByLabel("Välj kund").selectOption({ label: options.find((o) => o.startsWith("MP1 custa")) });
    await form.getByLabel("Ämne").fill(subject);
    await form.getByLabel("Beskrivning").fill("Svaret på skapa-anropet tappas efter att servern sparat.");
    await form.getByLabel("Kategori").selectOption("dator");
    await form.getByRole("button", { name: "Skapa ärende" }).click();
    await expectAlert(page, CONNECTION, "J3 create lost answer");
    assert.equal(await form.getByLabel("Ämne").inputValue(), subject, "the create form keeps its values");
    const afterLost = sql(`select count(*)::int n from public.tickets where subject='${q(subject)}'`)[0].n;
    await form.getByRole("button", { name: "Skapa ärende" }).click();
    await page.getByRole("status").filter({ hasText: "Ärendet är skapat." }).waitFor({ timeout: 20000 });
    const tickets = sql(`select id, reference from public.tickets where subject='${q(subject)}'`);
    evidence(`INFO J3 create: after lost answer ${afterLost} ticket(s) on the server, after retry ${tickets.length}`);
    assert.equal(afterLost, 1, "the lost request did reach the server");
    assert.equal(tickets.length, 1, "retry after a lost answer creates no second ticket");
    S.brokenTicket = tickets[0];

    const detail = page.getByRole("article", { name: "Ärendedetaljer" });
    await detail.waitFor();
    const message = `MP3 meddelande vid avbrott ${run}`;
    await detail.getByLabel("Nytt kundmeddelande").fill(message);
    await detail.getByRole("button", { name: "Skicka kundmeddelande" }).click();
    await expectAlert(page, CONNECTION, "J3 message lost answer");
    assert.equal(await detail.count(), 1, "the ticket stays open after a lost connection");
    assert.equal(await detail.getByLabel("Nytt kundmeddelande").inputValue(), message, "the message text is kept");
    await detail.getByRole("button", { name: "Skicka kundmeddelande" }).click();
    await page.getByRole("status").filter({ hasText: "Kundmeddelandet är registrerat." }).waitFor({ timeout: 20000 });
    const msgs = sql(`select count(*)::int n from public.ticket_messages where ticket_id='${S.brokenTicket.id}' and body='${q(message)}'`)[0].n;
    assert.equal(msgs, 1, "retry after a lost answer stores the message once");

    const note = `MP3 anteckning offline ${run}`;
    await detail.getByLabel("Felsökning och utförd åtgärd").fill(note);
    await context.setOffline(true);
    await detail.getByRole("button", { name: "Spara intern anteckning" }).click();
    await expectAlert(page, CONNECTION, "J3 note offline");
    assert.equal(await detail.getByLabel("Felsökning och utförd åtgärd").inputValue(), note);
    const offlineNotes = sql(`select count(*)::int n from public.ticket_internal_notes where ticket_id='${S.brokenTicket.id}'`)[0].n;
    await context.setOffline(false);
    await detail.getByRole("button", { name: "Spara intern anteckning" }).click();
    await page.getByRole("status").filter({ hasText: "Intern arbetsanteckning sparad." }).waitFor({ timeout: 20000 });
    const notes = sql(`select count(*)::int n from public.ticket_internal_notes where ticket_id='${S.brokenTicket.id}' and body='${q(note)}'`)[0].n;
    await page.screenshot({ path: `${shots}/j3-web-after-retries.png`, fullPage: true });
    assert.equal(offlineNotes, 0, "offline: nothing reached the server");
    assert.equal(notes, 1);
    ok("J3 web broken connection", `ticket 1 (lost answer), message 1 (lost answer), note 1 (offline)`);
  } finally { await context.close(); }
});

// ---------------------------------------------------------------------------------------------- J4
test("J4 Desktop Support Desk offline: error shown, ticket and text kept, retry stores ONE message", async () => {
  await withDesktop(fx.gateway, "techa", async (page, context) => {
    await desktopNav(page, "Support Desk");
    await page.getByRole("button", { name: S.brokenTicket.reference, exact: true }).click({ timeout: 20000 });
    const detail = page.getByRole("article", { name: "Ärendedetaljer" });
    await detail.waitFor({ timeout: 20000 });
    const message = `MP3 desktop offline ${run}`;
    await detail.getByLabel("Nytt kundmeddelande").fill(message);
    await context.setOffline(true);
    await detail.getByRole("button", { name: "Skicka kundmeddelande" }).click();
    await expectAlert(page, CONNECTION, "J4 desktop message offline");
    assert.equal(await detail.count(), 1);
    assert.equal(await detail.getByLabel("Nytt kundmeddelande").inputValue(), message);
    await context.setOffline(false);
    await detail.getByRole("button", { name: "Skicka kundmeddelande" }).click();
    await page.getByRole("status").filter({ hasText: "Kundmeddelandet är registrerat." }).waitFor({ timeout: 20000 });
    await page.screenshot({ path: `${shots}/j4-desktop-offline-retry.png`, fullPage: true });
    const n = sql(`select count(*)::int n from public.ticket_messages where ticket_id='${S.brokenTicket.id}' and body='${q(message)}'`)[0].n;
    assert.equal(n, 1);
    ok("J4 desktop broken connection", "error + kept text + 1 message after retry");
  });
});

// ---------------------------------------------------------------------------------------------- J5
test("J5 AI not available (no gateway configured, the production default): refused before storing, Desktop says so, web has no AI button", async () => {
  const tech = await login("techa");
  const off = (path, init = {}) => fetch(`${AI_OFF}/ai/v1${path}`, { ...init, headers: { Authorization: `Bearer ${tech.token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) } });
  const health = await json(await fetch(`${AI_OFF}/ai/v1/health`));
  assert.deepEqual(health, { status: "ok", gateway: "disabled" });
  const context = await json(await off("/context"));
  assert.equal(context.gateway?.available, false, JSON.stringify(context).slice(0, 300));
  assert.match(context.gateway.reason, /saknar serverkonfiguration/);
  const stubBefore = stub.requests().length;
  const conversation = (await json(await off("/conversations", { method: "POST", body: JSON.stringify({ id: randomUUID(), organizationId: fx.orgs.a, title: `MP3 utan gateway ${run}` }) }))).conversation;
  assert.ok(conversation?.id);
  const asked = await off(`/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ text: "Varför tappar VPN anslutningen?", approvedForAi: true, messageId: randomUUID() }) });
  const askedBody = await json(asked);
  const stored = sql(`select count(*)::int n from public.ai_messages where conversation_id='${conversation.id}'`)[0].n;
  const audit = sql(`select action, metadata->>'code' code from public.ai_audit_events where conversation_id='${conversation.id}'`);
  evidence(`INFO J5 API without gateway: HTTP ${asked.status} ${JSON.stringify(askedBody.error)} stored=${stored} audit=${JSON.stringify(audit)} gatewayRequests=${stub.requests().length - stubBefore}`);
  assert.equal(asked.status, 503); assert.equal(askedBody.error.code, "GATEWAY_DISABLED");
  assert.equal(stored, 0, "no unanswered question is stored");
  assert.deepEqual(audit, [{ action: "ai.request.failed", code: "GATEWAY_DISABLED" }]);
  assert.equal(stub.requests().length, stubBefore, "nothing reached any gateway");

  await withDesktop(AI_OFF, "techa", async (page) => {
    await desktopNav(page, "Ask ONARLY AI");
    await page.getByRole("heading", { name: "Ask ONARLY AI" }).waitFor();
    const panel = page.getByRole("status", { name: "ONARLY AI är inte tillgänglig" });
    await panel.waitFor({ timeout: 20000 });
    assert.match(await panel.textContent(), /saknar serverkonfiguration.*Inga frågor skickas och inga AI-svar skapas/s);
    await page.getByText("Gateway ej ansluten", { exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder("Fråga om ett fel, kod, drift eller ett supportärende…").isDisabled(), true);
    assert.equal(await page.getByLabel(/Jag har granskat texten/).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Fråga ONARLY AI", exact: true }).isDisabled(), true);
    // Saved history and the knowledge base stay readable without a gateway (C6 saved a verified solution for org A).
    await page.getByRole("region", { name: "Kunskapsbas" }).getByText(/MP1 VPN DNS-lösning/).first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: /MP1 /, exact: false }).first().waitFor();
    await page.screenshot({ path: `${shots}/j5-desktop-ai-unavailable.png`, fullPage: true });
  });

  const web = await webLogin("techa", { viewport: { width: 390, height: 844 } });
  await web.page.waitForURL(`${WEB}/control`);
  await web.page.goto(`${WEB}/control/ai`);
  await web.page.getByText("Ask ONARLY AI finns i Desktop").waitFor({ timeout: 20000 });
  assert.equal(await web.page.getByRole("button", { name: /Fråga ONARLY AI/ }).count(), 0, "the web module offers no AI button it cannot back");
  await noHorizontalOverflow(web.page, "j5-web-ai-390");
  await web.context.close();
  ok("J5 AI unavailable", "503 GATEWAY_DISABLED before storing; audit ai.request.failed; Desktop panel + disabled inputs; KB/history readable; web: no AI control");
});

// ---------------------------------------------------------------------------------------------- J6
test("J6 knowledge base: a verified solution saved from an answer (SIM gateway) is listed for technician A", async () => {
  await withDesktop(fx.gateway, "techa", async (page) => {
    stub.mode("ok");
    await desktopNav(page, "Ask ONARLY AI");
    await page.getByRole("heading", { name: "Ask ONARLY AI" }).waitFor();
    await page.getByRole("button", { name: "Ny chatt" }).click();
    const title = `MP3 KB-fråga ${run}`;
    await page.getByPlaceholder("Fråga om ett fel, kod, drift eller ett supportärende…").fill(title);
    await page.getByLabel(/Jag har granskat texten/).check();
    await page.getByRole("button", { name: "Fråga ONARLY AI", exact: true }).click();
    await page.getByRole("heading", { name: "Hypoteser" }).first().waitFor({ timeout: 30000 });
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Spara verifierad lösning", exact: true }).click();
    await page.getByText("sparades som verifierad lösning").waitFor({ timeout: 20000 });
    await page.getByRole("region", { name: "Kunskapsbas" }).getByRole("article", { name: title }).waitFor({ timeout: 20000 });
    await page.screenshot({ path: `${shots}/j6-desktop-kb.png`, fullPage: true });
    const rows = sql(`select k.organization_id, k.verified_by, (select count(*)::int from public.ai_audit_events a where a.action='ai.knowledge.verified' and a.metadata->>'knowledge_id'=k.id::text) audit from public.ai_knowledge_entries k where k.title='${q(title)}'`);
    assert.deepEqual(rows, [{ organization_id: fx.orgs.a, verified_by: fx.users.techa, audit: 1 }]);
    const custB = await login("custb");
    assert.deepEqual(await json(await rest(custB.token, `/ai_knowledge_entries?select=id&title=eq.${encodeURIComponent(title)}`)), [], "other tenant's customer sees no KB entry");
    ok("J6 knowledge base", `entry "${title}" verified by techa, audited, listed in Desktop`);
  });
});

// ---------------------------------------------------------------------------------------------- J7
test("J7 Sök felet (M7, REAL): lost create answer + failed history reload still give ONE conversation; preview -> approved analysis", async () => {
  const devId = await createUser(`dev3.${run}`, "MP3 Utvecklare");
  const project = randomUUID(), service = randomUUID(), incident = randomUUID();
  sqlExec(`insert into public.support_projects(id,organization_id,name,created_by) values ('${project}','${fx.orgs.a}','MP3 Felsökt projekt ${run}','${fx.users.saapi}');
    insert into public.support_role_grants(grantee_id,role_key,scope,organization_id,project_id,reason) values ('${devId}','BERRYIT_DEVELOPER','organization','${fx.orgs.a}','${project}','MP3 syntetisk diagnostikscope');
    insert into public.infra_services(id,organization_id,project_id,name,service_kind) values ('${service}','${fx.orgs.a}','${project}','MP3 app','web');
    insert into public.service_status_checks(organization_id,service_id,status_key,source,detail) values ('${fx.orgs.a}','${service}','degraded','http_health','{}');
    insert into public.monitoring_samples(organization_id,service_id,metric_key,value,source,detail) values ('${fx.orgs.a}','${service}','cpu_percent',99,'agent','{}');
    insert into public.incidents(id,organization_id,project_id,service_id,title,summary,severity,metric_key) values ('${incident}','${fx.orgs.a}','${project}','${service}','MP3 CPU-varning ${run}','syntetisk','major','cpu_percent');`);
  await withDesktop(fx.gateway, `dev3.${run}`, async (page) => {
    stub.mode("ok");
    await desktopNav(page, "Ask ONARLY AI");
    await page.getByRole("heading", { name: "Ask ONARLY AI" }).waitFor();
    await page.getByRole("combobox", { name: "Projekt", exact: true }).selectOption(project, { timeout: 20000 });
    await page.getByRole("combobox", { name: "Incident", exact: true }).selectOption(incident);
    let creates = 0, failNextList = false, injectedList = 0;
    await page.route((url) => url.pathname === "/ai/v1/conversations", async (r) => {
      if (r.request().method() === "POST") {
        creates++;
        if (creates === 1) return loseAnswer(r, "Sök felet create");
        failNextList = true;
        return r.continue();
      }
      if (failNextList) { failNextList = false; injectedList++; return r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "BACKEND_UNAVAILABLE" } }) }); }
      return r.continue();
    });
    await page.getByRole("button", { name: "Sök felet för valt mål", exact: true }).click();
    await page.getByRole("alert").first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Sök felet för valt mål", exact: true }).click();
    await page.getByRole("region", { name: "Sök felet" }).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Förhandsgranska underlag", exact: true }).click();
    await page.getByLabel("Exakt underlag till AI").filter({ hasText: "cpu_percent=99" }).waitFor({ timeout: 20000 });
    await page.getByRole("checkbox", { name: /Jag har granskat underlaget/ }).check();
    await page.getByRole("button", { name: "Sök felet – skicka godkänt underlag", exact: true }).click();
    await page.getByRole("region", { name: "Hypoteser", exact: true }).first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${shots}/j7-desktop-sok-felet.png`, fullPage: true });
    const convs = sql(`select c.id, (select count(*)::int from public.ai_messages m where m.conversation_id=c.id and m.role='user') questions, (select count(*)::int from public.ai_messages m where m.conversation_id=c.id and m.role='assistant') answers from public.ai_conversations c where c.created_by='${devId}'`);
    evidence(`INFO J7 Sök felet: creates=${creates} injectedListFailures=${injectedList} conversations=${JSON.stringify(convs.map((c) => [c.questions, c.answers]))}`);
    assert.equal(creates, 2, "the user retried once after the lost answer");
    assert.equal(convs.length, 1, "lost create answer + retry => ONE conversation");
    assert.deepEqual([convs[0].questions, convs[0].answers], [1, 1]);
  });
  ok("J7 Sök felet (M7)", "1 conversation after lost create answer + failed reload; preview + approved analysis answered");
});

// ---------------------------------------------------------------------------------------------- J8
test("J8 audit trail: Super Admin (aal2) reads it in the UI with actor names; technician sees no audit; ticket history in the UI", async () => {
  const { page } = S.sa;
  await page.goto(`${WEB}/control/installningar`);
  const section = page.getByRole("region", { name: "Revisionslogg" });
  await section.waitFor({ timeout: 20000 });
  const text = await section.textContent();
  evidence(`INFO J8 audit UI excerpt: ${text.replace(/\s+/g, " ").slice(0, 600)}`);
  assert.match(text, /Kund registrerad · MP3 Super Admin/);
  assert.ok(text.includes(S.company.id) && text.includes(S.private.id), "both journey registrations are listed");
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page, "j8-audit-superadmin-390");
  const tech = await webLogin("techa");
  await tech.page.waitForURL(`${WEB}/control`);
  await tech.page.goto(`${WEB}/control/installningar`);
  await tech.page.getByRole("heading", { name: "Inställningar" }).waitFor();
  assert.equal(await tech.page.getByRole("region", { name: "Revisionslogg" }).count(), 0, "technician gets no audit log");
  const techRest = await login("techa");
  assert.deepEqual(await json(await rest(techRest.token, "/support_admin_audit?select=id&limit=1")), []);
  await tech.context.close();
  ok("J8 audit trail", "Super Admin sees attributed registrations; technician sees none (UI + REST)");
});

// ---------------------------------------------------------------------------------------------- J9
test("J9 role assignment via /api/control/access: Super Admin (aal2) grants and revokes; access follows at once; technician and aal1 are refused; audited", async () => {
  const saId = await createUser(`sa9.${run}`, "MP3 Behörighetsadmin");
  sqlExec(`update public.profiles set role='admin' where id='${saId}';
    insert into public.support_role_grants(grantee_id,role_key,scope,reason) values ('${saId}','BERRYIT_SUPPORT_SUPER_ADMIN','global','MP3 syntetiskt ägarbeslut (CI-runner)');`);
  const sa = await loginAal2(`sa9.${run}`);
  const techId = await createUser(`techb9.${run}`, "MP3 Tekniker B");
  const access = (token, args) => route(token, null, args, "/api/control/access");
  const grantArgs = { action: "grant", user: techId, role: "BERRYIT_SUPPORT_TECHNICIAN", org: fx.orgs.b, project: null, expires: null, reason: "MP3 tekniker för kund B", external: false, company: null, commissioner: null };
  const subject = `MP3 ärende kund B ${run}`;
  const created = await route(sa.token, "create", { input: { customerId: fx.users.custb, subject, description: "Ärende för kund B (MASTER PASS 3).", category_key: "dator", id: randomUUID() } });
  assert.equal(created.status, 200, JSON.stringify(await json(created)));
  const ticketId = (await json(await route(sa.token, "overview"))).data.tickets.find((t) => t.subject === subject)?.id;
  assert.ok(ticketId);

  // Refusals first: a technician without roles.grant, and the Super Admin on aal1 (MFA required for role delegation).
  const auditBefore = sql("select coalesce(max(id),0)::bigint m from public.support_admin_audit")[0].m;
  const techA = await login("techa");
  const byTech = await access(techA.token, grantArgs);
  const byTechBody = await json(byTech);
  const byAal1 = await access(sa.aal1, grantArgs);
  const byAal1Body = await json(byAal1);
  const grantsAfterRefusals = sql(`select count(*)::int n from public.support_role_grants where grantee_id='${techId}'`)[0].n;
  const denials = sql(`select actor_id, action from public.support_admin_audit where id > ${auditBefore} and action='access.denied' order by id`);
  evidence(`INFO J9 refusals: technician HTTP ${byTech.status} "${byTechBody.error}"; aal1 Super Admin HTTP ${byAal1.status} "${byAal1Body.error}"; grants=${grantsAfterRefusals}; denial audit=${JSON.stringify(denials)}`);
  assert.equal(byTech.status, 400); assert.equal(byAal1.status, 400);
  assert.equal(grantsAfterRefusals, 0);
  assert.ok(denials.some((d) => d.actor_id === fx.users.techa), "the technician's refused attempt is audited");

  // Grant: the new technician sees customer B's ticket with the same JWT, at once.
  const techB = await login(`techb9.${run}`);
  const before = (await json(await route(techB.token, "overview"))).data;
  const granted = await access(sa.token, grantArgs);
  const grantedBody = await json(granted);
  assert.equal(granted.status, 200, JSON.stringify(grantedBody));
  const grantId = grantedBody.data;
  assert.match(String(grantId), /^[0-9a-f-]{36}$/);
  const after = (await json(await route(techB.token, "overview"))).data;
  const detail = await json(await route(techB.token, "detail", { id: ticketId }));
  assert.equal(before.tickets.some((t) => t.id === ticketId), false, "no access before the grant");
  assert.equal(after.tickets.some((t) => t.id === ticketId), true, "access right after the grant (same JWT)");
  assert.equal(detail.data?.canWork, true);
  assert.equal(after.tickets.some((t) => t.organization_id === fx.orgs.a), false, "scope B only: no organisation A tickets");

  // Revoke: gone at once for the same JWT.
  const revoked = await access(sa.token, { action: "revoke", id: grantId, reason: "MP3 uppdraget avslutat" });
  assert.equal(revoked.status, 200, JSON.stringify(await json(revoked)));
  const afterRevoke = (await json(await route(techB.token, "overview"))).data;
  const detailAfter = await route(techB.token, "detail", { id: ticketId });
  assert.equal(afterRevoke.tickets.some((t) => t.id === ticketId), false, "access removed at once");
  assert.equal(detailAfter.status, 400);
  const audit = sql(`select action, actor_id from public.support_admin_audit where target_id='${techId}' and action like 'role.%' order by id`);
  assert.deepEqual(audit, [{ action: "role.granted", actor_id: saId }, { action: "role.revoked", actor_id: saId }]);

  // The UI for it: Projekt -> "Användare och tilldelningar" only for holders of roles.grant (390 px).
  const { page } = S.sa;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB}/control/projekt`);
  await page.getByRole("heading", { name: "Projekt och åtkomst" }).waitFor({ timeout: 20000 });
  await page.getByRole("heading", { name: "Användare och tilldelningar" }).waitFor({ timeout: 20000 });
  await noHorizontalOverflow(page, "j9-projekt-superadmin-390");
  const tech = await webLogin("techa");
  await tech.page.waitForURL(`${WEB}/control`);
  await tech.page.goto(`${WEB}/control/projekt`);
  await tech.page.getByRole("heading", { name: "Projekt och åtkomst" }).waitFor({ timeout: 20000 });
  assert.equal(await tech.page.getByRole("heading", { name: "Användare och tilldelningar" }).count(), 0, "no role administration without roles.grant");
  await tech.context.close();
  ok("J9 role assignment", "grant -> access at once, revoke -> gone at once (same JWT), technician + aal1 refused and audited, role.granted/role.revoked by the Super Admin");
});
