import type { MetadataRoute } from "next";
import { mainNav } from "@/content/site";
import { projects } from "@/content/projects";
import { cases } from "@/content/cases";
import { siteUrl as base } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    ...mainNav.map((n) => n.href as string),
    "/teknikhjalp-hemma",
    "/smart-hem",
    "/rut-avdrag",
    ...projects.map((p) => `/projects/${p.slug}`),
    ...cases.map((c) => `/cases/${c.slug}`),
  ];
  return paths.map((p) => ({ url: `${base}${p === "/" ? "" : p}` }));
}
