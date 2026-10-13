import { useState } from "react";
import { Icon } from "@berryit/shared/ui/Icon";
import { navFor, type NavKey } from "@berryit/shared/nav";
import { displayName, roleLabel } from "@berryit/shared/domain";
import { useSession } from "@/auth/session";
import { GlobalSearch } from "./GlobalSearch";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Appens ram: sidomeny, topbar med sökning och organisationsväljare samt
 * användarmeny. Moduler utan backend märks "ej ansluten" redan i menyn, så att
 * ingen behöver klicka sig fram för att upptäcka det.
 */
export function Shell({
  current,
  onNavigate,
  onOpenTicket,
  children,
}: {
  current: NavKey;
  onNavigate: (key: NavKey) => void;
  onOpenTicket: (reference: string) => void;
  children: React.ReactNode;
}) {
  const { access, organizations, signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [org, setOrg] = useState("alla");
  const items = navFor(access?.isStaff ?? false);

  return (
    <div className="flex h-full bg-ink text-paper">
      <aside className="app-chrome flex w-64 shrink-0 flex-col border-r border-line bg-ink-2">
        <div className="px-5 py-5">
          <Logo className="h-7 w-auto" />
          <p className="mt-2 font-mono text-[10px] tracking-[0.18em] text-signal uppercase">
            Control Center
          </p>
        </div>

        <nav aria-label="Huvudmeny" className="app-scroll flex-1 px-3 pb-4">
          {items.map((item) => {
            const aktiv = item.key === current;
            const connected = item.desktopConnected ?? item.connected;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                aria-current={aktiv ? "page" : undefined}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                  aktiv ? "bg-berry/15 text-paper" : "text-muted hover:bg-fog/[0.04] hover:text-paper"
                }`}
              >
                <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {!connected && (
                  <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-muted uppercase">
                    Ej ansluten
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-chrome flex items-center gap-4 border-b border-line bg-ink-2 px-6 py-3">
          <GlobalSearch onOpen={onOpenTicket} />

          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            <span className="sr-only">Välj organisation</span>
            <select
              value={org}
              onChange={(e) => setOrg(e.target.value)}
              aria-label="Välj organisation"
              className="rounded-full border border-line bg-ink px-3 py-1.5 text-sm text-paper focus:border-berry focus:outline-none"
            >
              <option value="alla">Alla organisationer</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>

          <ThemeToggle />

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-berry text-xs font-semibold text-white">
                {(access ? displayName(access) : "?").slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-40 truncate">{access ? displayName(access) : "Inloggad"}</span>
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-line bg-ink-2 shadow-xl"
              >
                <div className="border-b border-line px-4 py-3">
                  <p className="text-sm">{access ? displayName(access) : ""}</p>
                  <p className="mt-0.5 font-mono text-[10px] tracking-wide text-signal uppercase">
                    {access ? roleLabel(access) : ""}
                  </p>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onNavigate("installningar");
                  }}
                  className="block w-full px-4 py-2.5 text-left text-sm hover:bg-fog/[0.05]"
                >
                  Inställningar
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void signOut()}
                  className="block w-full px-4 py-2.5 text-left text-sm text-berry-2 hover:bg-fog/[0.05]"
                >
                  Logga ut
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="app-scroll flex-1 px-6 py-8">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
