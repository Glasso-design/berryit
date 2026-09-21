/*
 * Enda källan för sajtens bas-URL (metadataBase, canonical, OpenGraph,
 * sitemap, robots, JSON-LD).
 *
 * Prioritet – första giltiga värde vinner:
 *   1. NEXT_PUBLIC_SITE_URL           (rekommenderad i produktion, t.ex. https://berryit.se)
 *   2. SITE_URL                       (äldre namn, stöds bakåtkompatibelt)
 *   3. VERCEL_PROJECT_PRODUCTION_URL  (Vercel, utan protokoll)
 *   4. VERCEL_URL                     (Vercel, utan protokoll)
 *   5. http://localhost:3501          (lokal dev-port, se PORTS.md)
 *
 * Tomma, whitespace-only och ogiltiga värden hoppas över – modulen kastar
 * aldrig, så `new URL()` under build kan inte krascha på konfiguration.
 */

export const FALLBACK_SITE_URL = "http://localhost:3501";

export const SITE_URL_ENV_KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "SITE_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

type Env = Partial<Record<(typeof SITE_URL_ENV_KEYS)[number], string | undefined>>;

/**
 * Normaliserar ett rått värde till en origin (`https://example.se`) eller
 * returnerar null om det inte går att tolka som en http(s)-adress.
 * Värden utan protokoll (som Vercels variabler) får https://, localhost får http://.
 */
export function normalizeSiteUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(value);
  const candidate = hasProtocol ? value : `${isLocal ? "http" : "https"}://${value}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Kräv ett rimligt värdnamn: localhost, IP eller något med punkt (inga mellanslag o.d.).
  if (!/^(localhost|\[[\da-f:]+\]|[a-z\d-]+(\.[a-z\d-]+)+)$/i.test(url.hostname)) return null;

  // Endast origin – sökväg, query och hash hör inte hemma i bas-URL:en.
  return url.origin;
}

export function resolveSiteUrl(env: Env = process.env as Env): string {
  for (const key of SITE_URL_ENV_KEYS) {
    const raw = env[key];
    const normalized = normalizeSiteUrl(raw);
    if (normalized) return normalized;
    if (raw?.trim()) {
      console.warn(`[site-url] Ignorerar ogiltigt ${key}=${JSON.stringify(raw)} – provar nästa källa.`);
    }
  }
  return FALLBACK_SITE_URL;
}

/** Bas-URL utan avslutande snedstreck, t.ex. `https://berryit.se`. */
export const siteUrl = resolveSiteUrl();

/** Samma bas-URL som URL-objekt – alltid giltigt, säkert för metadataBase. */
export const siteUrlObject = new URL(siteUrl);
