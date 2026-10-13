/*
 * Connector Engine – gemensamt kontrakt.
 *
 * Delas av motorn (server), desktopklienten och testerna, så att alla tre har
 * samma uppfattning om vad en anslutning är och vad ett svar betyder.
 *
 * Två regler bär hela modellen:
 *
 *   1. En connector läser. Den startar inte om, deployar inte och skriver inte
 *      i någon annans databas. `ConnectorCapabilities.write` finns i typen men
 *      är alltid false i den här versionen – att öppna för skrivning är ett
 *      eget beslut med en egen migration.
 *
 *   2. Status utan avsändare och tidpunkt är en gissning. Varje resultat bär
 *      vilken connector som svarade och när, och "okänd" är ett giltigt och
 *      vanligt svar. Vi hittar aldrig på ett "fungerar".
 */

export const CONNECTOR_KEYS = [
  "docker",
  "github",
  "vercel",
  "onarly_ai",
  "onarly_desk",
  "http_health",
] as const;

export type ConnectorKey = (typeof CONNECTOR_KEYS)[number];

export const SERVICE_STATUS_KEYS = ["ok", "degraded", "down", "unknown"] as const;
export type ServiceStatus = (typeof SERVICE_STATUS_KEYS)[number];

/** Anslutningens läge, oberoende av vad den senast mätte. */
export const INTEGRATION_STATUS_KEYS = [
  "not_configured",
  "configured",
  "connected",
  "error",
  "disabled",
] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUS_KEYS)[number];

export type ScopeKind = "organization" | "project" | "node" | "service";

export type ConnectorCapabilities = {
  read: boolean;
  /** Alltid false i den här versionen. Finns för att göra läget uttryckligt. */
  write: boolean;
};

export const READ_ONLY: ConnectorCapabilities = { read: true, write: false };

/** Vad en integration behöver för att alls kunna användas. */
export type ConnectorRequirement = {
  /** Nyckel i config-objektet, t.ex. "repository" eller "url". */
  key: string;
  label: string;
  /** Sant när värdet är en hemlighet och alltså ska ligga i serverns store. */
  secret: boolean;
};

export type ConnectorDefinition = {
  key: ConnectorKey;
  label: string;
  description: string;
  capabilities: ConnectorCapabilities;
  /** Scope-nivåer connectorn är meningsfull på. */
  scopes: ScopeKind[];
  requirements: ConnectorRequirement[];
  /** Kort beskrivning av vilken identitet connectorn ska använda. */
  identity: string;
};

/*
 * Katalogen. Texterna beskriver vad som krävs för att en anslutning ska
 * fungera – samma princip som "ej ansluten"-rutorna: säg rakt ut vad som
 * saknas i stället för att visa en tom yta.
 */
export const CONNECTORS: Record<ConnectorKey, ConnectorDefinition> = {
  docker: {
    key: "docker",
    label: "Docker och serverövervakning",
    description: "Containrar, hälsa och resursläge på en nod.",
    capabilities: READ_ONLY,
    scopes: ["node"],
    requirements: [
      { key: "socket_path", label: "Sökväg till Docker-socket på servern", secret: false },
      { key: "name_prefix", label: "Containerprefix som får läsas", secret: false },
    ],
    identity:
      "Läsbehörighet till Docker-socketen på just den noden, monterad read-only i motorn. Socketen når aldrig Windows-appen.",
  },
  github: {
    key: "github",
    label: "GitHub",
    description: "Repositorier, senaste commit och byggstatus.",
    capabilities: READ_ONLY,
    scopes: ["project", "service"],
    requirements: [
      { key: "repository", label: "Repositorium (ägare/namn)", secret: false },
      { key: "token", label: "Läsbehörig token", secret: true },
    ],
    identity: "Egen fine-grained token med enbart läsrätt på de repositorier som anges.",
  },
  vercel: {
    key: "vercel",
    label: "Vercel",
    description: "Deployments och domänstatus för webbprojekt.",
    capabilities: READ_ONLY,
    scopes: ["project", "service"],
    requirements: [
      { key: "project_id", label: "Vercel-projektets id", secret: false },
      { key: "team_id", label: "Team-id (om projektet ligger i ett team)", secret: false },
      { key: "token", label: "Läsbehörig token", secret: true },
    ],
    identity: "Egen token med read-scope på det enskilda projektet.",
  },
  onarly_ai: {
    key: "onarly_ai",
    label: "ONARLY AI Gateway",
    description: "Hälsa och modellstatus via BERRYiT:s egen adapter.",
    capabilities: READ_ONLY,
    scopes: ["organization", "service"],
    requirements: [{ key: "base_url", label: "Adapterns adress (t.ex. /ai/v1)", secret: false }],
    identity:
      "Går genom BERRYiT:s egen AI-adapter, som i sin tur håller gateway-token server-side. Motorn ser aldrig ONARLY:s nyckel.",
  },
  onarly_desk: {
    key: "onarly_desk",
    label: "ONARLY DESK",
    description: "Fjärrsupportens tillgänglighet och rättighetsläge.",
    capabilities: READ_ONLY,
    scopes: ["organization"],
    requirements: [
      { key: "base_url", label: "DESK:s status-URL", secret: false },
      { key: "token", label: "Läsbehörig token", secret: true },
    ],
    identity:
      "Egen läsidentitet mot DESK. Rättigheter per kund styrs av onarly_support_entitlements i BERRYiT, inte av connectorn.",
  },
  http_health: {
    key: "http_health",
    label: "Webbplats och API-hälsa",
    description: "HTTP-kontroll av en publik eller intern adress.",
    capabilities: READ_ONLY,
    scopes: ["service"],
    requirements: [
      { key: "url", label: "Adress att kontrollera", secret: false },
      { key: "expect_status", label: "Förväntad statuskod (standard 200)", secret: false },
    ],
    identity: "Ingen. Anropet är anonymt och gör bara GET mot den angivna adressen.",
  },
};

