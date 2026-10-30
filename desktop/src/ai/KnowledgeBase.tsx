import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

type Entry = {
  id: string;
  title: string;
  problem: string;
  verified_solution: string;
  project_id: string | null;
  service_key: string | null;
  updated_at: string;
};

/**
 * Read-only view of the verified solutions (ai_knowledge_entries) for one
 * customer. RLS decides what is visible (AI scope in the organisation and, for
 * project entries, the project). It works whether or not ONARLY AI is
 * available: entries are written only after a technician has confirmed that a
 * solution worked in reality, and later answers use them as sources.
 */
export function KnowledgeBase({
  supabase,
  organizationId,
  version,
}: {
  supabase: SupabaseClient;
  organizationId: string;
  version: number;
}) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    supabase
      .from("ai_knowledge_entries")
      .select("id,title,problem,verified_solution,project_id,service_key,updated_at")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(50)
      .then(
        ({ data, error: failure }) => {
          if (cancelled) return;
          if (failure) setError(`Kunskapsbasen kunde inte läsas: ${failure.message}`);
          else setRows((data ?? []) as unknown as Entry[]);
        },
        (failure: unknown) => {
          if (!cancelled) setError(`Kunskapsbasen kunde inte läsas: ${failure instanceof Error ? failure.message : String(failure)}`);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [supabase, organizationId, version]);

  return (
    <section aria-label="Kunskapsbas" className="space-y-3 rounded-2xl border border-line bg-ink-2 p-4">
      <h2 className="font-display text-lg font-semibold">Kunskapsbas</h2>
      <p className="text-sm text-muted">
        Verifierade lösningar för vald kund. En lösning sparas från ett AI-svar först när teknikern bekräftat att den
        fungerat i verkligheten, och används sedan som källa i senare svar.
      </p>
      {error && (
        <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-3 py-2 text-sm">
          {error}
        </p>
      )}
      {!error && rows === null && <p className="text-sm text-muted">Hämtar kunskapsbasen…</p>}
      {rows && rows.length === 0 && (
        <p className="text-sm text-muted">Inga verifierade lösningar för den här kunden ännu.</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <article aria-label={row.title} className="rounded-xl border border-signal/30 bg-signal/5 px-3 py-2 text-sm">
                <h3 className="font-semibold">{row.title}</h3>
                <p className="mt-1 text-muted">Problem: {row.problem}</p>
                <p className="mt-2 whitespace-pre-wrap">{row.verified_solution}</p>
                <time className="mt-1 block text-[11px] text-muted">
                  Verifierad {new Date(row.updated_at).toLocaleString("sv-SE")}
                </time>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
