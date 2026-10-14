/*
 * Connector Engine – adaptrarna.
 *
 * Varje adapter gör en sak: den frågar ett system hur det mår och översätter
 * svaret till motorns gemensamma form. Ingen av dem startar om något, deployar
 * något eller skriver i något annat projekts databas.
 *
 * Adaptrarna tar emot `fetchImpl` och eventuella hemligheter som argument i
 * stället för att läsa globala värden. Det gör dem testbara utan nätverk, och
 * det gör det omöjligt för en adapter att plocka upp en nyckel den inte fått.
 */
import {
  ConnectorError,
  READ_ONLY,
  fetchWithTimeout,
  httpError,
  makeResult,
  requireConfig,
  requireSecret,
} from "./contract.mjs";

const nu = () => Date.now();

/* ------------------------------------------------------------------ Docker */

/**
 * Läser containerläget på en nod via Docker Engine API över en unix-socket.
 *
 * Socketen monteras read-only i motorns container och finns aldrig i
 * Windows-appen. Adaptern listar containrar och rapporterar hur många som kör
 * respektive är ohälsosamma – den rör dem inte.
 */
export const dockerAdapter = {
  key: "docker",
  label: "Docker och serverövervakning",
  capabilities: READ_ONLY,
  async check(ctx) {
    const start = nu();
    const socket = requireConfig(ctx.config, "socket_path", "docker");
    const prefix = ctx.config.name_prefix ?? "";
    if (!ctx.dockerList) {
      throw new ConnectorError("NOT_CONFIGURED", "docker: ingen läsare för Docker-socket är tillgänglig");
    }

    const containrar = await ctx.dockerList({ socketPath: socket });
    const relevanta = containrar.filter((c) => !prefix || (c.name ?? "").startsWith(prefix));
    const kor = relevanta.filter((c) => c.state === "running");
    const ohalsosamma = relevanta.filter((c) => c.health === "unhealthy");
    const stoppade = relevanta.filter((c) => c.state !== "running");

    let status = "ok";
    if (relevanta.length === 0) status = "unknown";
    else if (ohalsosamma.length > 0 || stoppade.length > 0) status = kor.length > 0 ? "degraded" : "down";

    return makeResult({
      connector: "docker",
      status,
      latencyMs: nu() - start,
      summary:
        relevanta.length === 0
          ? `Inga containrar matchade prefixet "${prefix}"`
          : `${kor.length} av ${relevanta.length} containrar kör` +
            (ohalsosamma.length ? `, ${ohalsosamma.length} ohälsosamma` : ""),
      detail: {
        totalt: relevanta.length,
        kor: kor.length,
        stoppade: stoppade.map((c) => c.name).slice(0, 20),
        ohalsosamma: ohalsosamma.map((c) => c.name).slice(0, 20),
      },
    });
  },
};

/* ------------------------------------------------------------------ GitHub */

export const githubAdapter = {
  key: "github",
  label: "GitHub",
  capabilities: READ_ONLY,
  async check(ctx) {
    const start = nu();
    const repo = requireConfig(ctx.config, "repository", "github");
    const token = requireSecret(ctx.secrets, ctx.secretRef, "github");
    const bas = ctx.config.api_base ?? "https://api.github.com";

    const svar = await fetchWithTimeout(
      ctx.fetchImpl,
      `${bas}/repos/${repo}/commits?per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "berryit-connector-engine",
        },
      },
      ctx.timeoutMs,
    );
    if (!svar.ok) throw httpError(svar.status, "github");

    const commits = await svar.json();
    const senaste = Array.isArray(commits) ? commits[0] : null;

    return makeResult({
      connector: "github",
      status: senaste ? "ok" : "unknown",
      latencyMs: nu() - start,
      summary: senaste
        ? `Senaste commit ${String(senaste.sha ?? "").slice(0, 7)} i ${repo}`
        : `Inga commits hittades i ${repo}`,
      detail: {
        repository: repo,
        sha: senaste?.sha ?? null,
        committed_at: senaste?.commit?.committer?.date ?? null,
        message: senaste?.commit?.message?.split("\n")[0] ?? null,
      },
    });
  },
};

/* ------------------------------------------------------------------ Vercel */

export const vercelAdapter = {
  key: "vercel",
  label: "Vercel",
  capabilities: READ_ONLY,
  async check(ctx) {
    const start = nu();
    const projekt = requireConfig(ctx.config, "project_id", "vercel");
    const token = requireSecret(ctx.secrets, ctx.secretRef, "vercel");
    const bas = ctx.config.api_base ?? "https://api.vercel.com";
    const team = ctx.config.team_id ? `&teamId=${encodeURIComponent(ctx.config.team_id)}` : "";

    const svar = await fetchWithTimeout(
      ctx.fetchImpl,
      `${bas}/v6/deployments?projectId=${encodeURIComponent(projekt)}&limit=1${team}`,
      { headers: { Authorization: `Bearer ${token}` } },
      ctx.timeoutMs,
    );
    if (!svar.ok) throw httpError(svar.status, "vercel");

    const kropp = await svar.json();
    const senaste = kropp?.deployments?.[0] ?? null;
    const tillstand = String(senaste?.state ?? senaste?.readyState ?? "").toUpperCase();

    let status = "unknown";
    if (tillstand === "READY") status = "ok";
    else if (tillstand === "ERROR" || tillstand === "CANCELED") status = "down";
    else if (tillstand === "BUILDING" || tillstand === "QUEUED") status = "degraded";

    return makeResult({
      connector: "vercel",
      status,
      latencyMs: nu() - start,
      summary: senaste ? `Senaste deployment: ${tillstand || "okänt läge"}` : "Inga deployments hittades",
      detail: {
        project_id: projekt,
        state: tillstand || null,
        url: senaste?.url ? `https://${senaste.url}` : null,
        created_at: senaste?.created ? new Date(senaste.created).toISOString() : null,
      },
    });
  },
};

