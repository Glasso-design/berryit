#!/usr/bin/env node
/*
 * Lokal verifiering av BERRYiT Support Desk-databasen.
 *
 *   npm run db:test
 *
 * Kör mot PGlite (riktig PostgreSQL kompilerad till WASM) så att migrationer och
 * RLS kan testas utan Docker, psql eller Supabase-projekt.
 *
 * Två faser:
 *   1. Migrationer från TOM databas, i filordning – fångar ordnings- och beroendefel.
 *   2. Säkerhetstesterna i support_desk_rls_test.sql.
 *
 * Skillnader mot riktig Supabase dokumenteras i supabase/README.md. Testerna i
 * support_desk_rls_test.sql kan köras oförändrade mot Supabase med psql.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(testsDir, "..", "migrations");
const read = (p) => fs.readFileSync(p, "utf8");
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

async function freshDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(read(path.join(testsDir, "local_bootstrap.sql")));
  return db;
}

let failures = 0;
const step = async (db, label, sql) => {
  try {
    await db.exec(sql);
    console.log(`  ok   ${label}`);
    return true;
  } catch (e) {
    failures++;
    console.log(`  FAIL ${label}\n       ${String(e.message).split("\n")[0]}`);
    return false;
  }
};

// --- Fas 1: migrationer från tom databas ------------------------------------
console.log("\nFas 1 – migrationer från tom databas");
const migrateDb = await freshDatabase();
for (const file of migrationFiles) {
  if (!(await step(migrateDb, file, read(path.join(migrationsDir, file))))) break;
}
if (!failures) {
  const summary = await migrateDb.query(`
    select
      (select count(*)::int from pg_tables where schemaname = 'public') as tables,
      (select count(*)::int from pg_tables where schemaname = 'public' and rowsecurity) as tables_with_rls,
      (select count(*)::int from pg_policies where schemaname = 'public') as policies,
      (select count(*)::int from pg_indexes where schemaname = 'public') as indexes,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and p.proconfig is null) as secdef_without_search_path
  `);
  const s = summary.rows[0];
  console.log(`       ${s.tables} tabeller, ${s.policies} policies, ${s.indexes} index`);

  const unprotected = await migrateDb.query(
    "select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by 1",
  );
  if (unprotected.rows.length) {
    failures++;
    console.log(`  FAIL tabeller utan RLS: ${unprotected.rows.map((r) => r.tablename).join(", ")}`);
  } else {
    console.log(`  ok   samtliga ${s.tables_with_rls} tabeller har RLS aktiverat`);
  }

  if (s.secdef_without_search_path > 0) {
    failures++;
    console.log(`  FAIL ${s.secdef_without_search_path} security definer-funktioner saknar låst search_path`);
  } else {
    console.log("  ok   alla security definer-funktioner har låst search_path");
  }
}
await migrateDb.close();

// --- Fas 2: säkerhetstester --------------------------------------------------
console.log("\nFas 2 – säkerhetstester");
const testDb = await freshDatabase();
for (const file of migrationFiles) await testDb.exec(read(path.join(migrationsDir, file)));

// Spegla varje godkänd kontroll i en tabell så att de kan redovisas. Filen i
// repot är oförändrad; ersättningarna gäller bara denna körning (psql visar
// samma kontroller som NOTICE).
let testSql = read(path.join(testsDir, "support_desk_rls_test.sql"));
testSql = testSql.replace(
  "begin;",
  "begin;\ncreate table public._test_results(ord serial primary key, name text);\n" +
    "grant all on public._test_results to public;\n" +
    "grant usage, select on sequence public._test_results_ord_seq to public;",
);
testSql = testSql.replace("raise notice 'ok: %', what;", "insert into public._test_results(name) values (what);");
testSql = testSql.replace(/rollback;\s*$/, "commit;");

let aborted = false;
try {
  await testDb.exec(testSql);
} catch (e) {
  aborted = true;
  failures++;
  console.log(`  FAIL ${String(e.message).split("\n")[0]}`);
  try {
    await testDb.exec("rollback;");
  } catch {
    /* transaktionen är redan avbruten */
  }
}

let passed = 0;
try {
  const res = await testDb.query("select ord, name from public._test_results order by ord");
  passed = res.rows.length;
  for (const r of res.rows) console.log(`  PASS ${String(r.ord).padStart(2, " ")}. ${r.name}`);
} catch {
  /* testtransaktionen rullades tillbaka – felet ovan gäller */
}
await testDb.close();

console.log(`\n${passed} säkerhetskontroller godkända, ${failures} fel${aborted ? " (körningen avbröts)" : ""}`);
process.exit(failures ? 1 : 0);
