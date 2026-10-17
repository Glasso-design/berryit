// A reviewable candidate for the existing registry. No database client, network
// call, credentials or execution path. Resolve existing rows before PASS 2 import.
import { randomUUID } from "node:crypto";

export const CORE_EXPECTED_STOPPED = Object.freeze([
  ...["realtime", "edge-functions", "auth", "envoy", "storage", "meta", "pooler", "rest", "db", "studio", "imgproxy"].map(name => "onarly-staging-" + name),
  "onarly-desk-hbbs", "onarly-desk-hbbr",
  "community-bot-community-bot-1", "community-bot-community-db-1",
  ...["storage", "edge-functions", "pooler", "meta", "auth", "rest", "envoy", "db", "studio", "imgproxy"].map(name => "supabase-" + name),
  "realtime-dev.supabase-realtime",
]);

export function buildCorePilot({ organizationId, isInternal, actorId }) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(organizationId ?? "") || isInternal !== true) throw new Error("Pilot requires an existing, verified internal BerryIT organization");
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(actorId ?? "")) throw new Error("Pilot requires the existing authorized profile ID");
  const common = { organization_id: organizationId };
  const node = { ...common, id: randomUUID(), name: "core-node-01", hostname: "core-node-01", node_kind: "container_host", is_active: true, notes: "Draft pilot only. SSH, Docker access and credentials are never provided to Desktop." };
  const projects = ["FLIQS", "AuroraPark"].map(name => ({ ...common, id: randomUUID(), name, created_by: actorId, description: "Existing application; draft BerryIT integration, no product database connection." }));
  const definitions = [
    [0, "FLIQS web", "web", "production", "fliqs-app-1", "http://100.115.106.9:4174/healthz"],
    [0, "FLIQS bot", "container", "production", "fliqs-bot-bot-1", null],
    ...["web", "api", "rest", "auth", "db", "proxy"].map(name => [1, "AuroraPark " + name, name === "db" ? "database" : name === "web" ? "web" : "api", "staging", "aurorapark-staging-" + name, name === "web" ? "http://100.115.106.9:3401/api/health" : null]),
  ];
  const services = definitions.map(([project, name, service_kind, environment, , url]) => ({ ...common, id: randomUUID(), project_id: projects[project].id, node_id: node.id, name, service_kind, environment, url, is_active: true }));
  const integration = (display_name, scope_kind, target, connector_key, config) => ({ ...common, id: randomUUID(), created_by: actorId, display_name, scope_kind, ...target, connector_key, config, access_mode: "read_only", secret_ref: null, is_enabled: false, status: "not_configured" });
  const integrations = [
    integration("core-node Docker inventory", "node", { node_id: node.id }, "docker", { socket_path: "/var/run/docker.sock", expected_stopped_containers: [...CORE_EXPECTED_STOPPED] }),
    ...services.map((svc, n) => integration(svc.name, "service", { service_id: svc.id }, svc.url ? "http_health" : "docker", svc.url ? { url: svc.url, expect_status: 200 } : { socket_path: "/var/run/docker.sock", container_names: [definitions[n][4]] })),
  ];
  return { nodes: [node], projects, services, integrations, review: {
    state: "draft_not_applied", expected_stops: CORE_EXPECTED_STOPPED.length,
    owner_confirmation_required: true, reconcile_existing_registry_rows: true,
    docker_reader_required: "server-side sanitized reader; a :ro socket mount is not an API authorization boundary",
    all_other_stopped_containers: "not suppressed; require separate classification",
    automatic_commands: false,
  } };
}
