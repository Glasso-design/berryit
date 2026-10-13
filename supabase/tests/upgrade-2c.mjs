#!/usr/bin/env node
/*
 * Uppgraderingstest för PASS 2C.
 *
 *   npm run db:upgrade-test
 *
 * db:test kör alla migrationer från en tom databas. Det säger inget om hur det
 * går på en databas som redan är i drift, med data i tabellerna. Det här testet
 * gör just den resan:
 *
 *   1. Migrationerna till och med PASS 2B appliceras.
 *   2. Representativ data skapas – organisation, kund, tekniker, superadmin
 *      med global tilldelning, ärende och en ONARLY-rättighet.
 *   3. MFA-migrationen appliceras ovanpå.
 *   4. Resultatet kontrolleras: ingen rad går förlorad, de nya kolumnerna får
 *      rätt förval, kravet slår igenom och den körs om utan att något ändras.
 *
 * Körs mot PGlite (PostgreSQL kompilerad till WASM), samma motor som db:test.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(testsDir, "..", "migrations");
const read = (p) => fs.readFileSync(p, "utf8");
const alla = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
const MFA_MIGRATION = "20261013110000_support_mfa_enforcement.sql";
const fore = alla.filter((f) => f !== MFA_MIGRATION);

let pass = 0;
let fail = 0;
const ok = (m) => {
  console.log(`  ok   ${m}`);
  pass++;
};
const bad = (m, e = "") => {
  console.log(`  FAIL ${m}${e ? `\n       ${String(e).split("\n")[0]}` : ""}`);
  fail++;
};

const db = await PGlite.create({ extensions: { pgcrypto } });
await db.exec(read(path.join(testsDir, "local_bootstrap.sql")));

console.log("\n1. Befintlig databas (till och med PASS 2B)");
for (const f of fore) {
  try {
    await db.exec(read(path.join(migrationsDir, f)));
  } catch (e) {
    bad(`migration ${f}`, e.message);
    process.exit(1);
  }
}
ok(`${fore.length} migrationer applicerade`);

// --- Data som i drift -------------------------------------------------------
await db.exec(`
  insert into auth.users (id, email) values
    ('10000000-0000-0000-0000-000000000001', 'kund@example.com'),
    ('10000000-0000-0000-0000-000000000002', 'tekniker@example.test'),
    ('10000000-0000-0000-0000-000000000003', 'superadmin@example.test');
  insert into public.organizations (id, name) values
    ('20000000-0000-0000-0000-000000000001', 'Exempelbolaget AB');
  update public.profiles set organization_id = '20000000-0000-0000-0000-000000000001'
    where id = '10000000-0000-0000-0000-000000000001';
  update public.profiles set role = 'technician' where id = '10000000-0000-0000-0000-000000000002';
  insert into public.support_role_grants (grantee_id, role_key, scope, reason)
    values ('10000000-0000-0000-0000-000000000003', 'BERRYIT_SUPPORT_SUPER_ADMIN', 'global', 'Agarbeslut');
  insert into public.tickets (organization_id, requester_id, subject, description, category_key)
    values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
            'Skrivaren svarar inte', 'Skrivaren hittar inte natverket langre.', 'skrivare');
  insert into public.onarly_support_entitlements (organization_id, product_key, entitlement, reason)
    values ('20000000-0000-0000-0000-000000000001', 'onarly_desk', 'remote_support', 'Kundavtal');
`);
const before = await db.query(`
  select
    (select count(*) from public.profiles) as profiler,
    (select count(*) from public.tickets) as arenden,
    (select count(*) from public.support_role_grants) as tilldelningar,
    (select count(*) from public.support_permissions) as behorigheter,
    (select count(*) from public.onarly_support_entitlements) as rattigheter
`);
ok(`data på plats: ${JSON.stringify(before.rows[0])}`);

// --- Uppgraderingen ---------------------------------------------------------
console.log("\n2. MFA-migrationen appliceras på den befintliga databasen");
const t0 = Date.now();
try {
  await db.exec(read(path.join(migrationsDir, MFA_MIGRATION)));
  ok(`migrationen gick igenom på ${Date.now() - t0} ms`);
} catch (e) {
  bad("migrationen misslyckades", e.message);
  process.exit(1);
}

const after = await db.query(`
  select
    (select count(*) from public.profiles) as profiler,
    (select count(*) from public.tickets) as arenden,
    (select count(*) from public.support_role_grants) as tilldelningar,
    (select count(*) from public.support_permissions) as behorigheter,
    (select count(*) from public.onarly_support_entitlements) as rattigheter
`);
if (JSON.stringify(before.rows[0]) === JSON.stringify(after.rows[0])) {
  ok("ingen rad tillkom eller försvann");
} else {
  bad(`radantalet ändrades: ${JSON.stringify(before.rows[0])} -> ${JSON.stringify(after.rows[0])}`);
}

const kolumner = await db.query(`
  select
    (select count(*) from public.profiles where is_machine) as maskiner,
    (select count(*) from public.support_permissions where requires_mfa) as kraver_mfa,
    (select count(*) from public.support_permissions where not requires_mfa) as fria
`);
const k = kolumner.rows[0];
if (Number(k.maskiner) === 0) ok("inga befintliga konton markerades som maskinidentiteter");
else bad(`${k.maskiner} konton fick is_machine`);
if (Number(k.kraver_mfa) === 6) ok(`sex behörigheter kräver nu MFA, ${k.fria} gör det inte`);
else bad(`fel antal MFA-behörigheter: ${k.kraver_mfa}`);

const fria = await db.query(`select key from public.support_permissions where not requires_mfa order by key`);
const friaNycklar = fria.rows.map((r) => r.key).join(", ");
if (friaNycklar === "tickets.read, tickets.reassign, tickets.write".split(", ").sort().join(", ")) {
  ok(`ärendearbetet är undantaget (${friaNycklar})`);
} else {
  bad(`oväntade fria behörigheter: ${friaNycklar}`);
}

// --- Beteendet efter uppgraderingen ----------------------------------------
const superadminId = "10000000-0000-0000-0000-000000000003";
const tekniker = "10000000-0000-0000-0000-000000000002";
const kund = "10000000-0000-0000-0000-000000000001";
console.log("\n3. Beteendet efter uppgraderingen");
// PGlite kör en enda anslutning utan omslutande transaktion här, så
// inställningarna måste vara sessionsbreda (`set role`, set_config med
// is_local = false). Med `set local` hade de gällt en enda sats, och varje
// kontroll hade i praktiken körts som anonym – vilket ser ut som ett godkänt
// nekande men inte bevisar något.
// En inloggning är en rad i GoTrues auth.sessions plus en JWT som pekar på den.
// Sessionen måste finnas, annars nekas allt privilegierat – det är hela poängen
// med sessionskontrollen.
const sessioner = new Map();
const sessionFor = async (uid) => {
  if (!sessioner.has(uid)) {
    const r = await db.query(
      `insert into auth.sessions (id, user_id, aal) values (gen_random_uuid(), '${uid}', 'aal2') returning id`,
    );
    sessioner.set(uid, r.rows[0].id);
  }
  return sessioner.get(uid);
};

const somAnvandare = async (uid, aal, sql) => {
  const claims = JSON.stringify({ sub: uid, role: "authenticated", aal, session_id: await sessionFor(uid) });
  await db.exec(`select set_config('request.jwt.claims', '${claims}', false)`);
  await db.exec("set role authenticated");
  const r = await db.query(sql);
  await db.exec("reset role");
  await db.exec(`select set_config('request.jwt.claims', '', false)`);
  return r.rows[0];
};

// Kontroll av riggen: utan claims ska ingen vara superadmin, och med claims ska
// uppslaget faktiskt se användaren. Annars mäter testet ingenting.
{
  const anonym = await db.query("select public.is_support_super_admin() as v");
  if (anonym.rows[0].v !== false) bad("riggen: anonym räknas som superadmin");
  const sedd = await somAnvandare(superadminId, "aal2", "select auth.uid() = $$10000000-0000-0000-0000-000000000003$$::uuid as v");
  if (sedd.v === true) ok("testriggen ser rätt inloggad användare");
  else bad("testriggen sätter inte JWT-claims");
}

let r = await somAnvandare(superadminId, "aal1", "select public.is_support_super_admin() as v");
if (r.v === false) ok("superadmin med aal1 tappar sina privilegier");
else bad("superadmin med aal1 behöll privilegier");

r = await somAnvandare(superadminId, "aal2", "select public.is_support_super_admin() as v");
if (r.v === true) ok("superadmin med aal2 har kvar sina privilegier");
else bad("superadmin med aal2 tappade privilegier");

r = await somAnvandare(superadminId, "aal1", "select count(*)::int as n from public.tickets");
if (r.n === 1) ok("superadmin med aal1 kan fortfarande arbeta med ärenden");
else bad(`superadmin med aal1 ser ${r.n} ärenden`);

r = await somAnvandare(tekniker, "aal1", "select count(*)::int as n from public.tickets");
if (r.n === 1) ok("tekniker arbetar vidare utan MFA");
else bad(`tekniker ser ${r.n} ärenden`);

r = await somAnvandare(kund, "aal1", "select count(*)::int as n from public.tickets");
if (r.n === 1) ok("kunden ser sitt eget ärende utan MFA");
else bad(`kunden ser ${r.n} ärenden`);

// --- Kan den köras om? ------------------------------------------------------
console.log("\n4. Migrationen körs om");
try {
  await db.exec(read(path.join(migrationsDir, MFA_MIGRATION)));
  ok("migrationen är idempotent – andra körningen ändrar ingenting");
} catch (e) {
  bad("migrationen går inte att köra om", e.message);
}
const omkord = await db.query(`
  select (select count(*) from public.support_permissions where requires_mfa) as kraver_mfa,
         (select count(*) from public.profiles where is_machine) as maskiner
`);
if (Number(omkord.rows[0].kraver_mfa) === 6 && Number(omkord.rows[0].maskiner) === 0) {
  ok("tillståndet är oförändrat efter omkörningen");
} else {
  bad("omkörningen ändrade tillståndet");
}


// --- Återställning ----------------------------------------------------------
console.log("\n5. Återställningen (supabase/rollback/)");
const rollbackFil = path.join(testsDir, "..", "rollback", "20261013110000_support_mfa_enforcement_rollback.sql");
const foreRollback = await db.query(`
  select
    (select count(*) from public.profiles) as profiler,
    (select count(*) from public.tickets) as arenden,
    (select count(*) from public.support_role_grants) as tilldelningar,
    (select count(*) from public.onarly_support_entitlements) as rattigheter
`);
try {
  await db.exec(read(rollbackFil));
  ok("återställningen går igenom");
} catch (e) {
  bad("återställningen misslyckades", e.message);
}

const efterRollback = await db.query(`
  select
    (select count(*) from public.profiles) as profiler,
    (select count(*) from public.tickets) as arenden,
    (select count(*) from public.support_role_grants) as tilldelningar,
    (select count(*) from public.onarly_support_entitlements) as rattigheter
`);
if (JSON.stringify(foreRollback.rows[0]) === JSON.stringify(efterRollback.rows[0])) {
  ok("ingen kunddata förändrades av återställningen");
} else {
  bad(`radantalet ändrades vid återställning: ${JSON.stringify(efterRollback.rows[0])}`);
}

r = await somAnvandare(superadminId, "aal1", "select public.is_support_super_admin() as v");
if (r.v === true) ok("PASS 2B-beteendet är tillbaka: aal1 ger administratörsrättigheter igen");
else bad("återställningen gav inte tillbaka tidigare beteende");

r = await somAnvandare(tekniker, "aal1", "select count(*)::int as n from public.tickets");
if (r.n === 1) ok("teknikern arbetar vidare även efter återställningen");
else bad(`teknikern ser ${r.n} ärenden efter återställning`);

const kolumnerKvar = await db.query(`
  select
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_machine') as is_machine,
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'support_permissions' and column_name = 'requires_mfa') as requires_mfa
`);
if (Number(kolumnerKvar.rows[0].is_machine) === 1 && Number(kolumnerKvar.rows[0].requires_mfa) === 1) {
  ok("kolumnerna finns kvar – ingen information gick förlorad");
} else {
  bad("kolumner försvann vid återställning");
}

console.log("\n6. Framåt igen efter återställning");
try {
  await db.exec(read(path.join(migrationsDir, MFA_MIGRATION)));
  ok("migrationen kan appliceras igen");
} catch (e) {
  bad("kunde inte applicera framåt igen", e.message);
}
r = await somAnvandare(superadminId, "aal1", "select public.is_support_super_admin() as v");
if (r.v === false) ok("kravet gäller igen direkt – ingen omkonfiguration behövdes");
else bad("kravet slog inte till efter ny applicering");

console.log(`\n${pass} kontroller godkända, ${fail} fel`);
await db.close();
process.exit(fail ? 1 : 0);
