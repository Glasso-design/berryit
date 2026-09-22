import Link from "next/link";
import type { Route } from "next";

/**
 * Genererad projektyta – används tills riktig logotyp/screenshot finns.
 * Visar varumärkets namn i dess egen accentfärg, inte BERRYiT:s.
 */
export function ProjectVisual({ name, accent, className = "" }: { name: string; accent: string; className?: string }) {
  return (
    <div
      data-theme="dark"
      className={`relative overflow-hidden rounded-xl border border-line bg-ink-3 ${className}`}
      style={{ ["--accent" as string]: accent }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-60"
        style={{
          background: `radial-gradient(120% 90% at 100% 0%, ${accent}55, transparent 60%), radial-gradient(80% 80% at 0% 100%, ${accent}22, transparent 60%)`,
        }}
      />
      <div aria-hidden className="bg-grid absolute inset-0" />
      <div className="relative flex h-full items-end p-6">
        <span className="font-display text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: accent }}>
          {name}
        </span>
      </div>
    </div>
  );
}

export function ProjectCard({
  href,
  name,
  summary,
  accent,
  meta,
  tags,
}: {
  href: Route;
  name: string;
  summary: string;
  accent: string;
  meta?: string;
  tags?: string[];
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-line bg-ink-2 p-3 transition hover:-translate-y-0.5 hover:border-muted/60"
    >
      <ProjectVisual name={name} accent={accent} className="aspect-[16/10]" />
      <div className="flex flex-1 flex-col p-4">
        {meta && <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">{meta}</p>}
        <p className="mt-2 text-paper/90">{summary}</p>
        {tags && tags.length > 0 && (
          <p className="mt-4 text-sm text-muted">{tags.slice(0, 4).join(" · ")}</p>
        )}
        <span className="mt-auto pt-5 text-sm font-semibold text-berry-2">
          Läs mer <span aria-hidden className="inline-block transition group-hover:translate-x-0.5">→</span>
        </span>
      </div>
    </Link>
  );
}
