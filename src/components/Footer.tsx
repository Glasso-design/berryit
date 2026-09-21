import Link from "next/link";
import type { Route } from "next";
import { site } from "@/content/site";
import { projects } from "@/content/projects";
import { Container } from "./ui";
import { Logo } from "./Logo";

const cols: { title: string; links: { label: string; href: Route }[] }[] = [
  {
    title: "Tjänster",
    links: [
      { label: "IT & Teknik", href: "/it-teknik" },
      { label: "Ljud, ljus & AV", href: "/ljud-ljus" },
      { label: "Webb", href: "/webb" },
      { label: "Appar & System", href: "/appar-system" },
    ],
  },
  {
    title: "För dig",
    links: [
      { label: "Privatpersoner", href: "/privat" },
      { label: "Företag", href: "/foretag" },
      { label: "Om BERRYiT", href: "/om" },
      { label: "Kontakt", href: "/kontakt" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink-2">
      <Container className="py-16">
        <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo className="text-2xl" />
            <p className="mt-4 max-w-sm text-paper/90">{site.coreMessage}</p>
            <p className="mt-3 max-w-sm text-muted">{site.oneLiner}</p>
            <p className="mt-4 text-sm text-muted">{site.area}</p>
            {(site.contact.email || site.contact.phone) && (
              <ul className="mt-6 space-y-1 text-sm">
                {site.contact.email && (
                  <li>
                    <a href={`mailto:${site.contact.email}`} className="hover:text-berry-2">
                      {site.contact.email}
                    </a>
                  </li>
                )}
                {site.contact.phone && (
                  <li>
                    <a href={`tel:${site.contact.phone.replace(/[^+\d]/g, "")}`} className="hover:text-berry-2">
                      {site.contact.phone}
                    </a>
                  </li>
                )}
              </ul>
            )}
          </div>
          {cols.map((col) => (
            <div key={col.title}>
              <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">{col.title}</h2>
              <ul className="mt-4 space-y-2">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-paper/85 hover:text-paper">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Byggt av oss</h2>
            <ul className="mt-4 space-y-2">
              {projects.map((p) => (
                <li key={p.slug}>
                  <Link href={`/projects/${p.slug}`} className="text-paper/85 hover:text-paper">
                    {p.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-16 flex flex-col justify-between gap-4 border-t border-line pt-8 text-sm text-muted sm:flex-row">
          <p>
            © {new Date().getFullYear()} {site.name}
            {site.contact.orgNr && ` · Org.nr ${site.contact.orgNr}`}
          </p>
          <p className="font-mono text-xs uppercase tracking-[0.2em]">{site.secondaryMessage}</p>
        </div>
      </Container>
    </footer>
  );
}
