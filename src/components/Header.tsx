"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { mainNav, primaryCta } from "@/content/site";
import { Logo } from "./Logo";

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Escape stänger mobilmenyn.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Stäng mobilmenyn vid navigering.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition ${
        scrolled || open ? "border-b border-line bg-ink/85 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="BERRYiT – startsida" className="shrink-0">
          <Logo priority className="h-10 w-auto sm:h-11" />
        </Link>

        <nav aria-label="Huvudmeny" className="hidden xl:block">
          <ul className="flex items-center gap-1">
            {mainNav.slice(1).map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={`rounded-full px-3 py-2 text-sm transition ${
                    isActive(item.href) ? "bg-white/[0.07] text-paper" : "text-muted hover:text-paper"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={primaryCta.href}
            className="hidden rounded-full bg-berry px-5 py-2 text-sm font-semibold text-white transition hover:bg-berry-deep sm:inline-flex"
          >
            {primaryCta.label}
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobilmeny"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line xl:hidden"
          >
            <span className="sr-only">{open ? "Stäng meny" : "Öppna meny"}</span>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav
          id="mobilmeny"
          aria-label="Mobilmeny"
          className="h-[calc(100dvh-4rem)] overflow-y-auto border-t border-line bg-ink xl:hidden"
        >
          <ul className="mx-auto max-w-7xl px-4 py-4 sm:px-6">
            {mainNav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? "page" : undefined}
                  className={`block rounded-xl px-3 py-3 text-lg ${
                    isActive(item.href) ? "bg-white/[0.06] text-paper" : "text-paper/80"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="mt-3 sm:hidden">
              <Link
                href={primaryCta.href}
                className="block rounded-full bg-berry px-5 py-3 text-center font-semibold text-white"
              >
                {primaryCta.label}
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
