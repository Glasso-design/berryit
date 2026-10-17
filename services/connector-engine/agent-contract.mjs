/*
 * Kontrakt för BERRYiT:s läsande monitoring-agent.
 *
 * Varför agenten finns
 * --------------------
 * Connector Engine ska inte ha Docker-socketen. En socket är full
 * administrativ kontroll över värden: den som kan läsa den kan också starta,
 * stoppa och köra kommandon i containrar. Därför ligger den hos en liten agent
 * på noden, och agenten skickar ett *färdigt mätresultat* vidare. Motorn tar
 * emot siffror, inte en väg in i maskinen.
 *
 * Vad agenten får göra
 * --------------------
 *   läsa /proc, diskanvändning och Docker Engine API:s list- och inspect-anrop
 *
 * Vad den aldrig gör
 * ------------------
 *   starta, stoppa, bygga eller exec:a containrar, skriva filer, öppna portar
 *   eller skicka något annat än den här rapporten
 *
 * Rapporten valideras här innan ett enda värde sparas. En förfalskad eller
 * trasig rapport ska avvisas, inte larma och inte tystna: ett avvisat värde
 * betyder att mätvärden saknas, vilket i sin tur är en egen incident.
 */

export class AgentReportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AgentReportError";
    this.code = code;
  }
}

/** Mätvärden en agent får rapportera. Allt annat avvisas. */
export const ALLOWED_METRICS = [
  "cpu_percent",
  "memory_used_percent",
  "memory_available_bytes",
  "disk_used_percent",
  "disk_available_bytes",
  "containers_running",
  "containers_unhealthy",
  "uptime_seconds",
];

/** Rimliga intervall. Speglar monitoring_metric_kinds i databasen. */
const RANGES = {
  cpu_percent: [0, 100],
  memory_used_percent: [0, 100],
  disk_used_percent: [0, 100],
  memory_available_bytes: [0, Number.MAX_SAFE_INTEGER],
  disk_available_bytes: [0, Number.MAX_SAFE_INTEGER],
  containers_running: [0, 10000],
  containers_unhealthy: [0, 10000],
  uptime_seconds: [0, 60 * 60 * 24 * 365 * 20],
};

/** Hur gammal en rapport får vara, och hur långt in i framtiden klockan får gå. */
export const MAX_REPORT_AGE_SECONDS = 600;
export const MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * Validerar en inkommande agentrapport.
 *
 * @param {object} report  rapporten som agenten skickade
 * @param {object} agent   den registrerade agenten (ur monitoring_agents)
 * @param {number} [now]
 * @returns {{ organization_id, node_id, agent_id, collected_at, samples: Array, containers: Array }}
 */
