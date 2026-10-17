import test from "node:test";
import assert from "node:assert/strict";
import { buildCorePilot, CORE_EXPECTED_STOPPED } from "./pilot.mjs";
import { dockerAdapter } from "./adapters.mjs";
import { containerMetrics } from "./agent-contract.mjs";
import { ingestAgentReport } from "./engine.mjs";
import { evaluateTarget } from "./monitoring.mjs";

const organizationId = "10000000-0000-4000-8000-000000000001";
const actorId = "10000000-0000-4000-8000-000000000002";
const check = (containers, config = {}) => dockerAdapter.check({ config: { socket_path: "/test/socket-never-opened", ...config }, dockerList: async () => containers });
const running = { name: "live", state: "running", health: "healthy" };
const stopped = name => ({ name, state: "exited", health: "unhealthy" });

test("pilot reuses tenant registry, supplies required actor, creates no organization or secrets", () => {
  const pilot = buildCorePilot({ organizationId, actorId, isInternal: true });
  assert.equal(pilot.organizations, undefined);
  assert.equal(pilot.nodes.length, 1); assert.equal(pilot.projects.length, 2);
  assert.equal(pilot.services.length, 8); assert.equal(pilot.integrations.length, 9);
  assert.ok(pilot.projects.every(p => p.created_by === actorId));
  assert.ok(pilot.integrations.every(i => !i.is_enabled && i.access_mode === "read_only" && i.secret_ref === null));
  assert.ok(pilot.services.every(s => s.organization_id === organizationId && s.node_id === pilot.nodes[0].id));
  assert.equal(new Set(CORE_EXPECTED_STOPPED).size, 26);
  assert.throws(() => buildCorePilot({ organizationId, actorId, isInternal: false }));
  assert.throws(() => buildCorePilot({ organizationId: "unknown", actorId, isInternal: true }));
  assert.throws(() => buildCorePilot({ organizationId, isInternal: true }));
});

test("26 approved stops neither degrade a healthy scoped observation nor count as live unhealthy", async () => {
  const containers = [running, ...CORE_EXPECTED_STOPPED.map(stopped)];
  const result = await check(containers, { expected_stopped_containers: [...CORE_EXPECTED_STOPPED] });
  assert.equal(result.status, "ok");
  assert.equal(result.detail.planerat_stoppade.length, 26);
  assert.deepEqual(result.detail.ovantat_stoppade, []);
  assert.deepEqual(containerMetrics(containers), { containers_running: 1, containers_unhealthy: 0 });
  const now = Date.now();
  const samples = [0, 1, 2].map(n => ({ metric_key: "containers_unhealthy", value: 0, collected_at: new Date(now - n * 1000).toISOString() }));
  const decisions = evaluateTarget({ target: { name: "core-node", node_id: "node" }, samples, thresholds: [{ metric_key: "containers_unhealthy", warning_value: 0, critical_value: 1, consecutive_breaches: 3 }], reachable: true, now });
  assert.equal(decisions.filter(d => d.action === "open").length, 0);
});

test("planned-only scope is unknown, not a false healthy running system", async () => {
  assert.equal((await check([stopped("paused")], { expected_stopped_containers: ["paused"] })).status, "unknown");
});

test("an unlisted stopped service still degrades status", async () => {
  const result = await check([running, stopped("paused"), stopped("unexpected")], { expected_stopped_containers: ["paused"] });
  assert.equal(result.status, "degraded"); assert.deepEqual(result.detail.ovantat_stoppade, ["unexpected"]);
});

test("restarting/dead planned containers, unexpected starts and missing targets remain visible", async () => {
  for (const state of ["dead", "restarting", "paused"]) {
    const result = await check([running, { ...stopped("planned"), state }], { expected_stopped_containers: ["planned"] });
    assert.equal(result.status, "degraded"); assert.deepEqual(result.detail.ovantat_stoppade, ["planned"]);
  }
  const started = await check([running], { expected_stopped_containers: ["live"] });
  assert.equal(started.status, "degraded"); assert.deepEqual(started.detail.ovantat_startade, ["live"]);
  const missing = await check([running], { container_names: ["live", "missing"] });
  assert.equal(missing.status, "degraded"); assert.deepEqual(missing.detail.saknade, ["missing"]);
});

test("exact-name scope never matches a lookalike and wildcard/invalid policies fail closed", async () => {
  const result = await check([running, stopped("live-backup")], { container_names: ["live"] });
  assert.equal(result.detail.totalt, 1);
  for (const policy of ["*", ["*"], ["x", "x"], [""], [null]]) {
    await assert.rejects(check([running], { expected_stopped_containers: policy }), e => e.code === "BAD_CONFIG");
  }
  await assert.rejects(check([running], { container_names: [] }), e => e.code === "BAD_CONFIG");
  await assert.rejects(check([running], { container_names: ["live"], expected_stopped_containers: ["foreign"] }), e => e.code === "BAD_CONFIG");
});

test("a genuinely unhealthy running container still opens a metric incident", async () => {
  const containers = [{ ...running, health: "unhealthy" }, stopped("paused")];
  assert.equal((await check(containers, { expected_stopped_containers: ["paused"] })).status, "degraded");
  assert.equal(containerMetrics(containers).containers_unhealthy, 1);
  const now = Date.now();
  const samples = [0, 1, 2].map(n => ({ metric_key: "containers_unhealthy", value: 1, collected_at: new Date(now - n * 1000).toISOString() }));
  const result = evaluateTarget({ target: { name: "core", node_id: "node" }, samples, thresholds: [{ metric_key: "containers_unhealthy", warning_value: 0, critical_value: 0, consecutive_breaches: 3 }], reachable: true, now });
  assert.equal(result.filter(d => d.action === "open" && d.metricKey === "containers_unhealthy").length, 1);
});

test("agent ingestion uses one authoritative metric and never invents a healthy absent inventory", async () => {
  const agent = { id: "agent", node_id: "node", organization_id: "org", is_enabled: true, capabilities: { read: true, write: false } };
  const received = [];
  const store = { listAgent: async () => agent, recordSamples: async rows => received.push(...rows), touchAgent: async () => {} };
  const now = Date.now();
  const report = { collected_at: new Date(now).toISOString(), metrics: { cpu_percent: 1, containers_unhealthy: 99 }, containers: [running, stopped("paused")] };
  assert.equal((await ingestAgentReport({ store, agentId: "agent", report, now })).accepted, true);
  assert.deepEqual(received.filter(s => s.metric_key === "containers_unhealthy").map(s => s.value), [0]);
  received.length = 0;
  assert.equal((await ingestAgentReport({ store, agentId: "agent", report: { collected_at: report.collected_at, metrics: { cpu_percent: 1 } }, now })).accepted, true);
  assert.equal(received.some(s => s.metric_key.startsWith("containers_")), false);
  for (const containers of ["invalid", Array.from({ length: 201 }, () => running)]) {
    assert.equal((await ingestAgentReport({ store, agentId: "agent", report: { ...report, containers }, now })).accepted, false);
  }
});
