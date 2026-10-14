/*
 * Tester för Infrastructure Monitoring V1.
 *
 *   node services/connector-engine/monitoring.test.mjs
 *
 * Inget nätverk och ingen databas. Det som prövas är larmlogiken: att en topp
 * inte blir en incident, att samma fel inte blir två, att saknad data öppnar
 * ett eget larm i stället för att tysta ett befintligt, och att en förfalskad
 * agentrapport avvisas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  consecutiveBreaches,
  evaluateTarget,
  groupKey,
  healthFor,
  incidentKey,
  isStale,
  levelFor,
  summarize,
} from "./monitoring.mjs";
import { IncidentEngine, groupIncidents } from "./incidents.mjs";
import {
  ALLOWED_METRICS,
  containerMetrics,
  normalizeContainers,
  validateAgentReport,
} from "./agent-contract.mjs";
import { ingestAgentReport } from "./engine.mjs";

const NU = Date.parse("2026-10-13T12:00:00Z");
const vidSekunder = (s) => new Date(NU - s * 1000).toISOString();

const metricKinds = {
  cpu_percent: { direction: "above" },
  memory_used_percent: { direction: "above" },
  disk_available_bytes: { direction: "below" },
};

const cpuTroskel = {
  metric_key: "cpu_percent",
  warning_value: 80,
  critical_value: 95,
  consecutive_breaches: 3,
  recovery_samples: 2,
  stale_after_seconds: 900,
  is_enabled: true,
};

const prov = (value, sekunderSedan, metric_key = "cpu_percent") => ({
  metric_key,
  value,
  collected_at: vidSekunder(sekunderSedan),
  source: "agent",
});

const mal = { organization_id: "org-1", node_id: "node-1", name: "kund-a-vps" };

/* ------------------------------------------------------------ grunderna */

test("riktningen avgör vad som är ett brott", () => {
  assert.equal(levelFor(96, cpuTroskel, "above"), "critical");
  assert.equal(levelFor(85, cpuTroskel, "above"), "warning");
  assert.equal(levelFor(40, cpuTroskel, "above"), "ok");
  // Ledigt diskutrymme är dåligt när det är lågt.
  const disk = { warning_value: 10e9, critical_value: 2e9 };
  assert.equal(levelFor(1e9, disk, "below"), "critical");
  assert.equal(levelFor(5e9, disk, "below"), "warning");
  assert.equal(levelFor(50e9, disk, "below"), "ok");
});

test("brott räknas bara i obruten följd från den senaste mätningen", () => {
  const samples = [prov(96, 60), prov(97, 120), prov(40, 180), prov(99, 240)];
  const { antal, niva } = consecutiveBreaches(samples, cpuTroskel, "above");
  assert.equal(antal, 2, "det friska värdet bryter kedjan");
  assert.equal(niva, "critical");
});

test("föråldrade mätvärden känns igen", () => {
  assert.equal(isStale(vidSekunder(60), 900, NU), false);
  assert.equal(isStale(vidSekunder(1000), 900, NU), true);
  assert.equal(isStale(null, 900, NU), true);
  assert.equal(isStale("inte-ett-datum", 900, NU), true);
});

/* --------------------------------------------------------- falsklarm */

test("en enstaka topp öppnar ingen incident", () => {
  const beslut = evaluateTarget({
    target: mal,
    samples: [prov(99, 60), prov(30, 120), prov(28, 180)],
    thresholds: [cpuTroskel],
    metricKinds,
    reachable: true,
    now: NU,
  });
  assert.equal(beslut.filter((b) => b.action === "open" && b.metricKey === "cpu_percent").length, 0);
});

test("tre brott i rad öppnar en incident", () => {
  const beslut = evaluateTarget({
    target: mal,
    samples: [prov(99, 60), prov(97, 120), prov(96, 180)],
    thresholds: [cpuTroskel],
    metricKinds,
    reachable: true,
    now: NU,
  });
  const oppnad = beslut.find((b) => b.action === "open" && b.metricKey === "cpu_percent");
  assert.ok(oppnad, "incidenten ska öppnas");
  assert.equal(oppnad.severity, "critical");
  assert.equal(oppnad.detail.consecutive, 3);
  assert.equal(oppnad.detail.required, 3);
});

test("samma fel igen blir en observation, inte en ny incident", () => {
  const befintlig = {
    id: "inc-1",
    incident_key: incidentKey({ kind: "metric_cpu_percent", nodeId: "node-1", metricKey: "cpu_percent" }),
    severity: "major",
    observation_count: 4,
  };
  const beslut = evaluateTarget({
    target: mal,
    samples: [prov(99, 60), prov(97, 120), prov(96, 180)],
    thresholds: [cpuTroskel],
    openIncidents: [befintlig],
    metricKinds,
    reachable: true,
    now: NU,
  });
  const atgard = beslut.find((b) => b.metricKey === "cpu_percent");
  assert.equal(atgard.action, "observe");
  assert.equal(atgard.incident.id, "inc-1");
  assert.equal(beslut.filter((b) => b.action === "open" && b.metricKey === "cpu_percent").length, 0);
});

