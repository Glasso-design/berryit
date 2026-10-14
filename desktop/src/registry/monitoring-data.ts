/*
 * Läser övervakningsdata till desktopklienten.
 *
 * Som allt annat i appen går det genom PostgREST med användarens egen JWT.
 * Klienten kan inte skriva mätvärden, kan inte köra en connector och har varken
 * Docker-socket, SSH-nyckel eller service-role-nyckel. Den visar vad agenten
 * och motorn har mätt – ingenting annat.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MONITORING_LIMIT,
  MONITORING_SELECT,
  MONITORING_TABLE,
} from "@berryit/shared/monitoring";
import type {
  Incident,
  IncidentEvent,
  MetricKind,
  MonitoringSample,
  MonitoringThreshold,
} from "@berryit/shared/monitoring";

export type MonitoringData = {
  kinds: Record<string, MetricKind>;
  samples: MonitoringSample[];
  thresholds: MonitoringThreshold[];
  incidents: Incident[];
};

export const TOM_OVERVAKNING: MonitoringData = {
  kinds: {},
  samples: [],
  thresholds: [],
  incidents: [],
};

export async function loadMonitoring(supabase: SupabaseClient): Promise<MonitoringData> {
  const [kindRes, sampleRes, thresholdRes, incidentRes] = await Promise.all([
    supabase.from(MONITORING_TABLE.metricKinds).select(MONITORING_SELECT.metricKind).order("sort_order"),
    supabase
      .from(MONITORING_TABLE.samples)
      .select(MONITORING_SELECT.sample)
      .order("collected_at", { ascending: false })
      .limit(MONITORING_LIMIT.samples),
    supabase.from(MONITORING_TABLE.thresholds).select(MONITORING_SELECT.threshold),
    supabase
      .from(MONITORING_TABLE.incidents)
      .select(MONITORING_SELECT.incident)
      .order("opened_at", { ascending: false })
      .limit(MONITORING_LIMIT.incidents),
  ]);

  const kinds: Record<string, MetricKind> = {};
  for (const k of (kindRes.data ?? []) as MetricKind[]) kinds[k.key] = k;

  return {
    kinds,
    samples: (sampleRes.data ?? []) as MonitoringSample[],
    thresholds: (thresholdRes.data ?? []) as MonitoringThreshold[],
    incidents: (incidentRes.data ?? []) as Incident[],
  };
}

/** Händelser för en incident. Hämtas först när någon öppnar den. */
export async function loadIncidentEvents(supabase: SupabaseClient, incidentId: string): Promise<IncidentEvent[]> {
  const { data } = await supabase
    .from(MONITORING_TABLE.incidentEvents)
    .select(MONITORING_SELECT.incidentEvent)
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: false })
    .limit(MONITORING_LIMIT.events);
  return (data ?? []) as IncidentEvent[];
}