/* -------------------------------------------------------------- ONARLY AI */

/**
 * Går genom BERRYiT:s egen AI-adapter (services/onarly-ai-adapter), som redan
 * håller gateway-token server-side. Motorn ser alltså aldrig ONARLY:s nyckel –
 * den frågar bara vår egen adapter hur den mår.
 */
export const onarlyAiAdapter = {
  key: "onarly_ai",
  label: "ONARLY AI Gateway",
  capabilities: READ_ONLY,
  async check(ctx) {
    const start = nu();
    const bas = String(requireConfig(ctx.config, "base_url", "onarly_ai")).replace(/\/+$/, "");

    const svar = await fetchWithTimeout(ctx.fetchImpl, `${bas}/ai/v1/health`, {}, ctx.timeoutMs);
    if (!svar.ok) throw httpError(svar.status, "onarly_ai");

    const kropp = await svar.json().catch(() => ({}));
    const gatewayOk = kropp?.gateway === "configured" || kropp?.gateway === true || kropp?.ok === true;

    return makeResult({
      connector: "onarly_ai",
      status: gatewayOk ? "ok" : "degraded",
      latencyMs: nu() - start,
      summary: gatewayOk
        ? "AI-adaptern svarar och har en konfigurerad gateway"
        : "AI-adaptern svarar men gatewayen är inte konfigurerad",
      detail: { adapter: "berryit-onarly-ai-adapter", gateway_configured: Boolean(gatewayOk) },
    });
  },
};

/* ------------------------------------------------------------ ONARLY DESK */

export const onarlyDeskAdapter = {
  key: "onarly_desk",
  label: "ONARLY DESK",
  capabilities: READ_ONLY,
  async check() {
    // ONARLY DESK/RustDesk exposes no verified server-side session API here.
    // Never infer connectivity from a guessed endpoint or a manual record.
    return makeResult({
      connector: "onarly_desk",
      status: "unknown",
      latencyMs: null,
      summary: "DESK saknar serverbaserat sessions-API; faktisk anslutningsstatus är okänd",
      detail: { session_api: false, actual_connection_status: "unknown" },
    });
  },
};

/* ------------------------------------------------------------ HTTP-hälsa */

export const httpHealthAdapter = {
  key: "http_health",
  label: "Webbplats och API-hälsa",
  capabilities: READ_ONLY,
  async check(ctx) {
    const start = nu();
    const url = requireConfig(ctx.config, "url", "http_health");
    const forvantad = Number(ctx.config.expect_status ?? 200);

    const svar = await fetchWithTimeout(ctx.fetchImpl, url, { method: "GET" }, ctx.timeoutMs);
    const latens = nu() - start;
    const traffad = svar.status === forvantad;
    // En omdirigering är inte ett fel, men den är inte heller det vi bad om.
    const omdirigering = svar.status >= 300 && svar.status < 400;

    return makeResult({
      connector: "http_health",
      status: traffad ? "ok" : omdirigering ? "degraded" : "down",
      latencyMs: latens,
      summary: traffad
        ? `Svarade ${svar.status} på ${latens} ms`
        : `Svarade ${svar.status}, förväntat ${forvantad}`,
      detail: { url, status: svar.status, expected: forvantad, latency_ms: latens },
    });
  },
};

export const ADAPTERS = [
  dockerAdapter,
  githubAdapter,
  vercelAdapter,
  onarlyAiAdapter,
  onarlyDeskAdapter,
  httpHealthAdapter,
];
