import type { Metadata, Route } from "next";
import { pageMeta } from "@/lib/seo";
import Link from "next/link";
import { areas, pillars, site } from "@/content/site";
import { avGroups, itGroups, smallApps, webBuilds } from "@/content/services";
import { projects } from "@/content/projects";
import { cases } from "@/content/cases";
import { Icon } from "@/components/icons";
import { ProjectCard } from "@/components/ProjectCard";
import { RutHighlight } from "@/components/hemma";
import { hemma } from "@/content/home";
import { ButtonLink, Card, Container, CtaBand, Eyebrow, Section, SectionHeading, Tags } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  description:
    "IT, datorhjälp, nätverk, ljud, ljus, AV, webb, appar och kompletta digitala system. Lokalt i Sjöbo och Skåne – och digitalt i hela Sverige.",
  path: "/",
});

const trust = ["Hemma", "IT", "AV", "Webb", "Appar", "System"];

const homeIcons = ["laptop", "wifi", "printer", "gaming", "tv", "smarthome"];
const businessIcons = ["business", "web", "app", "system"];

export default function Home() {
  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden pt-36 pb-16 sm:pt-48 sm:pb-20">
        <div aria-hidden className="bg-grid absolute inset-0" />
        <div aria-hidden className="glow absolute -top-32 left-1/2 h-[560px] w-[1100px] -translate-x-1/2 rounded-full bg-grape/25 blur-[140px]" />
        <div aria-hidden className="glow absolute top-40 right-[-10%] h-[380px] w-[380px] rounded-full bg-berry/25 blur-[120px]" />
        <Container className="relative">
          <Eyebrow>BERRYiT • Teknik & digitala lösningar</Eyebrow>
          <h1 className="mt-6 max-w-5xl font-display text-5xl leading-[1.02] font-semibold tracking-tight text-balance sm:text-7xl lg:text-8xl">
            Teknik som <span className="text-gradient">bara fungerar.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
            Från datorn, Wi-Fi:t och TV:n hemma till företagets IT, webbplatser, appar och kompletta digitala system.
          </p>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-paper/90 sm:text-xl">
            BERRYiT löser problemen du redan har – och hjälper dig bygga det som ännu inte finns.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <ButtonLink href="/kontakt">Vad behöver du hjälp med?</ButtonLink>
            <ButtonLink href="/kontakt?intent=bygga" variant="ghost">
              Jag vill bygga något
            </ButtonLink>
          </div>
          <ul className="mt-14 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs uppercase tracking-[0.22em] text-muted">
            {trust.map((t, i) => (
              <li key={t} className="flex items-center gap-4">
                {i > 0 && <span aria-hidden className="h-1 w-1 rounded-full bg-berry" />}
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted">{site.area}</p>
        </Container>
      </section>

      {/* TVÅ INGÅNGAR */}
      <section aria-labelledby="ingangar" className="pb-20 sm:pb-28">
        <Container>
          <h2 id="ingangar" className="sr-only">
            Välj ingång
          </h2>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="relative flex flex-col overflow-hidden rounded-3xl border border-berry/40 bg-gradient-to-br from-berry/15 via-ink-2 to-ink-2 p-6 sm:p-10">
              <div className="flex min-h-7 flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-berry-2">För hemmet</p>
              </div>
              <h3 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Teknikhjälp hemma</h3>
              <p className="mt-3 text-lg text-paper/90">{hemma.lead}</p>
              <p className="mt-2 text-muted">Flera saker på samma besök – du behöver inte veta vad problemet heter.</p>
              <RutHighlight className="mt-6" />
              <ul aria-hidden className="mt-7 flex flex-wrap gap-2">
                {homeIcons.map((i) => (
                  <li key={i} className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-fog/[0.05] text-berry-2">
                    <Icon name={i} />
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-wrap items-center gap-4 pt-9">
                <ButtonLink href="/kontakt?kund=hem">Få hjälp hemma</ButtonLink>
                <Link href="/hemma" className="text-sm font-semibold text-paper/85 hover:text-paper">
                  Om BERRYiT HEMMA <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
            <div className="relative flex flex-col overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-grape/15 via-ink-2 to-ink-2 p-6 sm:p-10">
              <div className="flex min-h-7 items-center">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-signal">För företag</p>
              </div>
              <h3 className="mt-5 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                IT, webb, appar och system
              </h3>
              <p className="mt-3 text-lg text-paper/90">Support när det behövs – eller verksamhetens löpande tekniska partner.</p>
              <p className="mt-2 text-muted">Från Microsoft 365 och nätverk till kundportaler och kompletta plattformar.</p>
              <ul aria-hidden className="mt-7 flex flex-wrap gap-2">
                {businessIcons.map((i) => (
                  <li key={i} className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-fog/[0.05] text-signal">
                    <Icon name={i} />
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-wrap items-center gap-4 pt-9">
                <ButtonLink href="/foretag" variant="ghost">
                  BERRYiT för företag
                </ButtonLink>
                <Link href="/kontakt?intent=bygga" className="text-sm font-semibold text-paper/85 hover:text-paper">
                  Jag vill bygga något <span aria-hidden>→</span>
                </Link>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* VAD BEHÖVER DU HJÄLP MED */}
      <Section tone="raised">
        <SectionHeading
          eyebrow="Välj ett område"
          title="Vad behöver du hjälp med?"
          lead="Du behöver inte veta vilken typ av konsult som krävs. Börja med problemet – vi tar det därifrån."
        />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {areas.map((a) => (
            <li key={a.label}>
              <Link
                href={a.href}
                className="group flex h-full flex-col rounded-2xl border border-line bg-ink p-6 transition hover:-translate-y-0.5 hover:border-berry/60"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-fog/[0.05] text-berry-2 transition group-hover:bg-berry group-hover:text-white">
                  <Icon name={a.icon} />
                </span>
                <span className="mt-6 font-display text-xl font-semibold">{a.label}</span>
                <span className="mt-2 text-sm text-muted">{a.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      {/* FRÅN PROBLEM TILL LÖSNING */}
      <Section>
        <SectionHeading
          eyebrow="Från problem till lösning"
          title={
            <>
              Vi möter dig där du är. <span className="text-muted">Fixa, installera, förbättra – eller bygga.</span>
            </>
          }
        />
        <ol className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {pillars.map((p, i) => (
            <li key={p.key} className="relative flex flex-col rounded-2xl border border-line bg-ink-2 p-6">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-berry/15 text-berry-2">
                  <Icon name={p.key} />
                </span>
                <span className="font-mono text-xs text-muted">0{i + 1}</span>
              </div>
              <h3 className="mt-6 font-display text-2xl font-semibold">{p.title}</h3>
              <p className="mt-2 text-paper/90">{p.lead}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-muted">
                {p.items.slice(0, 5).map((it) => (
                  <li key={it} className="flex gap-2">
                    <span aria-hidden className="text-berry">›</span>
                    {it}
                  </li>
                ))}
              </ul>
              <p className="mt-auto pt-6 font-semibold text-signal">{p.outro}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* IT & TEKNIK */}
      <Section tone="raised">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <SectionHeading
              eyebrow="IT & Teknik"
              title="All teknik på ett ställe."
              lead="BERRYiT hjälper till med både vardagsteknik och professionella IT-miljöer."
            />
            <ButtonLink href="/it-teknik" variant="ghost" className="mt-8">
              Allt om IT & teknik
            </ButtonLink>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {itGroups.map((g) => (
              <div key={g.title} className="rounded-2xl border border-line bg-ink p-5">
                <h3 className="font-display text-lg font-semibold">{g.title}</h3>
                <p className="mt-2 text-sm text-muted">{g.items.slice(0, 5).join(" · ")}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* LJUD, LJUS & AV */}
      <Section>
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div className="order-2 grid gap-4 sm:grid-cols-2 lg:order-1">
            {avGroups.map((g) => (
              <div key={g.title} className="rounded-2xl border border-line bg-ink-2 p-5">
                <h3 className="font-display text-lg font-semibold">{g.title}</h3>
                <p className="mt-2 text-sm text-muted">{g.items.slice(0, 5).join(" · ")}</p>
              </div>
            ))}
          </div>
          <div className="order-1 lg:order-2">
            <SectionHeading
              eyebrow="Ljud, ljus & AV"
              title="Teknik behöver inte sitta bakom ett skrivbord."
              lead="PA-system, scenljus, DMX, projektorer, mötesrum och streaming – installerat, konfigurerat och felsökt."
            />
            <ButtonLink href="/ljud-ljus" variant="ghost" className="mt-8">
              Ljud, ljus & AV
            </ButtonLink>
          </div>
        </div>
      </Section>

      {/* WEBB */}
      <Section tone="raised">
        <SectionHeading
          eyebrow="Webb"
          title="Från enkel hemsida till digital plattform."
          lead="Moderna webbplatser för företag, föreningar, organisationer och projekt – från idé och design till lansering och support."
        />
        <Tags items={webBuilds} className="mt-10" />
        <ButtonLink href="/webb" variant="ghost" className="mt-10">
          Så bygger vi webb
        </ButtonLink>
      </Section>

      {/* APPAR & SYSTEM */}
      <Section>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
          <SectionHeading
            eyebrow="Appar & system"
            title="När Excel, papper och manuellt arbete inte räcker."
            lead="En mindre specialbyggd app kan vara lösningen. Och när idén är större bygger vi hela plattformen."
          />
          <Card>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Exempel</p>
            <Tags items={smallApps} className="mt-4" />
            <ButtonLink href="/appar-system" variant="ghost" className="mt-8">
              Appar & system
            </ButtonLink>
          </Card>
        </div>
      </Section>

      {/* HAR DU EN IDÉ */}
      <CtaBand
        title="Har du en idé?"
        text="Du behöver inte komma med en färdig teknisk specifikation. Berätta vad du vill bygga – vi hjälper dig göra den byggbar."
        primary={{ label: "Berätta vad du vill bygga", href: "/kontakt?intent=bygga" }}
        secondary={{ label: "Så arbetar vi", href: "/appar-system" }}
      />

      {/* SAKER VI REDAN HAR BYGGT */}
      <Section tone="raised">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
          <SectionHeading
            eyebrow="Våra appar & system"
            title="Vi bygger också själva."
            lead="BERRYiT utvecklar även egna digitala produkter – och använder samma erfarenhet när vi hjälper våra kunder."
          />
          <ButtonLink href="/projects" variant="ghost" className="shrink-0">
            Alla projekt
          </ButtonLink>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.slice(0, 6).map((p) => (
            <ProjectCard
              key={p.slug}
              href={`/projects/${p.slug}` as Route}
              name={p.name}
              summary={p.summary}
              accent={p.accent}
              tags={p.features}
            />
          ))}
        </div>
      </Section>

      {/* CASES */}
      <Section>
        <SectionHeading eyebrow="Kundcase" title="Projekt vi gjort åt andra." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((c) => (
            <ProjectCard
              key={c.slug}
              href={`/cases/${c.slug}` as Route}
              name={c.client}
              summary={c.summary}
              accent={c.accent}
              meta={c.category}
            />
          ))}
        </div>
      </Section>

      {/* OM */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-2">
          <SectionHeading eyebrow="Om BERRYiT" title="Vi gillar problem." />
          <div className="space-y-5 text-lg leading-relaxed text-muted">
            <p>
              Inte för att problem är roliga för kunden. Utan för att nästan varje tekniskt problem går att bryta ner och
              lösa.
            </p>
            <p>
              BERRYiT är inte bara en datorreparatör, en webbyrå, en apputvecklare eller en AV-tekniker.{" "}
              <span className="text-paper">Vi binder ihop alla dessa områden</span> – så att du kan komma med problemet
              istället för att först behöva veta vem du ska fråga.
            </p>
            <ButtonLink href="/om" variant="ghost">
              Mer om BERRYiT
            </ButtonLink>
          </div>
        </div>
      </Section>

      <CtaBand
        title={site.coreMessage}
        text={`${site.secondaryMessage} Berätta vad du behöver hjälp med.`}
      />
    </>
  );
}
