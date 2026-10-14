import { useEffect, useState } from "react";
import { LIMIT, SELECT, TABLE } from "@berryit/shared/api";
import type { TicketRow } from "@berryit/shared/domain";
import { useSession } from "@/auth/session";
import { DeskPanel } from "./DeskPanel";

/**
 * Ärendelista. RLS avgör urvalet: kunden ser sina egna ärenden, personal ser
 * dem de har behörighet till. Ingen filtrering sker i klienten som "säkerhet".
 */
export function Support({ focus }: { focus: string | null }) {
  const { supabase, access } = useSession();
  const [rows, setRows] = useState<TicketRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rows?.find((row) => row.id === selectedId) ?? null;

  useEffect(() => {
    if (!supabase) return;
    let avbruten = false;
    supabase
      .from(TABLE.tickets)
      .select(SELECT.ticketRow)
      .order("updated_at", { ascending: false })
      .limit(LIMIT.ticketList)
      .then(({ data }) => {
        if (!avbruten) {
          const tickets = (data ?? []) as TicketRow[];
          setRows(tickets);
          if (focus) setSelectedId(tickets.find((ticket) => ticket.reference === focus)?.id ?? null);
        }
      });
    return () => {
      avbruten = true;
    };
  }, [supabase]);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Support Desk</h1>
          <p className="mt-2 text-muted">
            {access?.isStaff ? "Ärenden du har behörighet till." : "Dina ärenden."}
          </p>
        </div>
        {rows && (
          <p className="rounded-full border border-line px-3 py-1 text-sm text-muted">
            {rows.length} {rows.length === 1 ? "ärende" : "ärenden"}
          </p>
        )}
      </header>

      {focus && (
        <p className="rounded-xl border border-line bg-ink-2 px-4 py-3 text-sm text-muted">
          Söker fram <span className="font-mono text-berry-2">{focus}</span>. Välj ärendet för ONARLY DESK-historik.
        </p>
      )}

      {rows === null ? (
        <p className="text-sm text-muted">Hämtar ärenden…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-ink-2 px-5 py-8 text-sm text-muted">
          Inga ärenden att visa.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] tracking-wider text-muted uppercase">
              <th className="py-2 pr-4">Ärende</th>
              <th className="py-2 pr-4">Ämne</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Prioritet</th>
              <th className="py-2">Uppdaterad</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr
                key={t.id}
                className={`border-b border-line/60 ${
                  focus && t.reference === focus ? "bg-berry/10" : ""
                }`}
              >
                <td className="py-2.5 pr-4 font-mono text-xs text-berry-2"><button type="button" className="underline" onClick={() => setSelectedId(t.id)}>{t.reference}</button></td>
                <td className="max-w-80 truncate py-2.5 pr-4">{t.subject}</td>
                <td className="py-2.5 pr-4 text-muted">{t.status_key}</td>
                <td className="py-2.5 pr-4 text-muted">{t.priority_key}</td>
                <td className="py-2.5 text-muted">{t.updated_at.slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selected && <DeskPanel key={selected.id} ticket={selected} />}

      <p className="text-sm text-muted">
        Ärendevy med konversation, interna anteckningar och bilagor byggs i en senare pass.
      </p>
    </div>
  );
}
