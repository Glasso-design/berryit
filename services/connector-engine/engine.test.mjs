/*
 * Tester för Connector Engine.
 *
 *   node services/connector-engine/engine.test.mjs
 *
 * Inget nätverk: alla adaptrar får en fetch-attrapp. Det som prövas är
 * kontraktet – läsläge, felhantering, att hemligheter inte läcker ut, och att
 * en adapter inte kan rapportera "fungerar" utan att ha fått svar.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ConnectorError,
  assertValidAdapter,
  errorResult,
  fetchWithTimeout,
  makeResult,
  requireSecret,
  sanitizeDetail,
} from "./contract.mjs";
import {
  ADAPTERS,
  dockerAdapter,
  githubAdapter,
  httpHealthAdapter,
  onarlyAiAdapter,
  onarlyDeskAdapter,
  vercelAdapter,
} from "./adapters.mjs";
import { ConnectorEngine, statusForIntegration } from "./engine.mjs";

const svar = (status, kropp) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => kropp,
  text: async () => JSON.stringify(kropp),
});

const ctx = (over = {}) => ({
  config: {},
  secretRef: null,
  secrets: {},
  fetchImpl: async () => svar(200, {}),
  dockerList: null,
  timeoutMs: 1000,
  ...over,
});

/* ----------------------------------------------------------- kontraktet */

test("alla adaptrar följer kontraktet", () => {
  for (const adapter of ADAPTERS) assert.equal(assertValidAdapter(adapter), true);
  assert.equal(ADAPTERS.length, 6);
});

test("en adapter som påstår sig kunna skriva avvisas", () => {
  assert.throws(
    () => assertValidAdapter({ key: "x", check: () => {}, capabilities: { read: true, write: true } }),
    /skrivläge/,
  );
});

test("en adapter med en skrivande metod avvisas", () => {
  assert.throws(
    () => assertValidAdapter({ key: "x", check: () => {}, restart: () => {}, capabilities: { read: true, write: false } }),
    /restart/,
  );
});

test("okänd status normaliseras i stället för att släppas igenom", () => {
  const r = makeResult({ connector: "github", status: "fantastiskt", summary: "" });
  assert.equal(r.status, "unknown");
});

test("en skrivande metod mot ett externt system avvisas innan anropet görs", async () => {
  for (const metod of ["POST", "PUT", "PATCH", "DELETE"]) {
    let anropad = false;
    await assert.rejects(
      fetchWithTimeout(
        async () => {
          anropad = true;
          return svar(200, {});
        },
        "https://example.test/x",
        { method: metod },
      ),
      (e) => e instanceof ConnectorError && e.code === "WRITE_REFUSED",
      `${metod} skulle avvisas`,
    );
    assert.equal(anropad, false, `${metod} fick inte ens skickas`);
  }
});

test("läsande metoder släpps igenom", async () => {
  for (const init of [{}, { method: "GET" }, { method: "head" }]) {
    const r = await fetchWithTimeout(async () => svar(200, {}), "https://example.test/x", init);
    assert.equal(r.status, 200);
  }
});

test("ingen adapter skickar något annat än GET", async () => {
  const metoder = [];
  const fetchSpion = async (_url, init) => {
    metoder.push(String(init?.method ?? "GET").toUpperCase());
    return svar(200, { deployments: [], gateway: "configured", online: true });
  };
  const anrop = [
    githubAdapter.check(ctx({ config: { repository: "a/b" }, secretRef: "t", secrets: { t: "x" }, fetchImpl: fetchSpion })),
    vercelAdapter.check(ctx({ config: { project_id: "p" }, secretRef: "t", secrets: { t: "x" }, fetchImpl: fetchSpion })),
    onarlyAiAdapter.check(ctx({ config: { base_url: "https://a.test" }, fetchImpl: fetchSpion })),
    onarlyDeskAdapter.check(ctx({ config: { base_url: "https://d.test" }, secretRef: "t", secrets: { t: "x" }, fetchImpl: fetchSpion })),
    httpHealthAdapter.check(ctx({ config: { url: "https://h.test" }, fetchImpl: fetchSpion })),
  ];
  await Promise.all(anrop.map((p) => p.catch(() => null)));
  assert.ok(metoder.length >= 4, "alla adaptrar som använder HTTP ska ha anropat");
  assert.deepEqual([...new Set(metoder)], ["GET"]);
});

/* --------------------------------------------------- hemligheter läcker inte */

test("detaljer med nyckelliknande fält maskeras", () => {
  const rensad = sanitizeDetail({
    repository: "glasso/berryit",
    token: "ghp_abcdefghijklmnopqrstuvwxyz",
    nested: { api_key: "hemligt", ok: true },
  });
  assert.equal(rensad.repository, "glasso/berryit");
  assert.equal(rensad.token, "[dolt]");
  assert.equal(rensad.nested.api_key, "[dolt]");
  assert.equal(rensad.nested.ok, true);
});

