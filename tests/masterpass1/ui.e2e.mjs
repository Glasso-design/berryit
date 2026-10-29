// MASTER PASS 1 — REAL browser tests (Chromium) on the CI runner:
//   web Control Center (next start, cookies, server actions, route handlers)
//   and the Desktop UI build served same-origin with a transparent proxy to
//   the throwaway gateway (native Tauri HTTP is not available on Linux CI).
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "@playwright/test";
import { fx, WEB, sql, stub, totp, evidence } from "./lib.mjs";

const shots = `${process.env.MP1_DIR}/screenshots`;
const run = Date.now().toString(36);
let browser;
test.before(async () => { await mkdir(shots, { recursive: true }); browser = await chromium.launch(); });
test.after(async () => { await browser?.close(); });

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
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
  await page.screenshot({ path: `${shots}/${label}.png`, fullPage: true });
  evidence(`INFO 390px ${label}: scrollWidth=${m.sw} clientWidth=${m.cw}`);
  assert.ok(m.sw <= m.cw + 1, `${label}: horizontal overflow ${m.sw} > ${m.cw}`);
}

test("U1 web login: unauthenticated redirect, wrong password message, 390px login", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${WEB}/control/support`);
  await page.waitForURL(/\/control\/login\?next=%2Fcontrol%2Fsupport/);
  await page.getByLabel("E-post").fill("techa@mp1.example.test");
  await page.getByLabel("Lösenord").fill("helt-fel-lösenord");
  await page.getByRole("button", { name: "Logga in" }).click();
  await page.getByRole("alert").filter({ hasText: "Fel e-post eller lösenord." }).waitFor();
  await noHorizontalOverflow(page, "web-login-390");
  await context.close();
  evidence("PASS U1 web login negative + redirect");
});

test("U2 web technician: dashboard, Support Desk create/work/upload/read attachment, double-click lock", async () => {
  const { context, page } = await webLogin("techa");
  await page.waitForURL(`${WEB}/control`);
  await page.getByRole("heading", { name: "Översikt" }).waitFor();
  await page.goto(`${WEB}/control/support`);
  await page.getByRole("heading", { name: "Support Desk" }).waitFor();
  const form = page.getByRole("form", { name: "Skapa supportärende" });
  await form.waitFor();
  const options = await form.getByLabel("Välj kund").locator("option").allTextContents();
  const match = options.find((o) => o.startsWith("MP1 custa"));
  assert.ok(match, `customer A missing in ${JSON.stringify(options)}`);
  assert.ok(!options.some((o) => o.startsWith("MP1 custb")), "customer B must not be selectable for technician A");
  await form.getByLabel("Välj kund").selectOption({ label: match });
  const subject = `MP1 UI ärende ${run}`;
  await form.getByLabel("Ämne").fill(subject);
  await form.getByLabel("Beskrivning").fill("Skapat via webbens Support Desk i MASTER PASS 1.");
  await form.getByLabel("Kategori").selectOption("dator");
  await form.getByRole("button", { name: "Skapa ärende" }).dblclick();
  await page.getByRole("status").filter({ hasText: "Ärendet är skapat." }).waitFor({ timeout: 20000 });
  const created = sql(`select id, reference from public.tickets where subject='${subject}'`);
  evidence(`INFO UI double-click create -> ${created.length} ticket(s)`);
  assert.equal(created.length, 1, `double-click created ${created.length} tickets`);
  const detail = page.getByRole("article", { name: "Ärendedetaljer" });
  await detail.waitFor();
  assert.equal(await detail.getByLabel("Tilldela tekniker").isDisabled(), true, "technician without tickets.reassign must not get a live assignment control");
  await detail.getByText("Tilldelning kräver behörigheten att flytta ärenden").waitFor();
  await detail.getByRole("button", { name: "Markera som pågående" }).click();
  await page.getByRole("status").filter({ hasText: "Ärendet pågår." }).waitFor();
  await detail.getByLabel("Nytt kundmeddelande").fill("Svar från tekniker via webben (MP1).");
  await detail.getByRole("button", { name: "Skicka kundmeddelande" }).click();
  await page.getByRole("status").filter({ hasText: "Kundmeddelandet är registrerat." }).waitFor();
  await detail.getByLabel("Felsökning och utförd åtgärd").fill("UI-INTERN-MP1 anteckning");
  await detail.getByRole("button", { name: "Spara intern anteckning" }).click();
  await page.getByRole("status").filter({ hasText: "Intern arbetsanteckning sparad." }).waitFor();
  await detail.getByLabel("Välj bilaga (högst 25 MB)").setInputFiles({ name: "skarmdump.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a45f0000000049454e44ae426082", "hex") });
  await detail.getByRole("button", { name: "Ladda upp bilaga" }).click();
  await page.getByRole("status").filter({ hasText: "Bilagan är uppladdad." }).waitFor({ timeout: 20000 });
  const [popup] = await Promise.all([context.waitForEvent("page"), page.getByRole("article", { name: "Ärendedetaljer" }).getByRole("button", { name: "Läs bilaga" }).click()]);
  await popup.waitForURL(/\/storage\/v1\/object\/sign\/ticket-attachments\//, { timeout: 15000 }).catch(() => {});
  evidence(`INFO attachment popup url host=${new URL(popup.url()).host}`);
  const rows = sql(`select t.status_key, (select count(*) from public.ticket_messages m where m.ticket_id=t.id)::int msgs, (select count(*) from public.ticket_internal_notes n where n.ticket_id=t.id)::int notes, (select count(*) from public.ticket_attachments a where a.ticket_id=t.id and a.upload_completed_at is not null)::int files from public.tickets t where t.id='${created[0].id}'`)[0];
  assert.deepEqual(rows, { status_key: "pagar", msgs: 1, notes: 1, files: 1 });
  globalThis.uiTicket = created[0];
  // 390 px: dashboard + support
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB}/control`); await page.getByRole("heading", { name: "Översikt" }).waitFor();
  await noHorizontalOverflow(page, "web-dashboard-tech-390");
  await page.goto(`${WEB}/control/support`); await page.getByRole("heading", { name: "Support Desk" }).waitFor();
  await page.getByRole("table").waitFor();
  await noHorizontalOverflow(page, "web-support-tech-390");
  await context.close();
  evidence(`PASS U2 web technician flow ${created[0].reference}`);
});

