import type { Metadata } from "next";
import { site } from "@/content/site";

// Bas-URL:en löses centralt och validerat i site-url.ts.
export { siteUrl, siteUrlObject } from "./site-url";

/**
 * Metadata per route: titel, beskrivning, canonical och OpenGraph/Twitter.
 * Next ärver inte og:title från <title>, så allt sätts här på ett ställe.
 */
export function pageMeta({ title, description, path }: { title?: string; description: string; path: string }): Metadata {
  const fullTitle = title ? `${title} – ${site.name}` : `${site.name} – ${site.tagline}`;
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      siteName: site.name,
      locale: "sv_SE",
      type: "website",
    },
    twitter: { card: "summary", title: fullTitle, description },
  };
}