test("strängar som ser ut som nycklar maskeras även i oskyldiga fält", () => {
  const rensad = sanitizeDetail({
    note: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
    other: "ghp_0123456789abcdefghij",
  });
  assert.equal(rensad.note, "[dolt]");
  assert.equal(rensad.other, "[dolt]");
});

test("hemligheten hämtas via namn och saknas den blir det ett tydligt fel", () => {
  assert.equal(requireSecret({ github_berryit: "x" }, "github_berryit", "github"), "x");
  assert.throws(() => requireSecret({}, "github_berryit", "github"), /finns inte på servern/);
  assert.throws(() => requireSecret({}, null, "github"), /ingen secret_ref/);
});

/* ------------------------------------------------------------- adaptrarna */

test("http_health: rätt statuskod ger ok", async () => {
  const r = await httpHealthAdapter.check(
    ctx({ config: { url: "https://example.test/health" }, fetchImpl: async () => svar(200, {}) }),
  );
  assert.equal(r.status, "ok");
  assert.equal(r.connector, "http_health");
  assert.equal(r.detail.status, 200);
});

test("http_health: fel statuskod ger down, inte ok", async () => {
  const r = await httpHealthAdapter.check(
    ctx({ config: { url: "https://example.test/health" }, fetchImpl: async () => svar(500, {}) }),
  );
  assert.equal(r.status, "down");
});

test("http_health: omdirigering är försämrad, inte nere", async () => {
  const r = await httpHealthAdapter.check(
    ctx({ config: { url: "https://example.test" }, fetchImpl: async () => svar(301, {}) }),
  );
  assert.equal(r.status, "degraded");
});

test("github: läser senaste commit", async () => {
  const r = await githubAdapter.check(
    ctx({
      config: { repository: "glasso/berryit" },
      secretRef: "github_token",
      secrets: { github_token: "hemlig" },
      fetchImpl: async () =>
        svar(200, [{ sha: "abc1234def", commit: { message: "feat: x\n\nmer", committer: { date: "2026-10-13T10:00:00Z" } } }]),
    }),
  );
  assert.equal(r.status, "ok");
  assert.equal(r.detail.sha, "abc1234def");
  assert.equal(r.detail.message, "feat: x");
});

test("github: 401 ger UNAUTHORIZED, inte en gissad status", async () => {
  await assert.rejects(
    githubAdapter.check(
      ctx({
        config: { repository: "glasso/berryit" },
        secretRef: "t",
        secrets: { t: "x" },
        fetchImpl: async () => svar(401, {}),
      }),
    ),
    (e) => e instanceof ConnectorError && e.code === "UNAUTHORIZED",
  );
});

test("vercel: byggande deployment är försämrad", async () => {
  const r = await vercelAdapter.check(
    ctx({
      config: { project_id: "prj_1" },
      secretRef: "v",
      secrets: { v: "x" },
      fetchImpl: async () => svar(200, { deployments: [{ state: "BUILDING", url: "x.vercel.app", created: 1 }] }),
    }),
  );
  assert.equal(r.status, "degraded");
});

test("vercel: misslyckad deployment är nere", async () => {
  const r = await vercelAdapter.check(
    ctx({
      config: { project_id: "prj_1" },
      secretRef: "v",
      secrets: { v: "x" },
      fetchImpl: async () => svar(200, { deployments: [{ state: "ERROR" }] }),
    }),
  );
  assert.equal(r.status, "down");
});

test("docker: räknar containrar utan att röra dem", async () => {
  const r = await dockerAdapter.check(
    ctx({
      config: { socket_path: "/var/run/docker.sock", name_prefix: "berryit-" },
      dockerList: async () => [
        { name: "berryit-support-db", state: "running", health: "healthy" },
        { name: "berryit-support-auth", state: "running", health: "healthy" },
        { name: "onarly-hub", state: "running", health: "healthy" },
      ],
    }),
  );
  assert.equal(r.status, "ok");
  assert.equal(r.detail.totalt, 2, "endast containrar med rätt prefix räknas");
  assert.equal(r.detail.kor, 2);
});

test("docker: stoppad container ger försämrad status", async () => {
  const r = await dockerAdapter.check(
    ctx({
      config: { socket_path: "/var/run/docker.sock", name_prefix: "berryit-" },
      dockerList: async () => [
        { name: "berryit-a", state: "running", health: "healthy" },
        { name: "berryit-b", state: "exited", health: "none" },
      ],
    }),
  );
  assert.equal(r.status, "degraded");
  assert.deepEqual(r.detail.stoppade, ["berryit-b"]);
});

test("docker: utan läsare för socketen blir svaret okänt, inte ok", async () => {
  await assert.rejects(
    dockerAdapter.check(ctx({ config: { socket_path: "/var/run/docker.sock" } })),
    (e) => e.code === "NOT_CONFIGURED",
  );
});