test("U3 web customers: A sees reply but no internal note; B does not see A's ticket", async () => {
  const a = await webLogin("custa", { viewport: { width: 390, height: 844 } });
  await a.page.waitForURL(`${WEB}/control`);
  await a.page.goto(`${WEB}/control/support?arende=${globalThis.uiTicket.reference}`);
  const detail = a.page.getByRole("article", { name: "Ärendedetaljer" });
  await detail.waitFor({ timeout: 20000 });
  await detail.getByText("Svar från tekniker via webben (MP1).").waitFor();
  assert.equal(await a.page.getByText("UI-INTERN-MP1 anteckning").count(), 0);
  assert.equal(await detail.getByRole("button", { name: "Markera som pågående" }).count(), 0);
  await detail.getByLabel("Nytt kundmeddelande").fill("Kundens svar via webben (MP1).");
  await detail.getByRole("button", { name: "Skicka kundmeddelande" }).click();
  await a.page.getByRole("status").filter({ hasText: "Kundmeddelandet är registrerat." }).waitFor();
  await noHorizontalOverflow(a.page, "web-support-customer-390");
  await a.context.close();
  const b = await webLogin("custb");
  await b.page.waitForURL(`${WEB}/control`);
  await b.page.goto(`${WEB}/control/support?arende=${globalThis.uiTicket.reference}`);
  await b.page.getByRole("heading", { name: "Support Desk" }).waitFor();
  await b.page.getByRole("table").waitFor();
  assert.equal(await b.page.getByText(globalThis.uiTicket.reference).count(), 0);
  assert.equal(await b.page.getByRole("article", { name: "Ärendedetaljer" }).count(), 0);
  await b.context.close();
  evidence("PASS U3 customer isolation in UI");
});

