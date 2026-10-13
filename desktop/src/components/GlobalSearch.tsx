import { useEffect, useRef, useState } from "react";
import { LIMIT, SELECT, TABLE, ticketSearchFilter } from "@berryit/shared/api";
import { searchTermSchema } from "@berryit/shared/schemas";
import { useSession } from "@/auth/session";

type Hit = { id: string; reference: string; subject: string; status_key: string };

/**
 * Global sökning mot riktiga ärenden. Samma filter och gränser som webben
 * (delat API-kontrakt), och RLS avgör träffarna: en kund hittar bara sina egna.
 */
export function GlobalSearch({ onOpen }: { onOpen: (reference: string) => void }) {
  const { supabase } = useSession();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!supabase) return;
    let avbruten = false;
    const timer = setTimeout(async () => {
      const parsed = searchTermSchema.safeParse(query);
      if (!parsed.success) {
        setHits(null);
        return;
      }
      const { data } = await supabase
        .from(TABLE.tickets)
        .select(SELECT.ticketSearch)
        .or(ticketSearchFilter(parsed.data))
        .order("updated_at", { ascending: false })
        .limit(LIMIT.search);
      if (!avbruten) setHits((data ?? []) as Hit[]);
    }, 250);
    return () => {
      avbruten = true;
      clearTimeout(timer);
    };
  }, [query, supabase]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setHits(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Sök ärende (ID eller ämne)"
        aria-label="Sök ärende"
        className="w-full rounded-full border border-field bg-ink px-4 py-2 text-sm text-paper placeholder:text-muted focus:border-berry focus:outline-none"
      />
      {hits && (
        <div className="absolute z-40 mt-2 w-full overflow-hidden rounded-2xl border border-line bg-ink-2 shadow-xl">
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted">Inga träffar.</p>
          ) : (
            hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => {
                  setHits(null);
                  setQuery("");
                  onOpen(hit.reference);
                }}
                className="block w-full px-4 py-3 text-left text-sm hover:bg-fog/[0.05]"
              >
                <span className="font-mono text-xs text-berry-2">{hit.reference}</span>
                <span className="mt-0.5 block truncate">{hit.subject}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
