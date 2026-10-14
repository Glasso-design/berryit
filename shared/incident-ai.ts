/*
 * Kontrakt för "fråga ONARLY AI om den här incidenten".
 *
 * Inget skickas automatiskt. Modulen bygger ett paket av redan verifierade
 * uppgifter som en människa kan titta på och sedan välja att dela. Det är hela
 * poängen: användaren ska se exakt vad som lämnar systemet innan det gör det.
 *
 * Fyra regler:
 *
 *   1. Bara det användaren redan får se. Paketet byggs av rader som RLS
 *      lämnade ut – det hämtar ingenting extra och kringgår ingen behörighet.
 *   2. Bara verifierade mätvärden. Varje siffra bär källa och tidsstämpel, och
 *      föråldrade värden märks som föråldrade i stället för att tystas.
 *   3. Inga hemligheter, inga adresser inåt. Värdnamn, interna URL:er och
 *      secret_ref följer aldrig med.
 *   4. Ingen åtgärd. Paketet är underlag för en felsökning, inte en order.
 */
import type { HealthState, Incident, IncidentEvent, MetricKind, MonitoringSample } from "./monitoring";
import { formatMetric, isStaleSample, latestPerMetric } from "./monitoring";

export type IncidentAiMetric = {
  metric_key: string;
  label: string;
  value: number;
  formatted: string;
  collected_at: string;
  source: string;
  stale: boolean;
};

export type IncidentAiBundle = {
  /** Versionen gör det möjligt att ändra formatet utan att gissa i mottagaren. */
  contract_version: 1;
  incident: {
    id: string;
    title: string;
    summary: string;
    severity: Incident["severity"];
    status: Incident["status"];
    opened_at: string;
    last_seen_at: string | null;
    observation_count: number;
    detected_by: string;
  };
  context: {
    organization: string;
    project: string | null;
    node: string | null;
    service: string | null;
    health: HealthState;
  };
  metrics: IncidentAiMetric[];
  timeline: Array<{ event_type: string; actor_kind: string; created_at: string; note: string }>;
  errors: string[];
  /** Vad mottagaren INTE har fått, så att ett svar inte vilar på tyst saknad data. */
  omitted: string[];
};

/** Fält som aldrig får följa med ut till en extern mottagare. */
const NEVER_SHARE = ["hostname", "url", "secret_ref", "token", "ip", "socket_path", "config"];

/**
 * Bygger paketet. Rena data in, rena data ut – inga anrop, ingen överföring.
 *
 * `omitted` fylls medvetet: en mottagare som vet vad som saknas kan säga "jag
 * kan inte avgöra det här", vilket är ett bättre svar än en gissning.
 */
export function buildIncidentAiBundle({
  incident,
  events = [],
  samples = [],
  kinds = {},
  organizationName,
  projectName = null,
  nodeName = null,
  serviceName = null,
  health,
  now = Date.now(),
}: {
  incident: Incident;
  events?: IncidentEvent[];
  samples?: MonitoringSample[];
  kinds?: Record<string, MetricKind>;
  organizationName: string;
  projectName?: string | null;
  nodeName?: string | null;
  serviceName?: string | null;
  health: HealthState;
  now?: number;
}): IncidentAiBundle {
  const senaste = latestPerMetric(samples);
  const metrics: IncidentAiMetric[] = [...senaste.values()].map((s) => {
    const kind = kinds[s.metric_key];
    const stale = isStaleSample(s, 900, now);
    return {
      metric_key: s.metric_key,
      label: kind?.label ?? s.metric_key,
      value: Number(s.value),
      formatted: formatMetric(Number(s.value), kind?.unit ?? ""),
      collected_at: s.collected_at,
      source: s.source,
      stale,
    };
  });

  const omitted: string[] = [];
  if (metrics.length === 0) omitted.push("Inga mätvärden finns för målet.");
  if (metrics.some((m) => m.stale)) omitted.push("Några mätvärden är föråldrade och är märkta som sådana.");
  if (!nodeName && !serviceName) omitted.push("Incidenten är inte knuten till en namngiven server eller tjänst.");
  omitted.push("Värdnamn, adresser och nycklar ingår aldrig i underlaget.");

  const errors: string[] = [];
  for (const e of events) {
    const text = typeof e.detail?.error === "string" ? e.detail.error : null;
    if (text) errors.push(sanitize(text));
  }
  if (incident.summary) errors.unshift(sanitize(incident.summary));

  return {
    contract_version: 1,
    incident: {
      id: incident.id,
      title: sanitize(incident.title),
      summary: sanitize(incident.summary),
      severity: incident.severity,
      status: incident.status,
      opened_at: incident.opened_at,
      last_seen_at: incident.last_seen_at,
      observation_count: incident.observation_count,
      detected_by: incident.detected_by,
    },
    context: {
      organization: organizationName,
      project: projectName,
      node: nodeName,
      service: serviceName,
      health,
    },
    metrics,
    timeline: events.slice(0, 20).map((e) => ({
      event_type: e.event_type,
      actor_kind: e.actor_kind,
      created_at: e.created_at,
      note: sanitize(typeof e.detail?.summary === "string" ? e.detail.summary : ""),
    })),
    errors: [...new Set(errors)].filter(Boolean).slice(0, 10),
    omitted,
  };
}

/**
 * Tar bort det som inte ska lämna huset: nycklar, adresser och värdnamn som
 * kan ha letat sig in i ett felmeddelande.
 */
export function sanitize(text: string): string {
  let ut = String(text ?? "");
  ut = ut.replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[dold nyckel]");
  ut = ut.replace(/(gh[pousr]_|sk-|xox[baprs]-|AIza)[A-Za-z0-9_-]{10,}/g, "[dold nyckel]");
  ut = ut.replace(/https?:\/\/[^\s)]+/g, "[dold adress]");
  ut = ut.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "[dold adress]");
  ut = ut.replace(/\/var\/run\/[^\s]*\.sock/g, "[dold sökväg]");
  return ut.slice(0, 2000);
}

/** Kontrollerar att inget förbjudet fält följt med. Används av tester och UI. */
export function bundleLeaks(bundle: IncidentAiBundle): string[] {
  const text = JSON.stringify(bundle).toLowerCase();
  return NEVER_SHARE.filter((f) => text.includes(`"${f}"`));
}

/**
 * Ingen automatisk överföring: anropet kräver att användaren uttryckligen
 * bekräftat. Funktionen finns för att göra kravet synligt i koden i stället för
 * att bara stå i en kommentar.
 */
export function mayShareWithAi(bundle: IncidentAiBundle, userConfirmed: boolean): { ok: boolean; reason?: string } {
  if (!userConfirmed) return { ok: false, reason: "Användaren har inte bekräftat delningen." };
  const lackor = bundleLeaks(bundle);
  if (lackor.length > 0) return { ok: false, reason: `Underlaget innehåller fält som inte får delas: ${lackor.join(", ")}` };
  return { ok: true };
}
