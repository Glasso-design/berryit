#!/usr/bin/env node
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(testsDir, "..", "migrations");
const read = (file) => fs.readFileSync(file, "utf8");
const migrations = fs.readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

const ids = {
  userA: "10000000-0000-4000-8000-000000000001",
  userB: "10000000-0000-4000-8000-000000000002",
  orgA: "20000000-0000-4000-8000-000000000001",
  orgB: "20000000-0000-4000-8000-000000000002",
  projectA: "30000000-0000-4000-8000-000000000001",
  projectB: "30000000-0000-4000-8000-000000000002",
  conversationA: "40000000-0000-4000-8000-000000000001",
  conversationB: "40000000-0000-4000-8000-000000000002",
};

let passed = 0;
let failed = 0;
const ok = (name) => {
  passed++;
  console.log(`  PASS ${name}`);
};
const bad = (name, error = "") => {
  failed++;
  console.log(`  FAIL ${name}${error ? ` — ${String(error).split("\n")[0]}` : ""}`);
};

const db = await PGlite.create({ extensions: { pgcrypto } });
await db.exec(read(path.join(testsDir, "local_bootstrap.sql")));
for (const migration of migrations) {
  await db.exec(read(path.join(migrationsDir, migration)));
}

await db.exec(`
  insert into auth.users (id, email) values
    ('${ids.userA}', 'org-a-tech@example.test'),
    ('${ids.userB}', 'org-b-tech@example.test');

  insert into auth.sessions (id, user_id, aal) values
    ('90000000-0000-4000-8000-000000000001', '${ids.userA}', 'aal1'),
    ('90000000-0000-4000-8000-000000000002', '${ids.userB}', 'aal1');

  insert into public.organizations (id, name) values
    ('${ids.orgA}', 'Kund A'),
    ('${ids.orgB}', 'Kund B');

  insert into public.support_role_grants
    (grantee_id, role_key, scope, organization_id, reason)
  values
    ('${ids.userA}', 'BERRYIT_SUPPORT_TECHNICIAN', 'organization', '${ids.orgA}', 'Testuppdrag A'),
    ('${ids.userB}', 'BERRYIT_SUPPORT_TECHNICIAN', 'organization', '${ids.orgB}', 'Testuppdrag B');

  insert into public.support_projects (id, organization_id, name, created_by) values
    ('${ids.projectA}', '${ids.orgA}', 'Projekt A', '${ids.userA}'),
    ('${ids.projectB}', '${ids.orgB}', 'Projekt B', '${ids.userB}');

  insert into public.ai_conversations
    (id, organization_id, project_id, service_key, created_by, title)
  values
    ('${ids.conversationA}', '${ids.orgA}', '${ids.projectA}', 'natverk', '${ids.userA}', 'Kund A DNS'),
    ('${ids.conversationB}', '${ids.orgB}', '${ids.projectB}', 'natverk', '${ids.userB}', 'Kund B DNS');

  insert into public.ai_knowledge_entries
    (organization_id, project_id, service_key, title, problem, verified_solution, verified_by)
  values
    ('${ids.orgA}', '${ids.projectA}', 'natverk', 'A-lösning', 'A-problem', 'A-svar', '${ids.userA}'),
    ('${ids.orgB}', '${ids.projectB}', 'natverk', 'B-lösning', 'B-problem', 'B-svar', '${ids.userB}');
`);

const claims = (user, session) =>
  JSON.stringify({ sub: user, role: "authenticated", aal: "aal1", session_id: session });

async function asUser(user, session, operation) {
  await db.exec(`select set_config('request.jwt.claims', '${claims(user, session)}', false)`);
  await db.exec("set role authenticated");
  try {
    return await operation();
  } finally {
    await db.exec("reset role");
    await db.exec("select set_config('request.jwt.claims', '', false)");
  }
}

async function expectDenied(name, operation) {
  try {
    await operation();
    bad(name, "operationen tilläts");
  } catch {
    ok(name);
    try {
      await db.exec("rollback");
    } catch {
      // PGlite statements are not wrapped in a shared transaction here.
    }
  }
}

console.log("\nBerryIT ONARLY AI — tenant/RLS verification");

