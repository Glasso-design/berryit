// Upgrade the exact deployed six-migration baseline in a NEW in-memory database.
// Synthetic Auth/Storage catalogues: never claim this tests provider HTTP/JWT.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { DEPLOYED_BASELINE, PENDING_MIGRATIONS, upgradeManifest } from "../upgrade-plan.mjs";
import { assertIsolatedPgliteEnvironment } from "./isolated-environment.mjs";
import { buildCorePilot } from "../../services/connector-engine/pilot.mjs";

assertIsolatedPgliteEnvironment(process.argv.slice(2), process.env);
const sql = name => readFileSync(new URL(name, import.meta.url), "utf8");
const customer = "10000000-0000-0000-0000-000000000001";
const admin = "10000000-0000-0000-0000-000000000003";
const quote = name => { assert.match(name, /^[a-z_][a-z_0-9]*$/); return '"' + name + '"'; };

test("reviewed migration inventory, retained fixture data and existing registry pilot", async t => {
  const manifest = upgradeManifest();
  assert.equal(manifest.filter(m => m.state === "pending").length, 12);
  const db = await PGlite.create({ extensions: { pgcrypto } });
  try {
    await db.exec(sql("local_bootstrap.sql"));
    const apply = async file => {
      await db.exec("begin");
      try { await db.exec(sql("../migrations/" + file)); await db.exec("commit"); }
      catch (error) { await db.exec("rollback"); throw error; }
    };
    for (const [n, file] of DEPLOYED_BASELINE.entries()) {
      await apply(file);
      if (n === 0) await db.exec(sql("local_storage_bootstrap.sql"));
    }
    await db.exec(sql("fixtures/deployed-baseline.sql"));
    await db.exec("insert into auth.sessions(id,user_id,aal) select id,id,'aal1' from auth.users");
    const ticket = (await db.query("select id from public.tickets limit 1")).rows[0].id;
    const path = `tickets/${ticket}/${randomUUID()}-retained.txt`;
    await db.query("insert into public.ticket_messages(ticket_id,author_id,body,is_from_staff) values($1,$2,'Retained public fixture message',false)", [ticket, customer]);
    await db.query("insert into public.ticket_internal_notes(ticket_id,author_id,body) values($1,$2,'Retained private fixture note')", [ticket, admin]);
    await db.query("insert into public.ticket_attachments(ticket_id,uploaded_by,storage_path,file_name,mime_type,size_bytes) values($1,$2,$3,'retained.txt','text/plain',24)", [ticket, customer, path]);
    await db.query("insert into storage.objects(bucket_id,name) values('ticket-attachments',$1)", [path]);

    const tables = ["auth.users", "auth.sessions", "public.organizations", "public.profiles", "public.tickets", "public.ticket_messages", "public.ticket_internal_notes", "public.ticket_attachments", "public.ticket_events", "public.support_role_grants", "public.onarly_support_entitlements", "public.support_admin_audit", "storage.objects"];
    const snapshots = [];
    for (const table of tables) {
      const [schema, name] = table.split(".");
      const columns = (await db.query("select column_name from information_schema.columns where table_schema=$1 and table_name=$2 order by ordinal_position", [schema, name])).rows.map(r => r.column_name);
      const query = `select to_jsonb(row) data from (select ${columns.map(quote).join(",")} from ${quote(schema)}.${quote(name)} order by id) row`;
      snapshots.push({ table, query, rows: (await db.query(query)).rows });
    }
    for (const file of PENDING_MIGRATIONS) {
      await t.test("applies " + file, async () => { await apply(file); });
    }
    for (const saved of snapshots) {
      await t.test("retains original columns and rows: " + saved.table, async () => {
        const after = (await db.query(saved.query)).rows;
        assert.deepEqual(after, saved.rows);
      });
    }

    const as = async (uid, aal, query, params = [], role = "authenticated") => {
      await db.exec("begin");
      try {
        await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role, aal, session_id: uid })]);
        await db.exec("set local role " + quote(role));
        const result = await db.query(query, params); await db.exec("commit"); return result.rows;
      } catch (error) { await db.exec("rollback"); throw error; }
    };
    await t.test("database MFA requires an aal2 claim and a non-expired live session", async () => {
      assert.equal((await as(admin, "aal1", "select public.can_manage_connectors($1) ok", ["20000000-0000-0000-0000-000000000001"]))[0].ok, false);
      await db.query("update auth.sessions set not_after=now()-interval '1 second' where user_id=$1", [admin]);
      assert.equal((await as(admin, "aal2", "select public.can_manage_connectors($1) ok", ["20000000-0000-0000-0000-000000000001"]))[0].ok, false);
      await db.query("update auth.sessions set not_after=null,aal='aal2' where user_id=$1", [admin]);
      assert.equal((await as(admin, "aal2", "select public.can_manage_connectors($1) ok", ["20000000-0000-0000-0000-000000000001"]))[0].ok, true);
    });
    await t.test("auth helper stays self-only and anonymous EXECUTE remains denied", async () => {
      assert.equal((await as(customer, "aal1", "select * from public.active_support_grants($1)", [admin])).length, 0);
      await assert.rejects(as(null, null, "select * from public.active_support_grants($1)", [admin], "anon"), /permission denied/);
    });
    let pilot;
    await t.test("pilot fits the real existing table constraints without a parallel customer model", async () => {
      const organizationId = randomUUID();
      await db.query("insert into public.organizations(id,name,is_internal) values($1,'Synthetic BerryIT internal',true)", [organizationId]);
      pilot = buildCorePilot({ organizationId, actorId: admin, isInternal: true });
      for (const [table, rows] of [["support_projects", pilot.projects], ["infra_nodes", pilot.nodes], ["infra_services", pilot.services], ["connector_integrations", pilot.integrations]]) {
        for (const row of rows) {
          const keys = Object.keys(row);
          await db.query(`insert into public.${quote(table)}(${keys.map(quote)}) values(${keys.map((_,n) => '$' + (n+1))})`, Object.values(row).map(v => typeof v === "object" && v !== null ? JSON.stringify(v) : v));
        }
      }
      assert.equal(Number((await db.query("select count(*) n from public.connector_integrations where is_enabled")).rows[0].n), 0);
    });
    await t.test("customer cannot see the internal pilot and cannot retarget a service across tenants", async () => {
      assert.equal((await as(customer, "aal1", "select id from public.infra_services")).length, 0);
      assert.equal((await as(customer, "aal1", "select id from public.connector_integrations")).length, 0);
      await assert.rejects(db.query("insert into public.infra_services(organization_id,project_id,name) values($1,$2,'Cross tenant attempt')", ["20000000-0000-0000-0000-000000000001", pilot.projects[0].id]), /foreign key/);
    });
    await t.test("migration ledger setup denies anon/authenticated access", async () => {
      const source = sql("../../deploy/berryit-support/migrate.sh");
      const setup = source.match(/psql -q -c "([\s\S]*?)"/);
      assert.ok(setup, "Migration ledger setup must remain reviewable");
      await db.exec(setup[1]);
      for (const role of ["anon", "authenticated"]) {
        await assert.rejects(as(customer, "aal1", "select * from public.schema_migrations", [], role), /permission denied/);
      }
    });
    await t.test("a failed migration transaction retains neither SQL changes nor ledger marker", async () => {
      await db.exec("begin");
      await db.exec("create table public._atomic_fixture(id int); insert into public.schema_migrations(version) values('synthetic_failure.sql')");
      await assert.rejects(db.exec("select * from public._deliberately_missing_fixture"));
      await db.exec("rollback");
      assert.equal((await db.query("select to_regclass('public._atomic_fixture') value")).rows[0].value, null);
      assert.equal((await db.query("select version from public.schema_migrations where version='synthetic_failure.sql'")).rows.length, 0);
    });
    await t.test("all application tables have RLS and privileged helpers lock search_path", async () => {
      assert.equal((await db.query("select tablename from pg_tables where schemaname='public' and not rowsecurity")).rows.length, 0);
      assert.equal((await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','berryit_private') and p.prosecdef and p.proconfig is null")).rows.length, 0);
    });
    console.log("PGlite-only suite completed; see TAP results. Real Auth/JWT/PostgREST/Storage HTTP and native Desktop MFA remain BLOCKED, not tested here.");
  } finally { await db.close(); }
});