test("återhämtning kräver flera friska mätningar i rad", () => {
  const befintlig = {
    id: "inc-1",
    incident_key: incidentKey({ kind: "metric_cpu_percent", nodeId: "node-1", metricKey: "cpu_percent" }),
    severity: "major",
  };
  const enFrisk = evaluateTarget({
    target: mal,
    samples: [prov(20, 60), prov(96, 120), prov(97, 180)],
    thresholds: [cpuTroskel],
    openIncidents: [befintlig],
    metricKinds,
    reachable: true,
    now: NU,
  });
  assert.equal(enFrisk.filter((b) => b.action === "resolve" && b.incidentKey.includes("cpu")).length, 0);

  const tvaFriska = evaluateTarget({
    target: mal,
    samples: [prov(20, 60), prov(22, 120), prov(97, 180)],
    thresholds: [cpuTroskel],
    openIncidents: [befintlig],
    metricKinds,
    reachable: true,
    now: NU,
  });
  const stangning = tvaFriska.find((b) => b.action === "resolve" && b.incidentKey.includes("cpu"));
  assert.ok(stangning);
  assert.equal(stangning.reason, "recovered");
});

/* ------------------------------------------------------- saknad data */

test("uteblivna mätvärden öppnar ett eget larm", () => {
  const beslut = evaluateTarget({
    target: mal,
    samples: [],
    thresholds: [cpuTroskel],
    metricKinds,
    reachable: true,
    now: NU,
  });
  const saknas = beslut.find((b) => b.action === "open" && b.kind === "monitoring_data_missing");
  assert.ok(saknas);
  assert.equal(saknas.detail.last_sample_at, null);
});

test("saknad data stänger ALDRIG en pågående incident", () => {
  const cpuIncident = {
    id: "inc-cpu",
    incident_key: incidentKey({ kind: "metric_cpu_percent", nodeId: "node-1", metricKey: "cpu_percent" }),
    severity: "critical",
  };
  const beslut = evaluateTarget({
    target: mal,
    samples: [prov(99, 5000)], // för gammalt
    thresholds: [cpuTroskel],
    openIncidents: [cpuIncident],
    metricKinds,
    reachable: true,
    now: NU,
  });
  assert.equal(
    beslut.filter((b) => b.action === "resolve").length,
    0,
    "ingenting får stängas när mätvärdena är föråldrade",
  );
  assert.ok(beslut.find((b) => b.kind === "monitoring_data_missing"));
});

test("okänd tillgänglighet är inte samma sak som nere", () => {
  const beslut = evaluateTarget({
    target: mal,
    samples: [prov(20, 60), prov(21, 120)],
    thresholds: [cpuTroskel],
    metricKinds,
    reachable: null,
    now: NU,
  });
  assert.equal(beslut.filter((b) => b.kind === "node_unreachable").length, 0);
});

test("otillgänglig nod ger en kritisk incident", () => {
  const beslut = evaluateTarget({
    target: mal,
    samples: [prov(20, 60), prov(21, 120)],
    thresholds: [cpuTroskel],
    metricKinds,
    reachable: false,
    now: NU,
  });
  const nere = beslut.find((b) => b.action === "open" && b.kind === "node_unreachable");
  assert.ok(nere);
  assert.equal(nere.severity, "critical");
});

/* ------------------------------------------------------- gruppering */

test("incidenter på samma nod delar grupp", () => {
  assert.equal(groupKey({ nodeId: "node-1" }), "node:node-1");
  const grupper = groupIncidents([
    { id: "a", group_key: "node:node-1", severity: "major", opened_at: "2026-10-13T10:00:00Z" },
    { id: "b", group_key: "node:node-1", severity: "critical", opened_at: "2026-10-13T10:05:00Z" },
    { id: "c", group_key: "service:svc-9", severity: "minor", opened_at: "2026-10-13T09:00:00Z" },
  ]);
  assert.equal(grupper.length, 2);
  const nodgrupp = grupper.find((g) => g.group_key === "node:node-1");
  assert.equal(nodgrupp.count, 2);
  assert.equal(nodgrupp.severity, "critical", "gruppen visar den allvarligaste nivån");
  assert.equal(nodgrupp.opened_at, "2026-10-13T10:00:00Z");
});

/* ----------------------------------------------------------- hälsa */