export function connectorDefinition(key: string): ConnectorDefinition | null {
  return (CONNECTORS as Record<string, ConnectorDefinition>)[key] ?? null;
}

/** Krav som måste ligga i serverns secret store, inte i config. */
export function secretRequirements(key: ConnectorKey): ConnectorRequirement[] {
  return CONNECTORS[key].requirements.filter((r) => r.secret);
}

/*
 * Resultatet av en kontroll. `status: "unknown"` med en förklaring är ett
 * fullgott svar – det är så en connector säger "jag vet inte", vilket är
 * sanningen när den inte är konfigurerad eller inte svarar.
 */
export type ConnectorResult = {
  connector: ConnectorKey;
  status: ServiceStatus;
  checkedAt: string;
  latencyMs: number | null;
  /** Kort, läsbar sammanfattning. Visas som den är i gränssnittet. */
  summary: string;
  /** Strukturerade detaljer utan hemligheter. */
  detail: Record<string, unknown>;
  error: ConnectorErrorShape | null;
};

export type ConnectorErrorCode =
  | "NOT_CONFIGURED"
  | "MISSING_SECRET"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "TIMEOUT"
  | "UNREACHABLE"
  | "BAD_RESPONSE"
  | "WRITE_REFUSED"
  | "INTERNAL";

export type ConnectorErrorShape = {
  code: ConnectorErrorCode;
  message: string;
};

/** Översätter ett resultat till den status en människa ska se. */
export function statusLabel(status: ServiceStatus): string {
  switch (status) {
    case "ok":
      return "Fungerar";
    case "degraded":
      return "Försämrad";
    case "down":
      return "Nere";
    default:
      return "Okänd";
  }
}

export function integrationStatusLabel(status: IntegrationStatus): string {
  switch (status) {
    case "connected":
      return "Ansluten";
    case "configured":
      return "Konfigurerad, inte verifierad";
    case "error":
      return "Fel vid senaste kontroll";
    case "disabled":
      return "Avstängd";
    default:
      return "Ej ansluten";
  }
}

/** Sant endast när anslutningen är verifierad – aldrig på gissning. */
export function isConnected(status: IntegrationStatus): boolean {
  return status === "connected";
}

/**
 * Hur gammal får en mätning vara innan den inte längre beskriver nuläget?
 * Gränsen finns för att slippa visa gårdagens "fungerar" som om den vore färsk.
 */
export const STATUS_FRESHNESS_SECONDS = 15 * 60;

export function isStale(checkedAt: string | null, now = Date.now()): boolean {
  if (!checkedAt) return true;
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return true;
  return now - t > STATUS_FRESHNESS_SECONDS * 1000;
}

