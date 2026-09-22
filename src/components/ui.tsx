import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}

export function Section({
  children,
  id,
  className = "",
  tone = "base",
}: {
  children: ReactNode;
  id?: string;
  className?: string;
  tone?: "base" | "raised";
}) {
  const bg = tone === "raised" ? "bg-ink-2 border-y border-line" : "";
  return (
    <section id={id} className={`py-20 sm:py-28 ${bg} ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">
      <span aria-hidden className="mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-berry align-middle" />
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  className = "",
}: {
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`max-w-3xl ${className}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h2>
      {lead && <div className="mt-5 text-lg leading-relaxed text-muted text-pretty">{lead}</div>}
    </div>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: Route;
  children: ReactNode;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-berry text-white shadow-[0_8px_30px_-8px_var(--berry)] hover:bg-berry-deep"
      : "border border-line bg-fog/[0.03] text-paper hover:border-muted hover:bg-fog/[0.06]";
  return (
    <Link
      href={href}
      className={`group inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition ${styles} ${className}`}
    >
      {children}
      <span aria-hidden className="transition group-hover:translate-x-0.5">
        →
      </span>
    </Link>
  );
}

export function Tags({ items, className = "" }: { items: readonly string[]; className?: string }) {
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {items.map((item) => (
        <li key={item} className="rounded-full border border-line bg-fog/[0.03] px-3 py-1 text-sm text-paper/85">
          {item}
        </li>
      ))}
    </ul>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-ink-2 p-6 sm:p-8 ${className}`}>{children}</div>;
}

export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b border-line pt-36 pb-20 sm:pt-44 sm:pb-24">
      <div aria-hidden className="bg-grid absolute inset-0" />
      <div
        aria-hidden
        className="glow absolute -top-40 left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-grape/20 blur-[120px]"
      />
      <Container className="relative">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-5 max-w-4xl font-display text-4xl font-semibold tracking-tight text-balance sm:text-6xl">{title}</h1>
        {lead && <div className="mt-6 max-w-2xl text-lg leading-relaxed text-muted text-pretty sm:text-xl">{lead}</div>}
        {children && <div className="mt-10">{children}</div>}
      </Container>
    </section>
  );
}

export function CtaBand({
  title = "Vad behöver du hjälp med?",
  text = "Berätta vad du försöker göra. Vi hjälper dig hitta tekniken som behövs.",
  primary = { label: "Få hjälp", href: "/kontakt" as Route },
  secondary = { label: "Jag vill bygga något", href: "/kontakt?intent=bygga" as Route },
}: {
  title?: string;
  text?: string;
  primary?: { label: string; href: Route };
  secondary?: { label: string; href: Route } | null;
}) {
  return (
    <section className="py-20 sm:py-28">
      <Container>
        <div className="relative overflow-hidden rounded-3xl border border-line bg-ink-2 px-6 py-14 sm:px-14 sm:py-20">
          <div aria-hidden className="glow absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-berry/25 blur-[100px]" />
          <div aria-hidden className="glow absolute -top-24 -left-24 h-80 w-80 rounded-full bg-grape/25 blur-[100px]" />
          <div className="relative max-w-2xl">
            <h2 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h2>
            <p className="mt-5 text-lg text-muted">{text}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href={primary.href}>{primary.label}</ButtonLink>
              {secondary && (
                <ButtonLink href={secondary.href} variant="ghost">
                  {secondary.label}
                </ButtonLink>
              )}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

export function GroupGrid({ groups }: { groups: { title: string; intro?: string; items: string[] }[] }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {groups.map((g, i) => (
        <Card key={g.title}>
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-2xl font-semibold">{g.title}</h2>
            <span className="font-mono text-xs text-muted">0{i + 1}</span>
          </div>
          {g.intro && <p className="mt-3 text-muted">{g.intro}</p>}
          <Tags items={g.items} className="mt-6" />
        </Card>
      ))}
    </div>
  );
}
