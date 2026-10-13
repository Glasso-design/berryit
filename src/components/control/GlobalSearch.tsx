"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { searchTickets, type SearchHit } from "./search-action";

/**
 * Global sökning mot riktiga ärenden. Anropet går via en server action, så
 * sessionen kan ligga kvar i httpOnly-cookies och RLS avgör träffarna.
 */
export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (term.length < 2) {
        setHits(null);
        return;
      }
      const result = await searchTickets(term);
      if (!cancelled) setHits(result);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setHits(null);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={boxRef} className="relative max-w-md">
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
              <Link
                key={hit.id}
                href={`/control/support?arende=${encodeURIComponent(hit.reference)}`}
                className="block px-4 py-3 text-sm hover:bg-fog/[0.05]"
              >
                <span className="font-mono text-xs text-berry-2">{hit.reference}</span>
                <span className="mt-0.5 block truncate">{hit.subject}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
