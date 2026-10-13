import { useEffect, useState } from "react";
import { Icon } from "@berryit/shared/ui/Icon";
import { useSession } from "@/auth/session";
import { loadRegistry, TOM_REGISTERDATA, type RegistryData } from "@/registry/data";
import { Driftstatus, TjansteRad } from "./Projekt";

/**
 * Servrar och tjänster, med senast verifierad driftstatus.
 *
 * Vyn visar bara vad registret innehåller och vad connectors faktiskt har mätt.
 * Den kan inte starta om, deploya eller köra något – Windows-appen har varken
 * Docker-socket, SSH-nyckel eller service-role-nyckel.
 */
export function Infrastruktur() {
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

  const orgNamn = new Map(data.organizations.map((o) => [o.id, o.name]));
  const serverlosa = data.services.filter((s) => !s.node_id);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Infrastruktur</h1>
        <p className="mt-2 text-muted">
          Servrar och tjänster i registret. Statusen kommer från connectors som kör på servern –
          läsande, aldrig styrande.
        </p>
      </header>

      {fel && (
        <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
          Kunde inte läsa registret: {fel}
        </p>
      )}

      {laddar ? (
        <p className="text-sm text-muted">Hämtar registret…</p>
      ) : data.nodes.length === 0 && data.services.length === 0 ? (
        <p className="rounded-2xl border border-line bg-ink-2 px-5 py-8 text-sm text-muted">
          Inga servrar eller tjänster registrerade ännu.
        </p>
      ) : (
        <>
          <section>
            <h2 className="font-display text-lg font-semibold">Servrar</h2>
            {data.nodes.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Inga servrar registrerade.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {data.nodes.map((nod) => {
                  const tjanster = data.services.filter((s) => s.node_id === nod.id);
                  return (
                    <li key={nod.id} className="rounded-2xl border border-line bg-ink-2 p-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <Icon name="install" className="h-4 w-4 text-muted" />
                        <h3 className="font-display text-base font-semibold">{nod.name}</h3>
                        {!nod.is_active && (
                          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted uppercase">
                            inaktiv
                          </span>
                        )}
                        <span className="ml-auto">
                          <Driftstatus status={data.latest.nodes.get(nod.id) ?? null} />
                        </span>
                      </div>
                      <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-4">
                        <div>
                          <dt className="sr-only">Organisation</dt>
                          <dd>{orgNamn.get(nod.organization_id) ?? "okänd"}</dd>
                        </div>
                        <div>
                          <dt className="sr-only">Värdnamn</dt>
                          <dd className="font-mono">{nod.hostname ?? "–"}</dd>
                        </div>
                        <div>
                          <dt className="sr-only">Leverantör</dt>
                          <dd>{nod.provider ?? "–"}</dd>
                        </div>
                        <div>
                          <dt className="sr-only">Typ</dt>
                          <dd>{nod.node_kind}</dd>
                        </div>
                      </dl>
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

          {serverlosa.length > 0 && (
            <section>
              <h2 className="font-display text-lg font-semibold">Serverlösa tjänster</h2>
              <p className="mt-1 text-sm text-muted">Tjänster som inte ligger på en server vi äger.</p>
              <ul className="mt-4 space-y-2">
                {serverlosa.map((s) => (
                  <TjansteRad key={s.id} tjanst={s} status={data.latest.services.get(s.id) ?? null} data={data} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
