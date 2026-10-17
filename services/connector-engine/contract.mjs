/*
 * Connector Engine – kontraktet varje adapter följer.
 *
 * Motorn kör på servern. Den är den enda som ser tokens, socketar och nycklar;
 * Windows-appen läser bara resultatet ur databasen med användarens egen JWT.
 *
 * Tre saker gör kontraktet strängt med flit:
 *
 *   1. En adapter deklarerar sina förmågor och motorn vägrar allt som inte är
 *      läsning. Spärren sitter i motorn, inte i varje adapter, så en slarvigt
 *      skriven adapter kan inte öppna en skrivväg av misstag.
 *   2. Ett svar bär alltid vem som svarade och när. "Okänd" är ett giltigt och
 *      ärligt svar; vi hittar aldrig på ett "fungerar".
 *   3. Hemligheter hämtas av motorn ur serverns store med hjälp av ett NAMN
 *      ur registret. En adapter får aldrig ett helt konfigurationsobjekt med
 *      nycklar i, och den returnerar aldrig något som kan innehålla en nyckel.
 */

/** Felkoder som gränssnittet kan översätta utan att gissa. */
export const ERROR_CODES = [
  "NOT_CONFIGURED",
  "MISSING_SECRET",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "TIMEOUT",
  "UNREACHABLE",
  "BAD_RESPONSE",
  "BAD_CONFIG",
  "WRITE_REFUSED",
  "INTERNAL",
];

export class ConnectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ConnectorError";
    this.code = ERROR_CODES.includes(code) ? code : "INTERNAL";
  }
}

export const READ_ONLY = Object.freeze({ read: true, write: false });

/** Fält som aldrig får följa med ut ur en adapter. */
const FORBIDDEN_DETAIL_KEYS = [
  "token",
  "access_token",
  "refresh_token",
  "authorization",
  "apikey",
  "api_key",
  "secret",
  "password",
  "key",
  "private_key",
  "cookie",
];

/**
 * Rensar detaljobjektet innan det lämnar motorn.
 *
 * Det är inte en formalitet: detaljerna skrivs till databasen och visas i
 * Desktop, så allt som ser ut som en hemlighet maskeras här – även om en
 * adapter skulle råka plocka med det.
 */
export function sanitizeDetail(detail, djup = 0) {
  if (detail === null || detail === undefined) return {};
  if (djup > 4) return {};
  if (Array.isArray(detail)) return detail.slice(0, 50).map((v) => sanitizeValue(v, djup + 1));
  if (typeof detail !== "object") return {};

  const ut = {};
  for (const [nyckel, varde] of Object.entries(detail)) {
    const lower = nyckel.toLowerCase();
    if (FORBIDDEN_DETAIL_KEYS.some((f) => lower === f || lower.endsWith(`_${f}`))) {
      ut[nyckel] = "[dolt]";
      continue;
    }
    ut[nyckel] = sanitizeValue(varde, djup + 1);
  }
  return ut;
}

function sanitizeValue(varde, djup) {
  if (typeof varde === "string") {
    // En sträng som ser ut som en JWT eller en lång nyckel hör inte hemma i
    // detaljer, oavsett vad fältet heter.
    if (/^eyJ[A-Za-z0-9_-]{8,}\./.test(varde)) return "[dolt]";
    if (/^(gh[pousr]_|sk-|xox[baprs]-|AIza)[A-Za-z0-9_-]{10,}/.test(varde)) return "[dolt]";
    return varde.length > 500 ? `${varde.slice(0, 500)}…` : varde;
  }
  if (varde && typeof varde === "object") return sanitizeDetail(varde, djup);
  return varde;
}

/** Bygger ett normaliserat, städat resultat. */
export function makeResult({
  connector,
  status,
  summary,
  detail = {},
  latencyMs = null,
  error = null,
  checkedAt = new Date().toISOString(),
}) {
  const giltig = ["ok", "degraded", "down", "unknown"];
  return {
    connector,
    status: giltig.includes(status) ? status : "unknown",
    checkedAt,
    latencyMs: typeof latencyMs === "number" && latencyMs >= 0 ? Math.round(latencyMs) : null,
    summary: String(summary ?? "").slice(0, 500),
    detail: sanitizeDetail(detail),
    error: error ? { code: error.code ?? "INTERNAL", message: String(error.message ?? "").slice(0, 500) } : null,
  };
}

