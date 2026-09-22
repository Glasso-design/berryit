/*
 * Tema: "dark" (BERRYiT-standard) eller "light".
 *
 * Ordning vid sidladdning (themeInitScript, körs i <head> före första rendering):
 *   1. Sparat val i localStorage ("berryit-theme")
 *   2. Annars systemets prefers-color-scheme (ljust → light)
 *   3. Annars mörkt
 * Resultatet sätts som data-theme på <html>. Utan JavaScript gäller mörkt (:root).
 */
export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "berryit-theme";

/** Webbläsarens temafärg (adressfält m.m.) per tema – samma som --ink. */
export const THEME_COLORS: Record<Theme, string> = { dark: "#0c0b10", light: "#f6f2ec" };

export const themeInitScript = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)},c=${JSON.stringify(
  THEME_COLORS,
)},t=null;try{t=localStorage.getItem(k)}catch(e){}if(t!=="light"&&t!=="dark"){t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}var d=document.documentElement;d.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",c[t])}catch(e){}})();`;
