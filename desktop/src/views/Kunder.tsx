import { useSession } from "@/auth/session";

/**
 * Kundregistret. Listan kommer från organizations via RLS – personal ser alla,
 * en kund skulle bara se sin egen (men modulen visas inte för kunder).
 */
export function Kunder() {
  const { organizations, access } = useSession();

  if (!access?.isStaff) {
    return (
      <p role="alert" className="rounded-xl border border-berry/40 bg-berry/10 px-4 py-3 text-sm">
        Du saknar behörighet för den här vyn (kräver personal).
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Kunder</h1>
        <p className="mt-2 text-muted">Organisationer i BERRYiT.</p>
      </header>

      {organizations.length === 0 ? (
        <p className="rounded-2xl border border-line bg-ink-2 px-5 py-8 text-sm text-muted">
          Inga organisationer registrerade ännu.
        </p>
      ) : (
        <ul className="space-y-2">
          {organizations.map((o) => (
            <li
              key={o.id}
              className="flex items-center justify-between rounded-xl border border-line bg-ink-2 px-4 py-3"
            >
              <span>{o.name}</span>
              <span className="font-mono text-xs text-muted">{o.org_no ?? "org.nr saknas"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
