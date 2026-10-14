/*
 * Incident Engine V1 – omsätter besluten från monitoring.mjs till rader.
 *
 * Motorn öppnar, observerar och stänger incidenter. Den startar aldrig om
 * något, deployar inte och reparerar inte – den konstaterar. Varje steg skrivs
 * i incident_events, så att det i efterhand går att se vad som hände och när.
 *
 * Det finns en sak den medvetet inte kan göra: stänga en incident för att
 * mätvärdena slutade komma. Databasen kräver ett skäl vid stängning, och
 * "saknad data" är inte ett av dem.
 */
import { SEVERITY } from "./monitoring.mjs";

const ALLOWED_RESOLVE_REASONS = ["recovered", "manual", "superseded"];

export class IncidentEngine {
  /**
   * @param {object} options
   * @param {object} options.store  läs/skriv mot registret (createRestStore)
   * @param {Function} [options.clock]
   */
  constructor({ store, clock = () => new Date() }) {
    if (!store) throw new Error("IncidentEngine kräver en store");
    this.store = store;
    this.clock = clock;
  }

  /**
   * Verkställer besluten för en organisation.
   * Returnerar en sammanfattning: vad som öppnades, observerades och stängdes.
   */
  async apply(organizationId, beslut) {
    const nu = this.clock().toISOString();
    const resultat = { opened: [], observed: [], resolved: [], refused: [] };

    for (const d of beslut) {
      if (d.action === "open") {
        const incident = await this.store.openIncident({
          organization_id: organizationId,
          node_id: d.nodeId ?? null,
          service_id: d.serviceId ?? null,
          metric_key: d.metricKey ?? null,
          incident_key: d.incidentKey,
          group_key: d.groupKey,
          title: d.title,
          summary: d.summary,
          severity: severityFor(d.severity),
          status: "open",
          source: "monitoring",
          detected_by: "monitoring",
          opened_at: nu,
          first_seen_at: nu,
          last_seen_at: nu,
          observation_count: 1,
        });
        await this.store.recordIncidentEvent({
          organization_id: organizationId,
          incident_id: incident?.id ?? null,
          event_type: "opened",
          actor_kind: "monitoring",
          detail: d.detail ?? {},
        });
        resultat.opened.push({ incident_key: d.incidentKey, id: incident?.id ?? null });
        continue;
      }

      if (d.action === "observe") {
        // Samma fel igen räknas upp på den befintliga incidenten. En ny rad
        // hade bara gjort larmlistan oläsbar.
        const nyNiva = severityFor(d.severity);
        const eskalerar = rank(nyNiva) > rank(d.incident.severity);
        await this.store.touchIncident(d.incident.id, {
          last_seen_at: nu,
          observation_count: (d.incident.observation_count ?? 1) + 1,
          ...(eskalerar ? { severity: nyNiva } : {}),
        });
        await this.store.recordIncidentEvent({
          organization_id: organizationId,
          incident_id: d.incident.id,
          event_type: eskalerar ? "escalated" : "observed",
          actor_kind: "monitoring",
          detail: d.detail ?? {},
        });
        resultat.observed.push({ incident_key: d.incidentKey, id: d.incident.id, escalated: eskalerar });
        continue;
      }

      if (d.action === "resolve") {
        if (!ALLOWED_RESOLVE_REASONS.includes(d.reason)) {
          // Skyddet finns både här och i databasen. Att övervakningen tystnar
          // får aldrig se ut som att felet gick över.
          resultat.refused.push({ incident_key: d.incidentKey, reason: d.reason ?? null });
          continue;
        }
        await this.store.resolveIncident(d.incident.id, {
          status: "resolved",
          resolved_at: nu,
          resolved_reason: d.reason,
          last_seen_at: nu,
        });
        await this.store.recordIncidentEvent({
          organization_id: organizationId,
          incident_id: d.incident.id,
          event_type: "resolved",
          actor_kind: "monitoring",
          detail: { ...(d.detail ?? {}), reason: d.reason },
        });
        resultat.resolved.push({ incident_key: d.incidentKey, id: d.incident.id, reason: d.reason });
      }
    }

    return resultat;
  }
}

function severityFor(niva) {
  if (niva === "critical") return SEVERITY.critical;
  if (niva === "warning") return SEVERITY.warning;
  return SEVERITY.info;
}

function rank(severity) {
  return { critical: 3, major: 2, minor: 1, info: 0 }[severity] ?? 0;
}

/** Grupperar incidenter för visning: ett avbrott, inte sju larm. */
export function groupIncidents(incidents) {
  const grupper = new Map();
  for (const incident of incidents) {
    const nyckel = incident.group_key ?? `incident:${incident.id}`;
    if (!grupper.has(nyckel)) grupper.set(nyckel, []);
    grupper.get(nyckel).push(incident);
  }
  return [...grupper.entries()].map(([key, items]) => ({
    group_key: key,
    severity: items.map((i) => i.severity).sort((a, b) => rank(b) - rank(a))[0],
    count: items.length,
    opened_at: items.map((i) => i.opened_at).sort()[0],
    incidents: items,
  }));
}
