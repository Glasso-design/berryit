import Link from "next/link";
import { Icon } from "@/components/icons";
import { LIMIT, SELECT, TABLE } from "@berryit/shared/api";
import { TICKET_STATUS_KEYS } from "@berryit/shared/domain";
import { requireSession, roleLabel } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Dashboard. Varje siffra kommer från databasen genom RLS – ser du ett tal är
 * det ditt faktiska antal. Moduler utan backend räknas inte med alls.
 */
export default async function ControlDashboard({ searchParams }: PageProps<"/control">) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const denied = typeof sp?.nekad === "string" ? sp.nekad : null;
  const supabase = await createSupabaseServerClient();

  const statusKeys = TICKET_STATUS_KEYS;
  const [statuses, counts, recent] = await Promise.all([
    supabase.from(TABLE.ticketStatuses).select("key, label, sort_order").order("sort_order"),
    Promise.all(
      statusKeys.map(async (key) => {
        const { count } = await supabase
          .from(TABLE.tickets)
          .select("id", { count: "exact", head: true })
          .eq("status_key", key);
        return [key, count ?? 0] as const;
      }),
    ),
    supabase
      .from(TABLE.tickets)
      .select(SELECT.ticketRow)
      .order("updated_at", { ascending: false })
      .limit(LIMIT.recentTickets),
  ]);

  const byStatus = new Map(counts);
  const labelFor = (key: string) => statuses.data?.find((s) => s.key === key)?.label ?? key;
  const total = counts.reduce((sum, [, n]) => sum + n, 0);

  return (
    <div className="space-y-8">
      {denied && (
        <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
          Du saknar behörighet för den vyn{denied === "superadmin" ? " (kräver Super Admin)" : " (kräver personal)"}.
        </p>
      )}

      <header>
        <p className="font-mono text-xs tracking-[0.2em] text-signal uppercase">Control Center</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Översikt</h1>
        <p className="mt-2 text-muted">
          Inloggad som {roleLabel(ctx)}.{" "}
          {ctx.isStaff
            ? "Siffrorna nedan är de ärenden du har behörighet att arbeta med, hämtade ur databasen."
            : "Siffrorna nedan är din organisations faktiska ärenden ur databasen."}
        </p>
      </header>

      <section aria-labelledby="arenden">
        <h2 id="arenden" className="font-display text-lg font-semibold">
          Ärenden
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {statusKeys.map((key) => (
            <li key={key} className="rounded-2xl border border-line bg-ink-2 p-5">
              <p className="text-sm text-muted">{labelFor(key)}</p>
              <p className="mt-2 font-display text-3xl font-bold tracking-tight">{byStatus.get(key) ?? 0}</p>
            </li>
          ))}
        </ul>
        {total === 0 && (
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
          <Link href="/control/support" className="text-sm font-semibold text-berry-2 hover:underline">
            Till Support Desk →
          </Link>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-ink-2">
          {(recent.data ?? []).length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted">Inga ärenden att visa.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(recent.data ?? []).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-4">
                  <span className="font-mono text-xs text-berry-2">{t.reference}</span>
                  <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                  <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted">
                    {labelFor(t.status_key)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="status" className="rounded-2xl border border-line bg-ink-2 p-5">
        <h2 id="status" className="flex items-center gap-2 font-display text-lg font-semibold">
          <Icon name="check" className="h-5 w-5 text-signal" /> Systemstatus
        </h2>
        <p className="mt-2 text-sm text-muted">
          Databas, auth och lagring svarar – annars hade den här sidan inte kunnat laddas. Övervakning av servrar och
          containrar kräver infrastrukturagenten, som inte är installerad: se Infrastruktur och Monitoring.
        </p>
      </section>
    </div>
  );
}
