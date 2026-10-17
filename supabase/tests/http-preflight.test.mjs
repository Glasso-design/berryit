import test from "node:test";
import assert from "node:assert/strict";
import { httpPreflight } from "./http-preflight.mjs";
const args = ["--environment=isolated-local-supabase"];
test("HTTP gate refuses missing/unknown/prod targets before any process call", () => {
  for (const [flags, environment] of [[[], {}], [args, { NODE_ENV: "production" }], [args, { SUPABASE_SERVICE_ROLE_KEY: "synthetic-only" }], [args, { DATABASE_URL: "postgres://production.invalid" }], [args, { DOCKER_HOST: "ssh://core-node-01" }]]) {
    let called = false;
    assert.throws(() => httpPreflight({ args: flags, environment, execute: () => { called = true; } }));
    assert.equal(called, false);
  }
});
test("missing Docker is BLOCKED, never a skipped/PASS HTTP suite", () => {
  const result = httpPreflight({ args, environment: {}, execute: () => ({ error: Object.assign(new Error(), { code: "ENOENT" }) }) });
  assert.equal(result.status, "BLOCKED");
});
test("remote contexts are refused before contacting the daemon", () => {
  for (const host of ["ssh://core-node-01", "tcp://127.0.0.1:2375", "ssh://prod-node-01"]) {
    const calls = [];
    assert.throws(() => httpPreflight({ args, environment: {}, execute: cmd => { calls.push(cmd); return { status: 0, stdout: JSON.stringify([{ Endpoints: { docker: { Host: host } } }]) }; } }), /Remote/);
    assert.deepEqual(calls, [["context", "inspect"]]);
  }
});
test("a local runtime check is explicitly not a real HTTP test PASS", () => {
  const result = httpPreflight({ args, environment: {}, execute: cmd => ({ status: 0, stdout: cmd[0] === "context" ? JSON.stringify([{ Endpoints: { docker: { Host: "npipe:////./pipe/dockerDesktopLinuxEngine" } } }]) : JSON.stringify({ Os: "linux" }) }) });
  assert.equal(result.status, "PREREQUISITES_ONLY");
});
