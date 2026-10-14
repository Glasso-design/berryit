/*
 * Infrastructure Monitoring – delat kontrakt.
 *
 * Används av desktopklienten, motorn och testerna. Statusorden är det viktigaste
 * här: skillnaden mellan "fungerar", "vet inte" och "inte ansluten" är hela
 * poängen med en övervakningsvy. Ett system som visar grönt när det inte vet är
 * värre än inget system alls.
 */

export const HEALTH_STATES = [
  "online",
  "warning",
  "critical",
  "offline",
  "stale",
  "unknown",
  "not_connected",
] as const;

export type HealthState = (typeof HEALTH_STATES)[number];

export const METRIC_KEYS = [
  "cpu_percent",
  "memory_used_percent",
  "memory_available_bytes",
  "disk_used_percent",
  "disk_available_bytes",
  "response_time_ms",
  "containers_running",
  "containers_unhealthy",
  "uptime_seconds",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricKind = {
  key: string;
  label: string;
  unit: string;
  direction: "above" | "below";
  min_value: number | null;
  max_value: number | null;
};

export type MonitoringSample = {
  id: string;
  organization_id: string;
  node_id: string | null;
  service_id: string | null;
  metric_key: string;
  value: number;
  collected_at: string;
  source: string;
  detail: Record<string, unknown>;
};

export type MonitoringThreshold = {
  id: string;
  organization_id: string;
  metric_key: string;
  scope_kind: "organization" | "node" | "service";
  node_id: string | null;
  service_id: string | null;
  warning_value: number | null;
  critical_value: number | null;
  consecutive_breaches: number;
  recovery_samples: number;
  stale_after_seconds: number;
  is_enabled: boolean;
};

export type Incident = {
  id: string;
  organization_id: string;
  node_id: string | null;
  service_id: string | null;
  project_id: string | null;
  metric_key: string | null;
  incident_key: string | null;
  group_key: string | null;
  title: string;
  summary: string;
  severity: "critical" | "major" | "minor" | "info";
  status: "open" | "monitoring" | "resolved";
  detected_by: string;
  opened_at: string;
  last_seen_at: string | null;
  observation_count: number;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolved_reason: string | null;
};

export type IncidentEvent = {
  id: string;
  incident_id: string;
  event_type: "opened" | "observed" | "escalated" | "acknowledged" | "resolved" | "reopened" | "note";
  actor_kind: "monitoring" | "user" | "system";
  detail: Record<string, unknown>;
  created_at: string;
};

/* ------------------------------------------------------------ presentation */

export function healthLabel(state: HealthState): string {
  switch (state) {
    case "online":
      return "Fungerar";
    case "warning":
      return "Varning";
    case "critical":
      return "Kritiskt";
    case "offline":
      return "Nere";
    case "stale":
      return "Föråldrad mätning";
    case "not_connected":
      return "Ej ansluten";
    default:
      return "Okänd";
  }
}

/**
 * Färgtoken per läge. Bara tre färger används: BERRYiT-rött för det som är
 * trasigt, signalfärgen för det som fungerar, dämpad text för allt vi inte vet.
 * Att måla "okänd" i grönt eller gult vore att påstå något.
 */
export function healthTone(state: HealthState): "ok" | "warn" | "bad" | "muted" {
  switch (state) {
    case "online":
      return "ok";
    case "warning":
      return "warn";
    case "critical":
    case "offline":
      return "bad";
    default:
      return "muted";
  }
}

export function severityLabel(severity: Incident["severity"]): string {
  return { critical: "Kritisk", major: "Allvarlig", minor: "Mindre", info: "Information" }[severity] ?? severity;
}

/** Formaterar ett mätvärde med sin enhet. Byte blir läsbara storheter. */
export function formatMetric(value: number, unit: string): string {
  if (unit === "procent") return `${Math.round(value * 10) / 10} %`;
  if (unit === "ms") return `${Math.round(value)} ms`;
  if (unit === "antal") return String(Math.round(value));
  if (unit === "sekunder") {
    const timmar = Math.floor(value / 3600);
    if (timmar < 24) return `${timmar} h`;
    return `${Math.floor(timmar / 24)} dygn`;
  }
  if (unit === "byte") {
    const enheter = ["B", "kB", "MB", "GB", "TB"];
    let v = value;
    let i = 0;
    while (v >= 1024 && i < enheter.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${Math.round(v * 10) / 10} ${enheter[i]}`;
  }
  return String(value);
}

/* --------------------------------------------------------------- härledning */

/** Senaste mätvärdet per metric_key, ur en lista i fallande tidsordning. */
export function latestPerMetric(samples: MonitoringSample[]): Map<string, MonitoringSample> {
  const senaste = new Map<string, MonitoringSample>();
  for (const s of samples) if (!senaste.has(s.metric_key)) senaste.set(s.metric_key, s);
  return senaste;
}

export function isStaleSample(sample: MonitoringSample | undefined, staleAfterSeconds = 900, now = Date.now()): boolean {
  if (!sample) return true;
  const t = Date.parse(sample.collected_at);
  if (Number.isNaN(t)) return true;
  return now - t > staleAfterSeconds * 1000;
}

/**
 * Hälsan för ett mål, härledd ur de mätvärden som faktiskt finns.
 *
 * Ordningen är medveten och ska inte ändras utan eftertanke: saknad koppling,
 * sedan konstaterat nere, sedan föråldrad data, sedan okänt. Först därefter
 * bedöms värdena. Allt annat skulle kunna visa "fungerar" på gammal data.
 */
export function deriveHealth({
  hasIntegration,
  reachable,
  samples,
  thresholds,
  kinds,
  staleAfterSeconds = 900,
  now = Date.now(),
}: {
  hasIntegration: boolean;
  reachable: boolean | null;
  samples: MonitoringSample[];
  thresholds: MonitoringThreshold[];
  kinds: Record<string, MetricKind>;
  staleAfterSeconds?: number;
  now?: number;
}): { state: HealthState; worstMetric: string | null } {
  if (!hasIntegration) return { state: "not_connected", worstMetric: null };
  if (reachable === false) return { state: "offline", worstMetric: null };

  const senaste = latestPerMetric(samples);
  if (senaste.size === 0) return { state: "unknown", worstMetric: null };

  const nagotFarskt = [...senaste.values()].some((s) => !isStaleSample(s, staleAfterSeconds, now));
  if (!nagotFarskt) return { state: "stale", worstMetric: null };

  // Kritiskt returnerar direkt nedan, så den här variabeln kan bara nå
  // "warning" – ingen jämförelse mot "critical" behövs.
  let varsta: HealthState = reachable === true ? "online" : "unknown";
  let varstMatt: string | null = null;

  for (const threshold of thresholds) {
    if (!threshold.is_enabled) continue;
    const sample = senaste.get(threshold.metric_key);
    if (!sample || isStaleSample(sample, staleAfterSeconds, now)) continue;
    const direction = kinds[threshold.metric_key]?.direction ?? "above";
    const over = (limit: number | null) =>
      limit !== null && (direction === "below" ? sample.value < limit : sample.value > limit);

    if (over(threshold.critical_value)) {
      return { state: "critical", worstMetric: threshold.metric_key };
    }
    if (over(threshold.warning_value)) {
      varsta = "warning";
      varstMatt = threshold.metric_key;
    }
  }

  return { state: varsta, worstMetric: varstMatt };
}

/** Räknar antal mål per läge, utan att slå ihop dem. */
export function summarizeHealth(states: HealthState[]): Record<HealthState, number> {
  const ut = {
    online: 0,
    warning: 0,
    critical: 0,
    offline: 0,
    stale: 0,
    unknown: 0,
    not_connected: 0,
  } as Record<HealthState, number>;
  for (const s of states) if (s in ut) ut[s] += 1;
  return ut;
}

/* --------------------------------------------------------- API-kontrakt */

export const MONITORING_TABLE = {
  samples: "monitoring_samples",
  thresholds: "monitoring_thresholds",
  agents: "monitoring_agents",
  metricKinds: "monitoring_metric_kinds",
  incidents: "incidents",
  incidentEvents: "incident_events",
} as const;

export const MONITORING_SELECT = {
  sample: "id, organization_id, node_id, service_id, metric_key, value, collected_at, source, detail",
  threshold:
    "id, organization_id, metric_key, scope_kind, node_id, service_id, warning_value, critical_value, consecutive_breaches, recovery_samples, stale_after_seconds, is_enabled",
  metricKind: "key, label, unit, direction, min_value, max_value",
  incident:
    "id, organization_id, node_id, service_id, project_id, metric_key, incident_key, group_key, title, summary, severity, status, detected_by, opened_at, last_seen_at, observation_count, acknowledged_at, resolved_at, resolved_reason",
  incidentEvent: "id, incident_id, event_type, actor_kind, detail, created_at",
} as const;

export const MONITORING_LIMIT = {
  samples: 1000,
  incidents: 200,
  events: 100,
} as const;
