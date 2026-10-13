import { useEffect, useState } from "react";
import { Icon } from "@berryit/shared/ui/Icon";
import {
  lastCheckedLabel,
  isStale,
  splitProjects,
  statusLabel,
} from "@berryit/shared/connectors";
import type { Project, Service, StatusCheck } from "@berryit/shared/connectors";
import { useSession } from "@/auth/session";
import { loadRegistry, TOM_REGISTERDATA, type RegistryData } from "@/registry/data";

/**
 * Projekt: våra egna och kundernas, med tjänsterna som hör till.
 *
 * Skillnaden mellan internt och kund ligger på organisationen, inte på
 * projektet, så den kan inte glida isär. Driftstatus visas bara när det finns
 * en mätning – och sägs vara gammal när den är gammal.
 */
export function Projekt() {
  const { supabase } = useSession();
  const [data, setData] = useState<RegistryData>(TOM_REGISTERDATA);
  const [laddar, setLaddar] = useState(true);
  const [fel, setFel] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let avbruten = false;
    loadRegistry(supabase)
      .then((d) => {
        if (!avbruten) setData(d);
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

  const { interna, kund } = splitProjects(data.projects, data.organizations);
  const orgNamn = new Map(data.organizations.map((o) => [o.id, o.name]));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Projekt</h1>
        <p className="mt-2 text-muted">
          Systemregistret: vad vi har, var det ligger och när det senast kontrollerades.
        </p>
      </header>

      {fel && (
        <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
          Kunde inte läsa registret: {fel}
        </p>
      )}

      {laddar ? (
        <p className="text-sm text-muted">Hämtar registret…</p>
      ) : data.projects.length === 0 ? (
        <p className="rounded-2xl border border-line bg-ink-2 px-5 py-8 text-sm text-muted">
          Inga projekt registrerade ännu. Projekt, servrar och tjänster läggs in av personal med
          behörighet att hantera anslutningar.
        </p>
      ) : (
        <>
          <Avsnitt
            rubrik="Mina projekt"
            beskrivning="BERRYiT:s egna system."
            projekt={interna}
            data={data}
            orgNamn={orgNamn}
          />
          <Avsnitt
            rubrik="Kundprojekt"
            beskrivning="System vi driftar eller stödjer åt kund."
            projekt={kund}
            data={data}
            orgNamn={orgNamn}
          />
        </>
      )}
    </div>
  );
}

function Avsnitt({
  rubrik,
  beskrivning,
  projekt,
  data,
  orgNamn,
}: {
  rubrik: string;
  beskrivning: string;
  projekt: Project[];
  data: RegistryData;
  orgNamn: Map<string, string>;
}) {
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold">{rubrik}</h2>
          <p className="mt-1 text-sm text-muted">{beskrivning}</p>
        </div>
        <span className="rounded-full border border-line px-3 py-1 text-sm text-muted">
          {projekt.length} {projekt.length === 1 ? "projekt" : "projekt"}
        </span>
      </div>

      {projekt.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Inga projekt i den här kategorin.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {projekt.map((p) => {
            const tjanster = data.services.filter((s) => s.project_id === p.id);
            return (
              <li key={p.id} className="rounded-2xl border border-line bg-ink-2 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-base font-semibold">{p.name}</h3>
                    <p className="mt-0.5 text-xs text-muted">{orgNamn.get(p.organization_id) ?? "okänd organisation"}</p>
                  </div>
                  <span className="text-xs text-muted">
                    {tjanster.length} {tjanster.length === 1 ? "tjänst" : "tjänster"}
                  </span>
                </div>
                {p.description && <p className="mt-3 text-sm text-muted">{p.description}</p>}
                {tjanster.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {tjanster.map((s) => (
                      <TjansteRad key={s.id} tjanst={s} status={data.latest.services.get(s.id) ?? null} data={data} />
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function TjansteRad({
  tjanst,
  status,
  data,
}: {
  tjanst: Service;
  status: StatusCheck | null;
  data: RegistryData;
}) {
  const nod = tjanst.node_id ? data.nodes.find((n) => n.id === tjanst.node_id) : null;
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-xl border border-line/60 px-3 py-2 text-sm">
      <Icon name={tjanst.service_kind === "database" ? "system" : "web"} className="h-4 w-4 shrink-0 text-muted" />
      <span className="font-medium">{tjanst.name}</span>
      <span className="text-xs text-muted">{tjanst.environment}</span>
      <span className="text-xs text-muted">{nod ? nod.name : "serverlöst"}</span>
      <span className="ml-auto">
        <Driftstatus status={status} />
      </span>
    </li>
  );
}

/**
 * Visar en mätning som en mätning: status, avsändare och ålder. Finns ingen
 * mätning står det så – vi visar aldrig "fungerar" på en gissning.
 */
export function Driftstatus({ status }: { status: StatusCheck | null }) {
  if (!status) {
    return <span className="text-xs text-muted">ingen mätning</span>;
  }
  const gammal = isStale(status.checked_at);
  const farg =
    status.status_key === "ok"
      ? gammal
        ? "text-muted"
        : "text-signal"
      : status.status_key === "degraded"
        ? "text-berry-2"
        : status.status_key === "down"
          ? "text-berry"
          : "text-muted";

  return (
    <span className="flex items-center gap-2 text-xs">
      <span className={farg}>{statusLabel(status.status_key)}</span>
      <span className="text-muted">
        {lastCheckedLabel(status.checked_at)}
        {gammal ? " – inte färsk" : ""}
      </span>
    </span>
  );
}