test("U4 web Super Admin: forced MFA enrolment, then customer registration UI + audit", async () => {
  const { context, page } = await webLogin("saweb");
  await page.waitForURL(/\/control\/mfa/);
  const secret = (await page.locator("code").first().textContent()).trim();
  await page.getByLabel("Engångskod").fill("000000");
  await page.getByRole("button", { name: "Aktivera tvåfaktor" }).click();
  await page.getByRole("alert").filter({ hasText: "Koden stämmer inte" }).waitFor();
  await page.getByLabel("Engångskod").fill(totp(secret));
  await page.getByRole("button", { name: /Aktivera tvåfaktor|Verifiera/ }).click();
  await page.waitForURL(`${WEB}/control`, { timeout: 20000 });
  await page.getByText("Inloggad som Super Admin").waitFor();
  await page.goto(`${WEB}/control/kunder`);
  const form = page.getByRole("form", { name: "Registrera kund" });
  await form.waitFor({ timeout: 20000 });
  const mail = `ui.kund.${run}@mp1.example.test`;
  await form.getByLabel("Kundens namn").fill("MP1 UI Registrerad");
  await form.getByLabel("Kundens e-post").fill(mail);
  await form.getByLabel("Kundens organisation").selectOption({ label: "MP1 Kund A AB" });
  await form.getByRole("button", { name: "Registrera kund utan aktiverad inloggning" }).click();
  const outcome = page.getByText(/Kund registrerad\.|Kunden kunde inte registreras|Kundregistrering kräver|Serverbaserad kundregistrering/);
  await outcome.first().waitFor({ timeout: 20000 });
  const message = await outcome.first().textContent();
  evidence(`INFO UI registration message: ${message}`);
  const profile = sql(`select p.organization_id, p.login_activation_pending from public.profiles p join auth.users u on u.id=p.id where u.email='${mail}'`);
  evidence(`INFO UI registration profile: ${JSON.stringify(profile)}`);
  assert.match(message, /Kund registrerad/);
  assert.deepEqual(profile, [{ organization_id: fx.orgs.a, login_activation_pending: true }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await noHorizontalOverflow(page, "web-kunder-superadmin-390");
  await context.close();
  evidence("PASS U4 MFA + registration UI");
});

// ------------------------------------------------------------------ Desktop UI
function desktopServer(root, target) {
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (/^\/(auth|rest|storage|ai)\/v1\//.test(url.pathname)) {
      const upstream = httpRequest(target + req.url, { method: req.method, headers: { ...req.headers, host: new URL(target).host } }, (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); });
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

test("U5 desktop Ask ONARLY AI: answer rendered; provider down then retry reuses ONE conversation", async () => {
  const server = desktopServer(resolve("desktop/dist"), fx.gateway);
  await new Promise((r) => server.listen(3602, "127.0.0.1", r));
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto("http://127.0.0.1:3602/");
    await page.getByRole("heading", { name: "Logga in" }).waitFor();
    await page.getByRole("status").filter({ hasText: "Ansluten till BERRYiT." }).waitFor({ timeout: 15000 });
    await page.getByLabel("E-post").fill("techa@mp1.example.test");
    await page.getByLabel("Lösenord").fill(fx.password);
    await page.getByRole("button", { name: "Logga in", exact: true }).click();
    await page.getByRole("button", { name: /Ask ONARLY AI/ }).first().click({ timeout: 20000 });
    await page.getByRole("heading", { name: "Ask ONARLY AI" }).waitFor();
    await page.getByText("Gateway serverkonfigurerad").waitFor({ timeout: 15000 });
    const ask = async (question) => {
      await page.getByPlaceholder("Fråga om ett fel, kod, drift eller ett supportärende…").fill(question);
      await page.getByLabel(/Jag har granskat texten/).check();
      await page.getByRole("button", { name: "Fråga ONARLY AI" }).click();
    };
    stub.mode("ok");
    await ask(`MP1 desktop fråga ${run}`);
    await page.getByRole("heading", { name: "Verifierade fakta" }).or(page.getByRole("heading", { name: "Hypoteser" })).first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: `${shots}/desktop-ai-answer.png`, fullPage: true });
    // provider down on a NEW chat's first question, then retry after recovery
    await page.getByRole("button", { name: "Ny chatt" }).click();
    const title = `MP1 retry ${run}`;
    stub.stop();
    await ask(title);
    await page.getByRole("alert").filter({ hasText: "ONARLY AI Gateway kan inte nås just nu." }).waitFor({ timeout: 20000 });
    stub.start(); await new Promise((r) => setTimeout(r, 1500));
    await page.getByPlaceholder("Fråga om ett fel, kod, drift eller ett supportärende…").inputValue().then((v) => evidence(`INFO question kept after failure: ${JSON.stringify(v)}`));
    if (!(await page.getByPlaceholder("Fråga om ett fel, kod, drift eller ett supportärende…").inputValue())) await page.getByPlaceholder("Fråga om ett fel, kod, drift eller ett supportärende…").fill(title);
    if (!(await page.getByLabel(/Jag har granskat texten/).isChecked())) await page.getByLabel(/Jag har granskat texten/).check();
    await page.getByRole("button", { name: "Fråga ONARLY AI" }).click();
    await page.getByRole("heading", { name: "Hypoteser" }).first().waitFor({ timeout: 30000 });
    const convs = sql(`select c.id, (select count(*) from public.ai_messages m where m.conversation_id=c.id and m.role='user')::int questions, (select count(*) from public.ai_messages m where m.conversation_id=c.id and m.role='assistant')::int answers from public.ai_conversations c where c.title='${title}'`);
    evidence(`INFO desktop retry conversations: ${JSON.stringify(convs)}`);
    await page.screenshot({ path: `${shots}/desktop-ai-retry.png`, fullPage: true });
    assert.equal(convs.length, 1, `retry after provider failure created ${convs.length} conversations`);
    evidence("PASS U5 desktop AI flow");
  } finally {
    await context.close();
    await new Promise((r) => server.close(r));
  }
});
