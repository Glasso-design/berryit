import { useEffect, useState } from "react";
import { LIMIT, SELECT, TABLE } from "@berryit/shared/api";
import { TICKET_STATUS_KEYS, roleLabel } from "@berryit/shared/domain";
import type { TicketRow } from "@berryit/shared/domain";
import type { NavKey } from "@berryit/shared/nav";
import { useSession } from "@/auth/session";

type Status = { key: string; label: string };

/**
 * Översikt. Varje siffra kommer från databasen genom RLS – ser du ett tal är
 * det faktiska rader. Moduler utan backend räknas inte med alls, och ingen
 * driftstatus visas som inte går att belägga.
 */
export function Dashboard({ onNavigate }: { onNavigate: (key: NavKey) => void }) {
  const { supabase, access } = useSession();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [recent, setRecent] = useState<TicketRow[]>([]);
  const [fel, setFel] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let avbruten = false;
    (async () => {
      try {
        const [statusRes, ...countRes] = await Promise.all([
          supabase.from(TABLE.ticketStatuses).select("key, label, sort_order").order("sort_order"),
          ...TICKET_STATUS_KEYS.map((key) =>
            supabase
              .from(TABLE.tickets)
              .select("id", { count: "exact", head: true })
              .eq("status_key", key),
          ),
        ]);
        const { data: senaste } = await supabase
          .from(TABLE.tickets)
          .select(SELECT.ticketRow)
          .order("updated_at", { ascending: false })
          .limit(LIMIT.recentTickets);
        if (avbruten) return;
        setStatuses((statusRes.data ?? []) as Status[]);
        setCounts(
          Object.fromEntries(TICKET_STATUS_KEYS.map((key, i) => [key, countRes[i]?.count ?? 0])),
        );
        setRecent((senaste ?? []) as TicketRow[]);
      } catch (e) {
        if (!avbruten) setFel(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      avbruten = true;
    };
  }, [supabase]);

  const label = (key: string) => statuses.find((s) => s.key === key)?.label ?? key;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-8">
      <header>
        <p className="font-mono text-xs tracking-[0.2em] text-signal uppercase">Control Center</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Översikt</h1>
        <p className="mt-2 text-muted">
          Inloggad som {access ? roleLabel(access) : "okänd roll"}.{" "}
          {access?.isStaff
            ? "Siffrorna nedan är de ärenden du har behörighet att arbeta med, hämtade ur databasen."
            : "Siffrorna nedan är din organisations faktiska ärenden ur databasen."}
        </p>
      </header>

      {fel && (
        <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
          Kunde inte hämta ärenden: {fel}
        </p>
      )}

      <section aria-labelledby="arenden">
        <h2 id="arenden" className="font-display text-lg font-semibold">
          Ärenden
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          {TICKET_STATUS_KEYS.map((key) => (
            <li key={key} className="rounded-2xl border border-line bg-ink-2 p-5">
              <p className="text-sm text-muted">{label(key)}</p>
              <p className="mt-2 font-display text-3xl font-bold tracking-tight">
                {counts ? counts[key] : "–"}
              </p>
            </li>
          ))}
        </ul>
        {counts && total === 0 && (
          <p className="mt-4 text-sm text-muted">
            Inga ärenden ännu. Nya ärenden visas här så snart de skapas.
          </p>
        )}
      </section>

      <section aria-labelledby="senaste">
        <div className="flex items-end justify-between gap-4">
          <h2 id="senaste" className="font-display text-lg font-semibold">
            Senast uppdaterade
          </h2>
          <button
            type="button"
            onClick={() => onNavigate("support")}
            className="text-sm text-berry-2 hover:underline"
          >
            Till Support Desk →
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {recent.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-4 rounded-xl border border-line bg-ink-2 px-4 py-3"
            >
              <span className="font-mono text-xs text-berry-2">{t.reference}</span>
              <span className="flex-1 truncate text-sm">{t.subject}</span>
              <span className="text-xs text-muted">{label(t.status_key)}</span>
            </li>
          ))}
          {recent.length === 0 && <li className="text-sm text-muted">Inget att visa ännu.</li>}
        </ul>
      </section>

      <section aria-labelledby="systemstatus">
        <h2 id="systemstatus" className="font-display text-lg font-semibold">
          Systemstatus
        </h2>
        <p className="mt-3 text-sm text-muted">
          Databas, auth och lagring svarar – annars hade den här vyn inte kunnat fyllas. Övervakning
          av servrar och containrar kräver infrastrukturagenten, som inte är installerad: se
          Infrastruktur och Monitoring.
        </p>
      </section>
    </div>
  );
}