test("onarly_ai: går via vår egen adapter och ser aldrig gateway-token", async () => {
  let anropad = null;
  const r = await onarlyAiAdapter.check(
    ctx({
      config: { base_url: "http://127.0.0.1:8700" },
      fetchImpl: async (url, init) => {
        anropad = { url, headers: init?.headers ?? {} };
        return svar(200, { gateway: "configured" });
      },
    }),
  );
  assert.equal(r.status, "ok");
  assert.match(anropad.url, /\/ai\/v1\/health$/);
  assert.equal(Object.keys(anropad.headers).length, 0, "ingen Authorization skickas från motorn");
});

test("onarly_desk: saknar sessions-API och gör inget HTTP-anrop", async () => {
  let anrop = 0;
  const r = await onarlyDeskAdapter.check(
    ctx({ fetchImpl: async () => { anrop++; throw new Error("DESK får inte anropas"); } }),
  );
  assert.equal(r.status, "unknown");
  assert.equal(r.detail.session_api, false);
  assert.equal(anrop, 0);
  assert.equal(statusForIntegration(r), "not_configured");
});

/* ---------------------------------------------------------------- motorn */

function fakeStore(integrationer) {
  const skrivna = { status: [], aktivitet: [], uppdateringar: [] };
  return {
    skrivna,
    async listIntegrations() {
      return integrationer;
    },
    async recordStatus(rad) {
      skrivna.status.push(rad);
    },
    async updateIntegrationStatus(id, patch) {
      skrivna.uppdateringar.push({ id, ...patch });
    },
    async recordActivity(rad) {
      skrivna.aktivitet.push(rad);
    },
  };
}

const integration = (over = {}) => ({
  id: "int-1",
  organization_id: "org-1",
  connector_key: "http_health",
  access_mode: "read_only",
  is_enabled: true,
  scope_kind: "service",
  service_id: "svc-1",
  node_id: null,
  project_id: null,
  config: { url: "https://example.test" },
  secret_ref: null,
  ...over,
});

test("motorn kör en integration och sparar mätpunkt, status och aktivitet", async () => {
  const store = fakeStore([integration()]);
  const engine = new ConnectorEngine({ store, fetchImpl: async () => svar(200, {}) });
  const resultat = await engine.runForOrganization("org-1");

  assert.equal(resultat.length, 1);
  assert.equal(resultat[0].status, "ok");
  assert.equal(store.skrivna.status.length, 1);
  assert.equal(store.skrivna.status[0].service_id, "svc-1");
  assert.equal(store.skrivna.status[0].source, "http_health");
  assert.equal(store.skrivna.uppdateringar[0].status, "connected");
  assert.equal(store.skrivna.aktivitet[0].action, "check");
});

test("motorn vägrar köra en integration som inte är i läsläge", async () => {
  const store = fakeStore([integration({ access_mode: "read_write" })]);
  const engine = new ConnectorEngine({ store, fetchImpl: async () => svar(200, {}) });
  const resultat = await engine.runForOrganization("org-1");

  assert.equal(resultat[0].error.code, "WRITE_REFUSED");
  assert.equal(store.skrivna.uppdateringar[0].status, "error");
});

test("en integration utan konfiguration ger not_configured, inte connected", async () => {
  const store = fakeStore([integration({ connector_key: "github", config: {}, secret_ref: null })]);
  const engine = new ConnectorEngine({ store, fetchImpl: async () => svar(200, []) });
  const resultat = await engine.runForOrganization("org-1");

  assert.equal(resultat[0].status, "unknown");
  assert.equal(store.skrivna.uppdateringar[0].status, "not_configured");
});

test("ett fel i en integration stoppar inte de andra", async () => {
  const store = fakeStore([
    integration({ id: "a", connector_key: "github", config: {} }),
    integration({ id: "b" }),
  ]);
  const engine = new ConnectorEngine({ store, fetchImpl: async () => svar(200, {}) });
  const resultat = await engine.runForOrganization("org-1");

  assert.equal(resultat.length, 2);
  assert.equal(resultat[1].status, "ok");
});

test("en integration utan mål sparar ingen mätpunkt", async () => {
  const store = fakeStore([integration({ scope_kind: "organization", service_id: null, node_id: null })]);
  const engine = new ConnectorEngine({ store, fetchImpl: async () => svar(200, {}) });
  await engine.runForOrganization("org-1");

  assert.equal(store.skrivna.status.length, 0, "mätpunkt utan hemvist sparas inte");
  assert.equal(store.skrivna.uppdateringar.length, 1, "men integrationens läge uppdateras ändå");
});

test("ansluten connector som ser en nere tjänst är fortfarande ansluten", () => {
  assert.equal(statusForIntegration(makeResult({ connector: "http_health", status: "down", summary: "" })), "connected");
  assert.equal(
    statusForIntegration(errorResult("github", new ConnectorError("UNAUTHORIZED", "x"))),
    "error",
  );
});

test("motorn vägrar starta med en adapter som bryter kontraktet", () => {
  assert.throws(
    () =>
      new ConnectorEngine({
        store: fakeStore([]),
        adapters: [{ key: "trasig", check: () => {}, capabilities: { read: true, write: true } }],
      }),
    /skrivläge/,
  );
});
