import { requireSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support Desk" };

/**
 * Ärendelista. RLS avgör urvalet: kunden ser sina egna ärenden, personal ser
 * alla, delegerad tekniker ser sin organisations. Ingen filtrering i klienten.
 */
export default async function SupportPage({ searchParams }: PageProps<"/control/support">) {
  const ctx = await requireSession();
  const sp = await searchParams;
  const focus = typeof sp?.arende === "string" ? sp.arende : null;
  const supabase = await createSupabaseServerClient();

  const [{ data: statuses }, { data: priorities }, { data: tickets }] = await Promise.all([
    supabase.from("ticket_statuses").select("key, label").order("sort_order"),
    supabase.from("ticket_priorities").select("key, label").order("sort_order"),
    supabase
      .from("tickets")
      .select("id, reference, subject, status_key, priority_key, category_key, updated_at, organization_id")
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);

  const label = (list: { key: string; label: string }[] | null, key: string) =>
    list?.find((x) => x.key === key)?.label ?? key;
  const rows = tickets ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Support Desk</h1>
          <p className="mt-2 text-muted">
            {ctx.isStaff ? "Ärenden du har behörighet till." : "Dina ärenden."}
          </p>
        </div>
        <p className="rounded-full border border-line px-3 py-1 text-sm text-muted">{rows.length} {rows.length === 1 ? "ärende" : "ärenden"}</p>
      </header>

      {focus && (
        <p className="rounded-xl border border-line bg-ink-2 px-4 py-3 text-sm text-muted">
          Sökte efter <span className="text-paper">{focus}</span>. Ärendevy med konversation byggs i nästa pass.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-ink-2 px-5 py-6 text-sm text-muted">
          Inga ärenden att visa.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-ink-2">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="border-b border-line text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">Ärende</th>
                <th scope="col" className="px-5 py-3 font-medium">Ämne</th>
                <th scope="col" className="px-5 py-3 font-medium">Status</th>
                <th scope="col" className="px-5 py-3 font-medium">Prioritet</th>
                <th scope="col" className="px-5 py-3 font-medium">Uppdaterad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((t) => (
                <tr key={t.id} className={focus === t.reference ? "bg-berry/10" : undefined}>
                  <td className="px-5 py-4 font-mono text-xs text-berry-2">{t.reference}</td>
                  <td className="max-w-sm px-5 py-4">
                    <span className="block truncate">{t.subject}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full border border-line px-2.5 py-0.5 text-xs">
                      {label(statuses, t.status_key)}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-muted">{label(priorities, t.priority_key)}</td>
                  <td className="px-5 py-4 text-muted">
                    {new Date(t.updated_at).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-muted">
        Ärendevy med konversation, interna anteckningar och bilagor byggs i PASS 2B.
      </p>
    </div>
  );
}