export function validateAgentReport(report, agent, now = Date.now()) {
  if (!agent) throw new AgentReportError("UNKNOWN_AGENT", "Agenten är inte registrerad");
  if (agent.is_enabled === false) throw new AgentReportError("AGENT_DISABLED", "Agenten är avstängd");
  if (agent.capabilities?.write === true) {
    throw new AgentReportError("WRITE_REFUSED", "En skrivande agent får inte rapportera");
  }
  if (!report || typeof report !== "object") throw new AgentReportError("BAD_REPORT", "Rapporten saknas");
  if (report.containers !== undefined && (!Array.isArray(report.containers) || report.containers.length > 200)) {
    throw new AgentReportError("BAD_CONTAINERS", "Containerinventeringen måste vara en fullständig lista med högst 200 poster");
  }

  // Agenten får bara rapportera för sin egen nod och sin egen organisation.
  // Det här är spärren mot en agent som försöker skriva i en annan kunds data.
  if (report.node_id && report.node_id !== agent.node_id) {
    throw new AgentReportError("WRONG_NODE", "Rapporten gäller en annan nod än agentens");
  }
  if (report.organization_id && report.organization_id !== agent.organization_id) {
    throw new AgentReportError("WRONG_ORGANIZATION", "Rapporten gäller en annan organisation än agentens");
  }

  const insamlad = Date.parse(report.collected_at ?? "");
  if (Number.isNaN(insamlad)) throw new AgentReportError("BAD_TIMESTAMP", "collected_at saknas eller går inte att tolka");
  if (insamlad > now + MAX_CLOCK_SKEW_SECONDS * 1000) {
    throw new AgentReportError("FUTURE_TIMESTAMP", "Rapporten är tidsstämplad i framtiden");
  }
  if (insamlad < now - MAX_REPORT_AGE_SECONDS * 1000) {
    throw new AgentReportError("STALE_REPORT", "Rapporten är för gammal för att beskriva nuläget");
  }

  const inkommande = report.metrics;
  if (!inkommande || typeof inkommande !== "object" || Array.isArray(inkommande)) {
    throw new AgentReportError("BAD_METRICS", "metrics saknas eller har fel form");
  }

  const samples = [];
  for (const [key, raw] of Object.entries(inkommande)) {
    if (key.startsWith("containers_") && !Array.isArray(report.containers)) throw new AgentReportError("BAD_CONTAINERS", "Containersiffror kräver en faktisk inventering");
    if (!ALLOWED_METRICS.includes(key)) {
      throw new AgentReportError("UNKNOWN_METRIC", `Mätvärdet ${key} ingår inte i agentkontraktet`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new AgentReportError("BAD_VALUE", `Mätvärdet ${key} är inte ett tal`);
    }
    const [lagsta, hogsta] = RANGES[key];
    if (value < lagsta || value > hogsta) {
      // Ett omöjligt värde är en trasig insamling, inte en extrem mätning.
      throw new AgentReportError("VALUE_OUT_OF_RANGE", `Mätvärdet ${key} = ${value} ligger utanför det möjliga`);
    }
    samples.push({
      organization_id: agent.organization_id,
      node_id: agent.node_id,
      service_id: null,
      metric_key: key,
      value,
      collected_at: new Date(insamlad).toISOString(),
      source: "agent",
      agent_id: agent.id,
      detail: {},
    });
  }

  if (samples.length === 0) throw new AgentReportError("EMPTY_REPORT", "Rapporten innehåller inga mätvärden");

  return {
    organization_id: agent.organization_id,
    node_id: agent.node_id,
    agent_id: agent.id,
    collected_at: new Date(insamlad).toISOString(),
    samples,
    containers: normalizeContainers(report.containers),
  };
}

/**
 * Containerlistan. Endast namn, läge och hälsa – aldrig miljövariabler,
 * kommandon eller monteringar, som kan innehålla hemligheter.
 */
export function normalizeContainers(containers) {
  if (!Array.isArray(containers)) return [];
  return containers.slice(0, 200).map((c) => ({
    name: String(c?.name ?? "").slice(0, 120),
    state: ["running", "exited", "restarting", "paused", "created", "dead"].includes(c?.state) ? c.state : "unknown",
    health: ["healthy", "unhealthy", "starting", "none"].includes(c?.health) ? c.health : "none",
  }));
}

/**
 * Härleder containermätvärdena ur listan, i stället för att lita på att agenten
 * räknat rätt. Två källor för samma siffra är en källa för mycket.
 */
export function containerMetrics(containers) {
  const lista = normalizeContainers(containers);
  return {
    containers_running: lista.filter((c) => c.state === "running").length,
    containers_unhealthy: lista.filter((c) => c.state === "running" && c.health === "unhealthy").length,
  };
}

/**
 * Vad agenten behöver för att få rapportera. Används av dokumentationen och av
 * gränssnittet, så att kraven står på ett ställe.
 */
export const AGENT_REQUIREMENTS = [
  { key: "node", label: "En registrerad nod i systemregistret", secret: false },
  { key: "agent", label: "En registrerad agent för just den noden", secret: false },
  { key: "token", label: "Agentens egen nyckel i serverns secret store", secret: true },
  { key: "socket", label: "Serverlokal collector med API-begränsad Docker-läsning; en :ro-mount räcker inte som behörighetsspärr", secret: false },
];
