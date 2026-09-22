"use client";

import { useEffect, useSyncExternalStore } from "react";
import { THEME_COLORS, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

/**
 * Växlar mellan mörkt och ljust tema. Ikonerna styrs av CSS (data-theme), så
 * knappen ser rätt ut redan vid första rendering. aria-pressed/etikett läses
 * från <html> via useSyncExternalStore – servern antar mörkt, klienten
 * uppdaterar efter hydrering utan varning.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);
  const next: Theme = theme === "light" ? "dark" : "light";

  // Följ systemets tema så länge besökaren inte själv har valt.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onSystemChange = () => {
      if (!storedTheme()) applyTheme(mq.matches ? "light" : "dark");
    };
    mq.addEventListener("change", onSystemChange);
    return () => mq.removeEventListener("change", onSystemChange);
  }, []);

  function toggle() {
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Privat läge eller blockerad lagring – temat gäller ändå för sidvisningen.
    }
  }

  const label = next === "light" ? "Byt till ljust tema" : "Byt till mörkt tema";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-paper transition hover:border-muted hover:bg-fog/[0.05] ${className}`}
    >
      {/* Sol visas i mörkt tema (byt till ljust), måne i ljust (byt till mörkt). */}
      <svg viewBox="0 0 24 24" className="on-dark-only h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
      </svg>
      <svg viewBox="0 0 24 24" className="on-light-only h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
      </svg>
    </button>
  );
}