await asUser(ids.userA, "90000000-0000-4000-8000-000000000001", async () => {
  const visible = await db.query("select title from public.ai_conversations order by title");
  if (visible.rows.length === 1 && visible.rows[0].title === "Kund A DNS") {
    ok("scoped tekniker ser endast sin kunds konversation");
  } else {
    bad("scoped tekniker ser endast sin kunds konversation", JSON.stringify(visible.rows));
  }

  const organizations = await db.query("select id, name from public.organizations order by name");
  if (organizations.rows.length === 1 && organizations.rows[0].id === ids.orgA) {
    ok("scoped tekniker kan välja sin tilldelade kund men ingen annan");
  } else {
    bad("scoped tekniker kan välja sin tilldelade kund men ingen annan", JSON.stringify(organizations.rows));
  }

  const knowledge = await db.query("select title from public.ai_knowledge_entries order by title");
  if (knowledge.rows.length === 1 && knowledge.rows[0].title === "A-lösning") {
    ok("kunskapsbasen är isolerad per organisation");
  } else {
    bad("kunskapsbasen är isolerad per organisation", JSON.stringify(knowledge.rows));
  }

  await db.exec(`
    insert into public.ai_messages
      (conversation_id, organization_id, actor_id, role, body)
    values
      ('${ids.conversationA}', '${ids.orgA}', '${ids.userA}', 'user', 'Min verifierade fråga')
  `);
  ok("tekniker kan skriva användarmeddelande i sitt scope");

  await db.exec(`
    insert into public.tickets
      (organization_id, requester_id, subject, description, category_key,
       priority_key, status_key, source, external_channel, external_metadata)
    values
      ('${ids.orgA}', '${ids.userA}', 'AI: DNS-fel',
       'Skapat efter ett uttryckligt användargodkännande i testet.',
       'natverk', 'normal', 'mottaget', 'api', 'onarly-ai',
       '{"created_by_explicit_user_action":true}'::jsonb)
  `);
  ok("scoped tekniker kan skapa AI-ticket i sitt eget scope");

  await expectDenied("scoped tekniker kan inte skapa AI-ticket hos annan kund", () =>
    db.exec(`
      insert into public.tickets
        (organization_id, requester_id, subject, description, category_key,
         priority_key, status_key, source, external_channel)
      values
        ('${ids.orgB}', '${ids.userA}', 'AI: Otillåtet',
         'Detta försök ska stoppas av organisationspolicyn.',
         'natverk', 'normal', 'mottaget', 'api', 'onarly-ai')
    `),
  );

  await expectDenied("klienten kan inte skriva assistant-meddelanden", () =>
    db.exec(`
      insert into public.ai_messages
        (conversation_id, organization_id, role, body, provider, model)
      values
        ('${ids.conversationA}', '${ids.orgA}', 'assistant', 'Förfalskat svar', 'fake', 'fake')
    `),
  );

  await expectDenied("tekniker kan inte läsa annan kunds konversation", () =>
    db.exec(`
      insert into public.ai_messages
        (conversation_id, organization_id, actor_id, role, body)
      values
        ('${ids.conversationB}', '${ids.orgB}', '${ids.userA}', 'user', 'Otillåten fråga')
    `),
  );

  await expectDenied("konversationens organisationskontext är oföränderlig", () =>
    db.exec(`
      update public.ai_conversations
         set organization_id = '${ids.orgB}'
       where id = '${ids.conversationA}'
    `),
  );

  await expectDenied("klienten kan inte skriva AI-revisionsloggen", () =>
    db.exec(`
      insert into public.ai_audit_events (organization_id, actor_id, action)
      values ('${ids.orgA}', '${ids.userA}', 'ai.fake.event')
    `),
  );
});

await asUser(ids.userB, "90000000-0000-4000-8000-000000000002", async () => {
  const visible = await db.query("select title from public.ai_conversations order by title");
  if (visible.rows.length === 1 && visible.rows[0].title === "Kund B DNS") {
    ok("andra teknikern ser endast Kund B");
  } else {
    bad("andra teknikern ser endast Kund B", JSON.stringify(visible.rows));
  }
});

await db.close();
console.log(`\n${passed} kontroller godkända, ${failed} fel`);
process.exitCode = failed ? 1 : 0;