/** Ett fel blir ett resultat, inte ett kastat undantag. Motorn ska aldrig stanna. */
export function errorResult(connector, error, latencyMs = null) {
  const fel = error instanceof ConnectorError ? error : new ConnectorError("INTERNAL", String(error?.message ?? error));
  const status = ["NOT_CONFIGURED", "MISSING_SECRET", "BAD_CONFIG"].includes(fel.code) ? "unknown" : "down";
  return makeResult({
    connector,
    status,
    summary: fel.message,
    latencyMs,
    error: fel,
  });
}

/**
 * Kontrollerar att en adapter är byggd som kontraktet kräver.
 * Körs när adaptern registreras, inte när den används – ett fel ska synas vid
 * start och inte vid första kundanropet.
 */
export function assertValidAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") throw new Error("Adaptern saknas");
  if (typeof adapter.key !== "string" || !adapter.key) throw new Error("Adaptern saknar key");
  if (typeof adapter.check !== "function") throw new Error(`Adaptern ${adapter.key} saknar check()`);
  if (!adapter.capabilities || adapter.capabilities.read !== true) {
    throw new Error(`Adaptern ${adapter.key} måste kunna läsa`);
  }
  if (adapter.capabilities.write !== false) {
    throw new Error(`Adaptern ${adapter.key} deklarerar skrivläge, vilket inte är tillåtet i denna version`);
  }
  // Metodnamn som antyder att adaptern gör mer än att läsa.
  const skrivande = ["restart", "deploy", "write", "delete", "update", "start", "stop", "exec", "run"];
  for (const namn of Object.keys(adapter)) {
    if (skrivande.includes(namn.toLowerCase())) {
      throw new Error(`Adaptern ${adapter.key} har metoden ${namn}, som inte hör hemma i en läsande connector`);
    }
  }
  return true;
}

/** Hämtar ett krav ur config och ger ett begripligt fel om det saknas. */
export function requireConfig(config, nyckel, connector) {
  const varde = config?.[nyckel];
  if (varde === undefined || varde === null || varde === "") {
    throw new ConnectorError("NOT_CONFIGURED", `${connector}: ${nyckel} saknas i konfigurationen`);
  }
  return varde;
}

/** Hämtar en hemlighet ur serverns store via dess namn. */
export function requireSecret(secrets, secretRef, connector) {
  if (!secretRef) {
    throw new ConnectorError("MISSING_SECRET", `${connector}: ingen secret_ref angiven`);
  }
  const varde = secrets?.[secretRef];
  if (!varde) {
    throw new ConnectorError("MISSING_SECRET", `${connector}: hemligheten ${secretRef} finns inte på servern`);
  }
  return varde;
}

/**
 * fetch med tidsgräns – och med läsläget inbyggt.
 *
 * Alla adaptrar går genom den här funktionen, så spärren sitter på ett ställe i
 * stället för i sex. En adapter som skickar POST, PUT, PATCH eller DELETE mot
 * ett främmande system avvisas innan anropet görs. Det gör läsläget till något
 * strukturellt, inte en överenskommelse man kan glömma vid nästa ändring.
 *
 * Motorns egna skrivningar mot BERRYiT:s register går inte genom den här
 * funktionen – de använder sin egen store (se engine.mjs).
 */
const LASANDE_METODER = ["GET", "HEAD"];

export async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = 8000) {
  const metod = String(init.method ?? "GET").toUpperCase();
  if (!LASANDE_METODER.includes(metod)) {
    throw new ConnectorError(
      "WRITE_REFUSED",
      `En connector får bara läsa. ${metod} mot ett externt system är inte tillåtet.`,
    );
  }

  const styr = new AbortController();
  const timer = setTimeout(() => styr.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: styr.signal, redirect: "manual" });
  } catch (e) {
    if (e?.name === "AbortError") throw new ConnectorError("TIMEOUT", `Svarade inte inom ${timeoutMs} ms`);
    throw new ConnectorError("UNREACHABLE", `Kunde inte nå tjänsten: ${e?.message ?? e}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Översätter en HTTP-status till ett connectorfel. */
export function httpError(status, connector) {
  if (status === 401) return new ConnectorError("UNAUTHORIZED", `${connector}: identiteten godtogs inte`);
  if (status === 403) return new ConnectorError("FORBIDDEN", `${connector}: identiteten saknar behörighet`);
  if (status === 404) return new ConnectorError("NOT_FOUND", `${connector}: resursen finns inte`);
  return new ConnectorError("BAD_RESPONSE", `${connector}: oväntad status ${status}`);
}
