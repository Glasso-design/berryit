"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Icon } from "@/components/icons";
import type { Route } from "next";
import type { NavItem } from "@/lib/control-nav";
import { GlobalSearch } from "./GlobalSearch";

export type ShellUser = { name: string; email: string | null; role: string; mfa: boolean };
export type ShellOrg = { id: string; name: string };

export function Shell({
  nav,
  user,
  organizations,
  canSearch,
  children,
}: {
  nav: NavItem[];
  user: ShellUser;
  organizations: ShellOrg[];
  canSearch: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Stäng navigationen vid sidbyte.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setMenuOpen(false);
    setUserMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen && !userMenuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      setUserMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, userMenuOpen]);

  const isActive = (href: string) => (href === "/control" ? pathname === href : pathname.startsWith(href));

  const navList = (
    <ul className="space-y-1">
      {nav.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href as Route}
            aria-current={isActive(item.href) ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
              isActive(item.href) ? "bg-berry/15 text-paper" : "text-muted hover:bg-fog/[0.05] hover:text-paper"
            }`}
          >
            <Icon name={item.icon} className="h-5 w-5 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {!item.connected && (
              <span className="rounded-full border border-line px-2 py-0.5 text-[10px] tracking-wide text-muted uppercase">
                ej ansluten
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex min-h-dvh flex-col bg-ink lg:flex-row">
      {/* Sidomeny – desktop */}
      <aside className="hidden w-64 shrink-0 border-r border-line bg-ink-2 lg:flex lg:flex-col">
        <div className="flex h-16 items-center border-b border-line px-5">
          <Link href="/control" aria-label="BERRYiT Control Center">
            <Logo className="h-8 w-auto" priority />
          </Link>
        </div>
        <nav aria-label="Huvudmeny" className="flex-1 overflow-y-auto p-3">
          {navList}
        </nav>
        <p className="border-t border-line px-5 py-4 font-mono text-[11px] tracking-wide text-muted uppercase">
          Control Center
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-ink/90 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="control-mobilmeny"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line lg:hidden"
          >
            <span className="sr-only">{menuOpen ? "Stäng meny" : "Öppna meny"}</span>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>

          <Link href="/control" className="lg:hidden" aria-label="BERRYiT Control Center">
            <Logo className="h-7 w-auto" />
          </Link>

          <div className="hidden min-w-0 flex-1 md:block">{canSearch && <GlobalSearch />}</div>

          <div className="ml-auto flex items-center gap-2">
            {organizations.length > 0 && <OrgPicker organizations={organizations} />}
            <ThemeToggle />
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                aria-expanded={userMenuOpen}
                className="flex items-center gap-2 rounded-full border border-line py-1.5 pr-3 pl-1.5 text-sm transition hover:border-muted"
              >
                <span
                  aria-hidden
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-berry text-xs font-semibold text-white"
                >
                  {user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-[12rem] truncate sm:inline">{user.name}</span>
              </button>
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-line bg-ink-2 p-4 shadow-xl">
                  <p className="truncate font-semibold">{user.name}</p>
                  {user.email && <p className="truncate text-sm text-muted">{user.email}</p>}
                  <p className="mt-3 flex items-center gap-2 text-xs">
                    <span className="rounded-full border border-line px-2 py-0.5 text-muted">{user.role}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        user.mfa ? "bg-signal/15 text-signal" : "border border-line text-muted"
                      }`}
                    >
                      {user.mfa ? "MFA aktiv" : "MFA ej aktiv"}
                    </span>
                  </p>
                  <Link
                    href="/control/installningar"
                    className="mt-4 block rounded-lg px-2 py-2 text-sm text-muted hover:bg-fog/[0.05] hover:text-paper"
                  >
                    Inställningar
                  </Link>
                  <form action="/control/logout" method="post" className="mt-1">
                    <button
                      type="submit"
                      className="w-full rounded-lg px-2 py-2 text-left text-sm text-berry-2 hover:bg-fog/[0.05]"
                    >
                      Logga ut
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Sidomeny – mobil */}
        {menuOpen && (
          <nav
            id="control-mobilmeny"
            aria-label="Mobilmeny"
            className="border-b border-line bg-ink-2 p-3 lg:hidden"
          >
            {canSearch && <div className="mb-3 md:hidden">{<GlobalSearch />}</div>}
            {navList}
          </nav>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

function OrgPicker({ organizations }: { organizations: ShellOrg[] }) {
  const [value, setValue] = useState("alla");
  return (
    <label className="hidden sm:block">
      <span className="sr-only">Välj organisation</span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="max-w-[12rem] rounded-full border border-field bg-ink px-3 py-2 text-sm text-paper"
      >
        <option value="alla">Alla organisationer</option>
        {organizations.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
