import { displayName, requireSession, roleLabel } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inställningar" };

const AUDIT_LABEL: Record<string, string> = {
  customer_registered: "Kund registrerad",
  customer_registration_repaired: "Kundregistrering reparerad",
  profiles_insert: "Profil skapad",
  profiles_update: "Profil ändrad",
  organizations_insert: "Företag registrerat",
  organizations_update: "Företag ändrat",
  "role.granted": "Roll tilldelad",
  "role.revoked": "Roll återkallad",
  "profile.role_changed": "Profilroll ändrad",
  attachment_download_requested: "Bilaga hämtad",
  "project.access_changed": "Projektåtkomst ändrad",
};

type AuditRow = {
  id: number;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  scope: string | null;
  reason: string | null;
  created_at: string;
};

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

  // Audit log: RLS returns rows only to holders of audit.read (Super Admin with
  // verified MFA, or a scoped audit right). Nothing is shown that the database
  // does not return; an empty list is an empty list.
  const audit = await supabase
    .from("support_admin_audit")
    .select("id, actor_id, action, target_type, target_id, scope, reason, created_at")
    .order("id", { ascending: false })
    .limit(30);
  const auditRows = (audit.data ?? []) as unknown as AuditRow[];
  const actorIds = [...new Set(auditRows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const actors = (actorIds.length
    ? ((await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)).data ?? [])
    : []) as Array<{ id: string; full_name: string | null; email: string | null }>;
  const actorName = (id: string | null) => {
    if (!id) return "System";
    const person = actors.find((row) => row.id === id);
    return person?.full_name || person?.email || "Okänd användare";
  };
  const showAudit = ctx.isSuperAdmin || auditRows.length > 0;

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
            Roller delas ut och återkallas under Projekt → Användare och tilldelningar (kräver behörigheten roles.grant
            och verifierad tvåfaktor). Varje ändring revisionsloggas.
          </p>
        )}
      </section>

      {showAudit && (
        <section aria-labelledby="revisionslogg" className="rounded-2xl border border-line bg-ink-2 p-5 sm:p-6">
          <h2 id="revisionslogg" className="font-display text-lg font-semibold">Revisionslogg</h2>
          <p className="mt-2 text-sm text-muted">
            De senaste 30 administrativa händelserna du har behörighet att läsa (append-only). Ärendens egen historik
            visas i respektive ärende.
          </p>
          {audit.error ? (
            <p role="alert" className="mt-3 text-sm">Revisionsloggen kunde inte läsas: {audit.error.message}</p>
          ) : auditRows.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Inga händelser att visa. Läsning kräver behörigheten audit.read{ctx.isSuperAdmin ? " och verifierad tvåfaktor i sessionen" : ""}.
            </p>
          ) : (
            <ol className="mt-4 space-y-2 text-sm">
              {auditRows.map((row) => (
                <li key={row.id} className="rounded-xl border border-line bg-ink px-4 py-3">
                  <p>
                    <span className="font-semibold">{AUDIT_LABEL[row.action] ?? row.action}</span>
                    <span className="text-muted"> · {actorName(row.actor_id)} · {new Date(row.created_at).toLocaleString("sv-SE")}</span>
                  </p>
                  <p className="mt-1 break-all text-xs text-muted">
                    {row.target_type}
                    {row.target_id ? ` ${row.target_id}` : ""}
                    {row.scope ? ` · ${row.scope === "global" ? "global" : "organisation"}` : ""}
                    {row.reason ? ` · ${row.reason}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