test("hälsan visar aldrig fungerande när något är okänt", () => {
  assert.equal(healthFor({ hasIntegration: false }), "not_connected");
  assert.equal(healthFor({ reachable: false }), "offline");
  assert.equal(healthFor({ reachable: true, stale: true }), "stale");
  assert.equal(healthFor({ reachable: null }), "unknown");
  assert.equal(healthFor({ reachable: true, worstLevel: "critical" }), "critical");
  assert.equal(healthFor({ reachable: true, worstLevel: "warning" }), "warning");
  assert.equal(healthFor({ reachable: true, worstLevel: "ok" }), "online");
});

test("sammanfattningen slår inte ihop lägena", () => {
  const s = summarize(["online", "online", "critical", "stale", "unknown", "not_connected"]);
  assert.deepEqual(s, { online: 2, warning: 0, critical: 1, offline: 0, stale: 1, unknown: 1, not_connected: 1 });
});

/* ------------------------------------------------- incidentmotorn */

function fakeStore(oppna = []) {
  const skrivet = { incidents: [], events: [], patchar: [] };
  return {
    skrivet,
    async openIncident(rad) {
      const incident = { id: `inc-${skrivet.incidents.length + 1}`, ...rad };
      skrivet.incidents.push(incident);
      return incident;
    },
    async touchIncident(id, patch) {
      skrivet.patchar.push({ id, ...patch });
    },
    async resolveIncident(id, patch) {
      skrivet.patchar.push({ id, ...patch });
    },
    async recordIncidentEvent(rad) {
      skrivet.events.push(rad);
    },
    async listOpenIncidents() {
      return oppna;
    },
  };
}

test("motorn öppnar en incident och skriver en händelse", async () => {
  const store = fakeStore();
  const engine = new IncidentEngine({ store, clock: () => new Date(NU) });
  const resultat = await engine.apply("org-1", [
    {
      action: "open",
      incidentKey: "node_unreachable:node-1:-:-",
      groupKey: "node:node-1",
      kind: "node_unreachable",
      severity: "critical",
      title: "kund-a-vps svarar inte",
      summary: "Senaste kontrollen fick inget svar.",
      nodeId: "node-1",
      detail: { reachable: false },
    },
  ]);
  assert.equal(resultat.opened.length, 1);
  assert.equal(store.skrivet.incidents[0].severity, "critical");
  assert.equal(store.skrivet.incidents[0].detected_by, "monitoring");
  assert.equal(store.skrivet.events[0].event_type, "opened");
});

test("motorn vägrar stänga med ett skäl som inte finns", async () => {
  const store = fakeStore();
  const engine = new IncidentEngine({ store, clock: () => new Date(NU) });
  const resultat = await engine.apply("org-1", [
    { action: "resolve", incident: { id: "inc-1" }, incidentKey: "x", reason: "missing_data" },
  ]);
  assert.equal(resultat.resolved.length, 0);
  assert.equal(resultat.refused.length, 1);
  assert.equal(store.skrivet.patchar.length, 0, "ingenting fick skrivas");
});

test("en observation eskalerar bara uppåt", async () => {
  const store = fakeStore();
  const engine = new IncidentEngine({ store, clock: () => new Date(NU) });
  await engine.apply("org-1", [
    { action: "observe", incident: { id: "i1", severity: "major", observation_count: 2 }, severity: "critical", detail: {} },
    { action: "observe", incident: { id: "i2", severity: "critical", observation_count: 9 }, severity: "warning", detail: {} },
  ]);
  assert.equal(store.skrivet.patchar[0].severity, "critical", "major → critical eskalerar");
  assert.equal(store.skrivet.patchar[0].observation_count, 3);
  assert.equal(store.skrivet.patchar[1].severity, undefined, "critical nedgraderas inte av en varning");
  assert.equal(store.skrivet.events[1].event_type, "observed");
});

/* ------------------------------------------------- agentkontraktet */

const agent = {
  id: "agent-1",
  organization_id: "org-1",
  node_id: "node-1",
  is_enabled: true,
  capabilities: { read: true, write: false },
};

const rapport = (over = {}) => ({
  organization_id: "org-1",
  node_id: "node-1",
  collected_at: new Date(NU - 30_000).toISOString(),
  metrics: { cpu_percent: 42, memory_used_percent: 61, disk_used_percent: 70 },
  containers: [
    { name: "berryit-db", state: "running", health: "healthy" },
    { name: "berryit-auth", state: "exited", health: "none" },
  ],
  ...over,
});

test("en giltig rapport accepteras och normaliseras", () => {
  const ut = validateAgentReport(rapport(), agent, NU);
  assert.equal(ut.samples.length, 3);
  assert.equal(ut.samples[0].source, "agent");
  assert.equal(ut.samples[0].agent_id, "agent-1");
  assert.ok(ut.samples.every((s) => s.node_id === "node-1" && s.organization_id === "org-1"));
});

