import { requireStaff } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kunder" };

/** Kundregister: organisationer ur databasen. Endast personal (RLS nekar kunder). */
export default async function KunderPage() {
  await requireStaff();
  const supabase = await createSupabaseServerClient();

  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name, org_no, created_at")
    .order("name");

  const orgs = organizations ?? [];
  const counts = await Promise.all(
    orgs.map(async (o) => {
      const [{ count: tickets }, { count: people }] = await Promise.all([
        supabase.from("tickets").select("id", { count: "exact", head: true }).eq("organization_id", o.id),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("organization_id", o.id),
      ]);
      return { id: o.id, tickets: tickets ?? 0, people: people ?? 0 };
    }),
  );
  const statsFor = (id: string) => counts.find((c) => c.id === id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Kunder</h1>
        <p className="mt-2 text-muted">Organisationer i BERRYiT Support Desk.</p>
      </header>

      {orgs.length === 0 ? (
        <p className="rounded-2xl border border-line bg-ink-2 px-5 py-6 text-sm text-muted">
          Inga organisationer registrerade ännu.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-ink-2">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs tracking-wide text-muted uppercase">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Organisation
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Org.nr
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Användare
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Ärenden
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orgs.map((o) => (
                <tr key={o.id}>
                  <td className="px-5 py-4 font-semibold">{o.name}</td>
                  <td className="px-5 py-4 text-muted">{o.org_no ?? "–"}</td>
                  <td className="px-5 py-4">{statsFor(o.id)?.people ?? 0}</td>
                  <td className="px-5 py-4">{statsFor(o.id)?.tickets ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm text-muted">
        Kundkort med kontaktuppgifter, avtal och utrustning byggs i ett senare pass.
      </p>
    </div>
  );
}
