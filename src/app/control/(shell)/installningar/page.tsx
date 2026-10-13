import { displayName, requireSession, roleLabel } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inställningar" };

/** Konto, behörigheter och tema. Allt läses genom RLS – ingen behörighet visas som inte finns i databasen. */
export default async function InstallningarPage() {
  const ctx = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: grants } = await supabase
    .from("support_role_grants")
    .select("id, role_key, scope, organization_id, granted_at, expires_at, reason")
    .eq("grantee_id", ctx.userId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Inställningar</h1>
        <p className="mt-2 text-muted">Ditt konto och dina behörigheter.</p>
      </header>

      <section className="rounded-2xl border border-line bg-ink-2 p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold">Konto</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-muted">Namn</dt>
            <dd className="mt-1">{displayName(ctx)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">E-post</dt>
            <dd className="mt-1">{ctx.email ?? "–"}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Roll</dt>
            <dd className="mt-1">{roleLabel(ctx)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Tvåfaktor (MFA)</dt>
            <dd className="mt-1">
              {ctx.currentLevel === "aal2" ? (
                <span className="rounded-full bg-signal/15 px-2.5 py-0.5 text-sm text-signal">Aktiv i sessionen</span>
              ) : (
                <span className="rounded-full border border-line px-2.5 py-0.5 text-sm text-muted">
                  {ctx.isSuperAdmin ? "Krävs för Super Admin" : "Inte aktiverad"}
                </span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-sm text-muted">
          Tema (mörkt/ljust) byts med knappen i topbaren och sparas i din webbläsare.
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-ink-2 p-5 sm:p-6">
        <h2 className="font-display text-lg font-semibold">Mina behörigheter</h2>
        {(grants ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Du har inga supporttilldelningar. Behörighet delas ut av en Super Admin och gäller omedelbart.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {(grants ?? []).map((g) => (
              <li key={g.id} className="rounded-xl border border-line bg-ink px-4 py-3">
                <p className="font-mono text-sm">{g.role_key}</p>
                <p className="mt-1 text-sm text-muted">
                  Omfattning: {g.scope === "global" ? "global" : "en organisation"}
                  {g.expires_at
                    ? ` · gäller till ${new Date(g.expires_at).toLocaleDateString("sv-SE")}`
                    : " · utan slutdatum"}
                </p>
                <p className="mt-1 text-sm text-muted">Skäl: {g.reason}</p>
              </li>
            ))}
          </ul>
        )}
        {ctx.isSuperAdmin && (
          <p className="mt-4 text-sm text-muted">
            Att dela ut och återkalla roller görs i ett senare pass. Databasen tillåter det redan, med revision.
          </p>
        )}
      </section>
    </div>
  );
}