/** Text för hur länge sedan något kontrollerades. Tom sträng om aldrig. */
export function lastCheckedLabel(checkedAt: string | null, now = Date.now()): string {
  if (!checkedAt) return "aldrig kontrollerad";
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return "okänd tidpunkt";
  const sekunder = Math.max(0, Math.round((now - t) / 1000));
  if (sekunder < 60) return "kontrollerad nyss";
  const minuter = Math.round(sekunder / 60);
  if (minuter < 60) return `kontrollerad för ${minuter} min sedan`;
  const timmar = Math.round(minuter / 60);
  if (timmar < 24) return `kontrollerad för ${timmar} h sedan`;
  return `kontrollerad för ${Math.round(timmar / 24)} dygn sedan`;
}

/* ------------------------------------------------------------ registertyper */

export type Organization = { id: string; name: string; is_internal: boolean };

export type Project = {
  id: string;
  organization_id: string;
  name: string;
  description: string;
  repository_url: string | null;
};

export type Node = {
  id: string;
  organization_id: string;
  name: string;
  hostname: string | null;
  provider: string | null;
  region: string | null;
  node_kind: string;
  is_active: boolean;
};

export type Service = {
  id: string;
  organization_id: string;
  project_id: string;
  node_id: string | null;
  name: string;
  service_kind: string;
  url: string | null;
  environment: string;
  is_active: boolean;
};

export type Integration = {
  id: string;
  organization_id: string;
  connector_key: string;
  display_name: string;
  scope_kind: ScopeKind;
  project_id: string | null;
  node_id: string | null;
  service_id: string | null;
  config: Record<string, unknown>;
  secret_ref: string | null;
  access_mode: string;
  is_enabled: boolean;
  status: IntegrationStatus;
  last_checked_at: string | null;
  last_error: string | null;
};

export type StatusCheck = {
  id: string;
  organization_id: string;
  service_id: string | null;
  node_id: string | null;
  status_key: ServiceStatus;
  checked_at: string;
  latency_ms: number | null;
  source: string;
  detail: Record<string, unknown>;
};

/* ------------------------------------------------------------ API-kontrakt */

export const REGISTRY_TABLE = {
  organizations: "organizations",
  projects: "support_projects",
  nodes: "infra_nodes",
  services: "infra_services",
  integrations: "connector_integrations",
  statusChecks: "service_status_checks",
  incidents: "incidents",
  activity: "connector_activity_log",
  connectorKinds: "connector_kinds",
} as const;

export const REGISTRY_SELECT = {
  organization: "id, name, is_internal",
  project: "id, organization_id, name, description, repository_url",
  node: "id, organization_id, name, hostname, provider, region, node_kind, is_active",
  service: "id, organization_id, project_id, node_id, name, service_kind, url, environment, is_active",
  integration:
    "id, organization_id, connector_key, display_name, scope_kind, project_id, node_id, service_id, config, secret_ref, access_mode, is_enabled, status, last_checked_at, last_error",
  statusCheck: "id, organization_id, service_id, node_id, status_key, checked_at, latency_ms, source, detail",
  incident: "id, organization_id, project_id, service_id, title, summary, severity, status, opened_at, resolved_at",
} as const;

export const REGISTRY_LIMIT = {
  projects: 200,
  nodes: 200,
  services: 500,
  integrations: 200,
  statusChecks: 500,
  incidents: 100,
} as const;

/** Senaste mätningen per tjänst respektive nod, ur en lista i fallande tidsordning. */
export function latestStatusByTarget(checks: StatusCheck[]): {
  services: Map<string, StatusCheck>;
  nodes: Map<string, StatusCheck>;
} {
  const services = new Map<string, StatusCheck>();
  const nodes = new Map<string, StatusCheck>();
  for (const check of checks) {
    if (check.service_id && !services.has(check.service_id)) services.set(check.service_id, check);
    if (check.node_id && !nodes.has(check.node_id)) nodes.set(check.node_id, check);
  }
  return { services, nodes };
}

/** Delar upp projekt i egna och kunders, utifrån organisationen. */
export function splitProjects<T extends { organization_id: string }>(
  projects: T[],
  organizations: Organization[],
): { interna: T[]; kund: T[] } {
  const internaOrg = new Set(organizations.filter((o) => o.is_internal).map((o) => o.id));
  return {
    interna: projects.filter((p) => internaOrg.has(p.organization_id)),
    kund: projects.filter((p) => !internaOrg.has(p.organization_id)),
  };
}
