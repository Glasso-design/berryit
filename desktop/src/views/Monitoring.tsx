import { useEffect, useMemo, useState } from "react";
import { Icon } from "@berryit/shared/ui/Icon";
import {
  deriveHealth,
  formatMetric,
  healthLabel,
  healthTone,
  isStaleSample,
  latestPerMetric,
  severityLabel,
  summarizeHealth,
} from "@berryit/shared/monitoring";
import type { HealthState, Incident, MonitoringSample } from "@berryit/shared/monitoring";
import { buildIncidentAiBundle, mayShareWithAi } from "@berryit/shared/incident-ai";
import { lastCheckedLabel } from "@berryit/shared/connectors";
import { useSession } from "@/auth/session";
import { loadRegistry, TOM_REGISTERDATA, type RegistryData } from "@/registry/data";
import { loadMonitoring, TOM_OVERVAKNING, type MonitoringData } from "@/registry/monitoring-data";

/**
 * Infrastructure Monitoring.
 *
 * Vyn visar bara det som faktiskt har mätts. Sju lägen hålls isär – fungerar,
 * varning, kritiskt, nere, föråldrad mätning, okänt och ej ansluten – för att
 * "jag vet inte" aldrig ska se ut som "allt är bra".
 */
export function Monitoring() {
  const { supabase } = useSession();
  const [registret, setRegistret] = useState<RegistryData>(TOM_REGISTERDATA);
  const [matdata, setMatdata] = useState<MonitoringData>(TOM_OVERVAKNING);
  const [laddar, setLaddar] = useState(true);
  const [fel, setFel] = useState<string | null>(null);
  const [valdIncident, setValdIncident] = useState<Incident | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let avbruten = false;
    Promise.all([loadRegistry(supabase), loadMonitoring(supabase)])
      .then(([r, m]) => {
        if (avbruten) return;
        setRegistret(r);
        setMatdata(m);
      })
      .catch((e: unknown) => {
        if (!avbruten) setFel(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!avbruten) setLaddar(false);
      });
    return () => {
      avbruten = true;
    };
  }, [supabase]);

  const orgNamn = useMemo(
    () => new Map(registret.organizations.map((o) => [o.id, o.name])),
    [registret.organizations],
  );

  // Hälsan per nod härleds ur mätvärdena, inte ur ett sparat statusfält. Ett
  // sparat fält hade kunnat bli gammalt utan att någon märkte det.
  const nodHalsa = useMemo(() => {
    const karta = new Map<string, { state: HealthState; worstMetric: string | null; samples: MonitoringSample[] }>();
    for (const nod of registret.nodes) {
      const samples = matdata.samples.filter((s) => s.node_id === nod.id);
      const thresholds = matdata.thresholds.filter(
        (t) => t.scope_kind === "organization" || t.node_id === nod.id,
      );
      const senasteStatus = registret.latest.nodes.get(nod.id) ?? null;
      const reachable =
        senasteStatus === null ? null : senasteStatus.status_key === "down" ? false : senasteStatus.status_key === "ok";
      const harIntegration = (registret.integrations ?? []).some((i) => i.node_id === nod.id) || samples.length > 0;
      karta.set(nod.id, {
        ...deriveHealth({
          hasIntegration: harIntegration,
          reachable,
          samples,
          thresholds,
          kinds: matdata.kinds,
        }),
        samples,
      });
    }
    return karta;
  }, [registret, matdata]);

  const tjanstHalsa = useMemo(() => {
    const karta = new Map<string, HealthState>();
    for (const tjanst of registret.services) {
      const senaste = registret.latest.services.get(tjanst.id) ?? null;
      const samples = matdata.samples.filter((s) => s.service_id === tjanst.id);
      const harIntegration = (registret.integrations ?? []).some((i) => i.service_id === tjanst.id) || senaste !== null;
      const reachable = senaste === null ? null : senaste.status_key === "down" ? false : senaste.status_key === "ok";
      karta.set(
        tjanst.id,
        deriveHealth({
          hasIntegration: harIntegration,
          reachable,
          samples,
          thresholds: matdata.thresholds.filter((t) => t.scope_kind === "organization" || t.service_id === tjanst.id),
          kinds: matdata.kinds,
        }).state,
      );
    }
    return karta;
  }, [registret, matdata]);

  const sammanfattning = summarizeHealth([
    ...[...nodHalsa.values()].map((h) => h.state),
    ...[...tjanstHalsa.values()],
  ]);

  const aktiva = matdata.incidents.filter((i) => i.status !== "resolved");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Monitoring</h1>
        <p className="mt-2 text-muted">
          Driftläget för servrar och tjänster, härlett ur faktiska mätvärden. Allt som inte är mätt
          står som okänt – aldrig som fungerande.
        </p>
      </header>

      {fel && (
        <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
          Kunde inte läsa övervakningsdata: {fel}
        </p>
      )}

      {laddar ? (
        <p className="text-sm text-muted">Hämtar mätvärden…</p>
      ) : (
        <>
          <Sammanfattning data={sammanfattning} />

          <section>
            <h2 className="font-display text-lg font-semibold">Aktiva incidenter</h2>
            {aktiva.length === 0 ? (
              <p className="mt-3 rounded-2xl border border-line bg-ink-2 px-5 py-6 text-sm text-muted">
                Inga öppna incidenter.{" "}
                {matdata.samples.length === 0
                  ? "Observera att det inte finns några mätvärden alls ännu – det är inte samma sak som att allt fungerar."
                  : ""}
              </p>
            ) : (
              <ul className="mt-4 space-y-2">
                {aktiva.map((incident) => (
                  <IncidentRad
                    key={incident.id}
                    incident={incident}
                    registret={registret}
                    orgNamn={orgNamn}
                    onValj={() => setValdIncident(incident)}
                    vald={valdIncident?.id === incident.id}
                  />
                ))}
              </ul>
            )}
          </section>

          {valdIncident && (
            <AiUnderlag
              incident={valdIncident}
              registret={registret}
              matdata={matdata}
              halsa={
                valdIncident.node_id
                  ? (nodHalsa.get(valdIncident.node_id)?.state ?? "unknown")
                  : (tjanstHalsa.get(valdIncident.service_id ?? "") ?? "unknown")
              }
              orgNamn={orgNamn}
              onStang={() => setValdIncident(null)}
            />
          )}

          <section>
            <h2 className="font-display text-lg font-semibold">Servrar</h2>
            {registret.nodes.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Inga servrar registrerade.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {registret.nodes.map((nod) => {
                  const halsa = nodHalsa.get(nod.id);
                  const senaste = latestPerMetric(halsa?.samples ?? []);
                  return (
                    <li key={nod.id} className="rounded-2xl border border-line bg-ink-2 p-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <Icon name="install" className="h-4 w-4 text-muted" />
                        <h3 className="font-display text-base font-semibold">{nod.name}</h3>
                        <span className="text-xs text-muted">{orgNamn.get(nod.organization_id) ?? "okänd"}</span>
                        <span className="ml-auto">
                          <HalsoMarke state={halsa?.state ?? "unknown"} />
                        </span>
                      </div>

                      {senaste.size === 0 ? (
                        <p className="mt-3 text-xs text-muted">
                          Inga mätvärden. En läsande agent måste registreras för noden.
                        </p>
                      ) : (
                        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {[...senaste.values()].map((s) => (
                            <MatvardesRuta key={s.metric_key} sample={s} enhet={matdata.kinds[s.metric_key]?.unit ?? ""} etikett={matdata.kinds[s.metric_key]?.label ?? s.metric_key} />
                          ))}
                        </ul>
                      )}

                      <TjansterPaNod nod={nod.id} registret={registret} halsa={tjanstHalsa} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Sammanfattning({ data }: { data: Record<HealthState, number> }) {
  const ordning: HealthState[] = ["online", "warning", "critical", "offline", "stale", "unknown", "not_connected"];
  return (
    <section aria-labelledby="sammanfattning">
      <h2 id="sammanfattning" className="font-display text-lg font-semibold">
        Driftstatus
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ordning.map((state) => (
          <li key={state} className="rounded-2xl border border-line bg-ink-2 p-4">
            <p className="text-sm text-muted">{healthLabel(state)}</p>
            <p className={`mt-1 font-display text-2xl font-bold tracking-tight ${toneClass(healthTone(state))}`}>
              {data[state]}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function toneClass(tone: "ok" | "warn" | "bad" | "muted"): string {
  if (tone === "ok") return "text-signal";
  if (tone === "warn") return "text-berry-2";
  if (tone === "bad") return "text-berry";
  return "text-muted";
}

export function HalsoMarke({ state }: { state: HealthState }) {
  const tone = healthTone(state);
  const kant =
    tone === "ok"
      ? "border-signal/40 text-signal"
      : tone === "warn"
        ? "border-berry-2/50 text-berry-2"
        : tone === "bad"
          ? "border-berry/50 text-berry"
          : "border-line text-muted";
  return (
    <span className={`rounded-full border px-3 py-1 font-mono text-[10px] tracking-wide uppercase ${kant}`}>
      {healthLabel(state)}
    </span>
  );
}

function MatvardesRuta({ sample, enhet, etikett }: { sample: MonitoringSample; enhet: string; etikett: string }) {
  const gammal = isStaleSample(sample);
  return (
    <li className="rounded-xl border border-line/60 px-3 py-2">
      <p className="text-[11px] text-muted">{etikett}</p>
      <p className={`mt-0.5 font-display text-lg font-semibold ${gammal ? "text-muted" : ""}`}>
        {formatMetric(Number(sample.value), enhet)}
      </p>
      <p className="text-[10px] text-muted">
        {sample.source} · {lastCheckedLabel(sample.collected_at)}
        {gammal ? " · inte färsk" : ""}
      </p>
    </li>
  );
}

function TjansterPaNod({
  nod,
  registret,
  halsa,
}: {
  nod: string;
  registret: RegistryData;
  halsa: Map<string, HealthState>;
}) {
  const tjanster = registret.services.filter((s) => s.node_id === nod);
  if (tjanster.length === 0) return null;
  return (
    <ul className="mt-4 space-y-2">
      {tjanster.map((t) => (
        <li key={t.id} className="flex items-center gap-3 rounded-xl border border-line/60 px-3 py-2 text-sm">
          <Icon name="web" className="h-4 w-4 text-muted" />
          <span>{t.name}</span>
          <span className="text-xs text-muted">{t.environment}</span>
          <span className="ml-auto">
            <HalsoMarke state={halsa.get(t.id) ?? "unknown"} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function IncidentRad({
  incident,
  registret,
  orgNamn,
  onValj,
  vald,
}: {
  incident: Incident;
  registret: RegistryData;
  orgNamn: Map<string, string>;
  onValj: () => void;
  vald: boolean;
}) {
  const nod = registret.nodes.find((n) => n.id === incident.node_id);
  const tjanst = registret.services.find((s) => s.id === incident.service_id);
  const projekt = registret.projects.find((p) => p.id === (tjanst?.project_id ?? incident.project_id));

  return (
    <li className={`rounded-2xl border bg-ink-2 p-4 ${vald ? "border-berry/50" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
            incident.severity === "critical" ? "border-berry/50 text-berry" : "border-berry-2/50 text-berry-2"
          }`}
        >
          {severityLabel(incident.severity)}
        </span>
        <span className="font-medium">{incident.title}</span>
        <button
          type="button"
          onClick={onValj}
          className="ml-auto rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-paper"
        >
          {vald ? "Dölj underlag" : "Förbered felsökning"}
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">{incident.summary}</p>
      {/* Kopplingen incident → server → tjänst → kund, så att det går att se vem som berörs. */}
      <p className="mt-2 text-xs text-muted">
        {orgNamn.get(incident.organization_id) ?? "okänd kund"}
        {projekt ? ` · ${projekt.name}` : ""}
        {nod ? ` · ${nod.name}` : ""}
        {tjanst ? ` · ${tjanst.name}` : ""}
        {` · sedd ${incident.observation_count} gånger`}
        {incident.last_seen_at ? ` · ${lastCheckedLabel(incident.last_seen_at)}` : ""}
      </p>
    </li>
  );
}

/**
 * Underlaget för ONARLY AI. Det byggs lokalt och visas som det är – ingenting
 * skickas. Knappen för att dela finns inte ännu, och funktionen som skulle
 * skicka kräver ett uttryckligt bekräftande.
 */
function AiUnderlag({
  incident,
  registret,
  matdata,
  halsa,
  orgNamn,
  onStang,
}: {
  incident: Incident;
  registret: RegistryData;
  matdata: MonitoringData;
  halsa: HealthState;
  orgNamn: Map<string, string>;
  onStang: () => void;
}) {
  const nod = registret.nodes.find((n) => n.id === incident.node_id);
  const tjanst = registret.services.find((s) => s.id === incident.service_id);
  const projekt = registret.projects.find((p) => p.id === (tjanst?.project_id ?? incident.project_id));

  const bundle = buildIncidentAiBundle({
    incident,
    samples: matdata.samples.filter(
      (s) => (incident.node_id && s.node_id === incident.node_id) || (incident.service_id && s.service_id === incident.service_id),
    ),
    kinds: matdata.kinds,
    organizationName: orgNamn.get(incident.organization_id) ?? "okänd kund",
    projectName: projekt?.name ?? null,
    nodeName: nod?.name ?? null,
    serviceName: tjanst?.name ?? null,
    health: halsa,
  });

  const kontroll = mayShareWithAi(bundle, false);

  return (
    <section className="rounded-2xl border border-dashed border-field bg-ink-2 p-6">
      <div className="flex items-center gap-3">
        <h2 className="font-display text-lg font-semibold">Underlag för ONARLY AI</h2>
        <button type="button" onClick={onStang} className="ml-auto text-sm text-muted hover:text-paper">
          Stäng
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">
        Det här är exakt vad som skulle delas om du bad om felsökningshjälp. Ingenting har skickats:{" "}
        {kontroll.reason}
      </p>

      <dl className="mt-5 space-y-3 text-sm">
        <div>
          <dt className="font-mono text-[10px] tracking-wide text-muted uppercase">Mätvärden</dt>
          <dd className="mt-1">
            {bundle.metrics.length === 0 ? (
              <span className="text-muted">Inga.</span>
            ) : (
              <ul className="space-y-1">
                {bundle.metrics.map((m) => (
                  <li key={m.metric_key} className="text-muted">
                    {m.label}: <span className="text-paper">{m.formatted}</span> · {m.source} ·{" "}
                    {lastCheckedLabel(m.collected_at)}
                    {m.stale ? " · föråldrad" : ""}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-wide text-muted uppercase">Vad som inte ingår</dt>
          <dd className="mt-1">
            <ul className="space-y-1 text-muted">
              {bundle.omitted.map((o) => (
                <li key={o}>• {o}</li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </section>
  );
}
