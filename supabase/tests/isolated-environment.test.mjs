import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assertIsolatedPgliteEnvironment } from "./isolated-environment.mjs";

const isolated = ["--environment=isolated-pglite"];

test("explicit isolerad PGlite-miljö tillåts", () => {
  assert.doesNotThrow(() => assertIsolatedPgliteEnvironment(isolated, {}));
});

test("okänd och produktionsklassad miljö stoppas", () => {
  for (const args of [[], ["--environment=unknown"], ["--environment=production"]]) {
    assert.throws(() => assertIsolatedPgliteEnvironment(args, {}));
  }
});

test("extern databas och Supabase-adress stoppas", () => {
  for (const name of ["DATABASE_URL", "SUPABASE_DB_URL", "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "PGHOST"]) {
    assert.throws(() => assertIsolatedPgliteEnvironment(isolated, { [name]: "production.example" }));
  }
});

test("oavsiktlig rensning eller extra argument stoppas", () => {
  assert.throws(() => assertIsolatedPgliteEnvironment([...isolated, "--cleanup"], {}));
  assert.throws(() => assertIsolatedPgliteEnvironment(["--cleanup"], {}));
});

test("den verkliga testköraren avbryter före databasstart", () => {
  const runner = fileURLToPath(new URL("./run-local.mjs", import.meta.url));
  for (const [args, env] of [
    [["--environment=production"], {}],
    [[...isolated, "--cleanup"], {}],
    [isolated, { DATABASE_URL: "postgres://production.example/database" }],
  ]) {
    const result = spawnSync(process.execPath, [runner, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Kräver exakt|Extern databaskonfiguration/);
    assert.doesNotMatch(result.stdout, /Fas 1/);
  }
});
