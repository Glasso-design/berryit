/*
 * Tema: "dark" (BERRYiT-standard) eller "light".
 *
 * Ordning vid start:
 *   1. Sparat val (localStorage, nyckel "berryit-theme")
 *   2. Annars systemets prefers-color-scheme (ljust → light)
 *   3. Annars mörkt
 * Resultatet sätts som data-theme på <html>. Utan JavaScript gäller mörkt (:root).
 *
 * Samma modul används av webben (script i <head> före första rendering) och av
 * desktopappen (vid uppstart i WebView2).
 */
export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "berryit-theme";

/** Temafärg för adressfält/fönsterram per tema – samma värde som --ink. */
export const THEME_COLORS: Record<Theme, string> = { dark: "#0c0b10", light: "#f6f2ec" };

/** BERRYiT-rött. Identiskt i båda teman och i båda klienterna. */
export const BERRY_RED = "#c10c43";

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "light";
}

/** Läser sparat val, annars systemets inställning. Kastar aldrig. */
export function resolveTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(saved)) return saved;
  } catch {
    /* privat läge eller blockerad lagring – faller tillbaka nedan */
  }
  try {
    return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Sätter temat på <html> och uppdaterar meta[theme-color] om den finns. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* lagring kan vara blockerad – temat gäller ändå för den här sessionen */
  }
}

/** Synkront script för webbens <head>, så att inget tema "blinkar" vid laddning. */
export const themeInitScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},c=${JSON.stringify(
  THEME_COLORS,
)},t=null;try{t=localStorage.getItem(k)}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}var d=document.documentElement;d.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",c[t])}catch(e){}})();`;