test("en rapport för någon annans nod eller kund avvisas", () => {
  assert.throws(() => validateAgentReport(rapport({ node_id: "node-9" }), agent, NU), (e) => e.code === "WRONG_NODE");
  assert.throws(
    () => validateAgentReport(rapport({ organization_id: "org-9" }), agent, NU),
    (e) => e.code === "WRONG_ORGANIZATION",
  );
});

test("påhittade mätvärden och omöjliga värden avvisas", () => {
  assert.throws(
    () => validateAgentReport(rapport({ metrics: { hemlig_backdoor: 1 } }), agent, NU),
    (e) => e.code === "UNKNOWN_METRIC",
  );
  assert.throws(
    () => validateAgentReport(rapport({ metrics: { cpu_percent: 400 } }), agent, NU),
    (e) => e.code === "VALUE_OUT_OF_RANGE",
  );
  assert.throws(
    () => validateAgentReport(rapport({ metrics: { cpu_percent: "mycket" } }), agent, NU),
    (e) => e.code === "BAD_VALUE",
  );
});

test("tidsstämplar i framtiden eller för långt bak avvisas", () => {
  assert.throws(
    () => validateAgentReport(rapport({ collected_at: new Date(NU + 3600_000).toISOString() }), agent, NU),
    (e) => e.code === "FUTURE_TIMESTAMP",
  );
  assert.throws(
    () => validateAgentReport(rapport({ collected_at: new Date(NU - 7200_000).toISOString() }), agent, NU),
    (e) => e.code === "STALE_REPORT",
  );
});

test("en avstängd eller skrivande agent får inte rapportera", () => {
  assert.throws(() => validateAgentReport(rapport(), { ...agent, is_enabled: false }, NU), (e) => e.code === "AGENT_DISABLED");
  assert.throws(
    () => validateAgentReport(rapport(), { ...agent, capabilities: { read: true, write: true } }, NU),
    (e) => e.code === "WRITE_REFUSED",
  );
  assert.throws(() => validateAgentReport(rapport(), null, NU), (e) => e.code === "UNKNOWN_AGENT");
});

test("containerlistan bär bara namn, läge och hälsa", () => {
  const lista = normalizeContainers([
    { name: "x", state: "running", health: "healthy", env: ["SECRET=abc"], cmd: "sh -c rm -rf /" },
  ]);
  assert.deepEqual(lista, [{ name: "x", state: "running", health: "healthy" }]);
  assert.equal(Object.keys(lista[0]).length, 3);
});

test("containersiffrorna räknas ur listan, inte ur agentens påstående", () => {
  assert.deepEqual(containerMetrics(rapport().containers), { containers_running: 1, containers_unhealthy: 0 });
});

test("alla tillåtna mätvärden finns i kontraktet", () => {
  assert.ok(ALLOWED_METRICS.includes("cpu_percent"));
  assert.ok(ALLOWED_METRICS.includes("disk_available_bytes"));
  assert.equal(ALLOWED_METRICS.length, 8);
});

/* --------------------------------------------- mottagandet i motorn */

function agentStore(registrerad) {
  const skrivet = { samples: [], agentPatchar: [] };
  return {
    skrivet,
    async listAgent() {
      return registrerad;
    },
    async recordSamples(rader) {
      skrivet.samples.push(...rader);
    },
    async touchAgent(id, patch) {
      skrivet.agentPatchar.push({ id, ...patch });
    },
  };
}

test("en giltig rapport sparas med härledda containersiffror", async () => {
  const store = agentStore(agent);
  const ut = await ingestAgentReport({ store, agentId: "agent-1", report: rapport(), now: NU });
  assert.equal(ut.accepted, true);
  assert.equal(store.skrivet.samples.length, 5, "tre mätvärden plus två härledda containersiffror");
  assert.ok(store.skrivet.samples.find((s) => s.metric_key === "containers_running" && s.value === 1));
  assert.equal(store.skrivet.agentPatchar[0].last_error, null);
});

test("en förfalskad rapport sparar ingenting och noteras på agenten", async () => {
  const store = agentStore(agent);
  const ut = await ingestAgentReport({
    store,
    agentId: "agent-1",
    report: rapport({ organization_id: "org-9" }),
    now: NU,
  });
  assert.equal(ut.accepted, false);
  assert.equal(ut.code, "WRONG_ORGANIZATION");
  assert.equal(store.skrivet.samples.length, 0, "inget mätvärde fick sparas");
  assert.match(store.skrivet.agentPatchar[0].last_error, /WRONG_ORGANIZATION/);
});

test("en okänd agent kan inte skriva mätvärden", async () => {
  const store = agentStore(null);
  const ut = await ingestAgentReport({ store, agentId: "finns-inte", report: rapport(), now: NU });
  assert.equal(ut.accepted, false);
  assert.equal(ut.code, "UNKNOWN_AGENT");
  assert.equal(store.skrivet.samples.length, 0);
});
