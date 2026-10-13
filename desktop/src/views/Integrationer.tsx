import { useEffect, useState } from "react";
import { Icon } from "@berryit/shared/ui/Icon";
import {
  CONNECTORS,
  CONNECTOR_KEYS,
  connectorDefinition,
  integrationStatusLabel,
  lastCheckedLabel,
} from "@berryit/shared/connectors";
import type { ConnectorKey, Integration } from "@berryit/shared/connectors";
import { useSession } from "@/auth/session";
import { canManageConnectors, loadRegistry, TOM_REGISTERDATA, type RegistryData } from "@/registry/data";

/**
 * Integrationernas anslutningsstatus.
 *
 * Tre lägen hålls isär med flit:
 *   • du saknar behörighet att se dem
 *   • connectorn finns men är inte ansluten
 *   • connectorn är ansluten, och då står det när den senast svarade
 *
 * Ingenting här visar en grön status på en gissning, och ingen hemlighet
 * passerar – registret innehåller bara namnet på hemligheten, aldrig värdet.
 */
export function Integrationer() {
  const { supabase, access } = useSession();
  const [data, setData] = useState<RegistryData>(TOM_REGISTERDATA);
  const [farHantera, setFarHantera] = useState<boolean | null>(null);
  const [laddar, setLaddar] = useState(true);
  const [fel, setFel] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let avbruten = false;
    (async () => {
      try {
        const registret = await loadRegistry(supabase);
        if (avbruten) return;
        setData(registret);
        setFarHantera(await canManageConnectors(supabase, registret.organizations.map((o) => o.id)));
      } catch (e) {
        if (!avbruten) setFel(e instanceof Error ? e.message : String(e));
      } finally {
        if (!avbruten) setLaddar(false);
      }
    })();
    return () => {
      avbruten = true;
    };
  }, [supabase]);

  const integrationer = data.integrations ?? [];
  const orgNamn = new Map(data.organizations.map((o) => [o.id, o.name]));

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Integrationer</h1>
        <p className="mt-2 text-muted">
          Vilka system BERRYiT är anslutet till, under vilken identitet och när anslutningen senast
          svarade. Alla connectors är i läsläge.
        </p>
      </header>

      {fel && (
        <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
          Kunde inte läsa integrationerna: {fel}
        </p>
      )}

      {!laddar && farHantera === false && (
        <section className="rounded-2xl border border-dashed border-field bg-ink-2 p-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 font-mono text-xs tracking-wide text-muted uppercase">
            <Icon name="troubleshoot" className="h-4 w-4" />
            Behörighet saknas
          </p>
          <h2 className="mt-5 font-display text-xl font-semibold">Du ser inte anslutningarna</h2>
          <p className="mt-3 max-w-2xl text-muted">
            Att läsa integrationerna kräver behörigheten <code className="font-mono text-sm">connectors.manage</code>,
            och den kräver bekräftad tvåfaktor. Listan nedan visar därför bara vilka typer av
            anslutningar som finns i systemet – inte era egna.
            {access?.isSuperAdmin && access.currentLevel !== "aal2"
              ? " Du är Super Admin men har inte bekräftat tvåfaktor i den här sessionen."
              : ""}
          </p>
        </section>
      )}

      {!laddar && farHantera === true && (
        <section>
          <div className="flex items-end justify-between gap-4">
            <h2 className="font-display text-lg font-semibold">Konfigurerade anslutningar</h2>
            <span className="rounded-full border border-line px-3 py-1 text-sm text-muted">
              {integrationer.length} st
            </span>
          </div>

          {integrationer.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-line bg-ink-2 px-5 py-8 text-sm text-muted">
              Ingen anslutning är konfigurerad ännu.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {integrationer.map((i) => (
                <IntegrationsRad key={i.id} integration={i} orgNamn={orgNamn} />
              ))}
            </ul>
          )}
        </section>
      )}

      <section>
        <h2 className="font-display text-lg font-semibold">Tillgängliga connectors</h2>
        <p className="mt-1 text-sm text-muted">
          Vad var och en läser, och vilken identitet den ska använda. Ingen av dem kan starta om,
          deploya eller skriva i ett annat system.
        </p>
        <ul className="mt-4 grid gap-3 lg:grid-cols-2">
          {CONNECTOR_KEYS.map((key) => (
            <ConnectorKort key={key} nyckel={key} integrationer={integrationer} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function IntegrationsRad({
  integration,
  orgNamn,
}: {
  integration: Integration;
  orgNamn: Map<string, string>;
}) {
  const def = connectorDefinition(integration.connector_key);
  const ansluten = integration.status === "connected";
  return (
    <li className="rounded-2xl border border-line bg-ink-2 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-base font-semibold">{integration.display_name}</h3>
        <span className="text-xs text-muted">{def?.label ?? integration.connector_key}</span>
        <span className="text-xs text-muted">{orgNamn.get(integration.organization_id) ?? "okänd"}</span>
        <span
          className={`ml-auto rounded-full border px-3 py-1 text-xs ${
            ansluten ? "border-signal/40 text-signal" : "border-line text-muted"
          }`}
        >
          {integrationStatusLabel(integration.status)}
        </span>
      </div>
      <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3">
        <div>
          <dt className="sr-only">Läge</dt>
          <dd>{integration.access_mode === "read_only" ? "läsläge" : integration.access_mode}</dd>
        </div>
        <div>
          <dt className="sr-only">Identitet</dt>
          <dd className="font-mono">{integration.secret_ref ?? "ingen hemlighet krävs"}</dd>
        </div>
        <div>
          <dt className="sr-only">Senast kontrollerad</dt>
          <dd>{lastCheckedLabel(integration.last_checked_at)}</dd>
        </div>
      </dl>
      {integration.last_error && (
        <p className="mt-3 rounded-xl border border-berry/40 bg-berry/10 px-3 py-2 text-xs">
          {integration.last_error}
        </p>
      )}
    </li>
  );
}

function ConnectorKort({
  nyckel,
  integrationer,
}: {
  nyckel: ConnectorKey;
  integrationer: Integration[];
}) {
  const def = CONNECTORS[nyckel];
  const antal = integrationer.filter((i) => i.connector_key === nyckel).length;
  const anslutna = integrationer.filter((i) => i.connector_key === nyckel && i.status === "connected").length;

  return (
    <li className="rounded-2xl border border-line bg-ink-2 p-5">
      <div className="flex items-center gap-3">
        <h3 className="font-display text-sm font-semibold">{def.label}</h3>
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
            anslutna > 0 ? "border-signal/40 text-signal" : "border-line text-muted"
          }`}
        >
          {anslutna > 0 ? `${anslutna} ansluten${anslutna === 1 ? "" : "a"}` : "ej ansluten"}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">{def.description}</p>
      <p className="mt-3 font-mono text-[10px] tracking-wide text-muted uppercase">Identitet</p>
      <p className="mt-1 text-xs text-muted">{def.identity}</p>
      {antal === 0 && (
        <>
          <p className="mt-3 font-mono text-[10px] tracking-wide text-muted uppercase">Krävs</p>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {def.requirements.map((r) => (
              <li key={r.key}>
                • {r.label}
                {r.secret ? " (ligger i serverns secret store)" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  );
}
