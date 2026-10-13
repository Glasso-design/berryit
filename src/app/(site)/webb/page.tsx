import type { Metadata, Route } from "next";
import { pageMeta } from "@/lib/seo";
import { webBuilds, webProcess } from "@/content/services";
import { CtaBand, PageHero, Section, SectionHeading } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "Webb",
  description: "Webbutveckling från Sjöbo: företagshemsidor, landningssidor, e-handel, kundportaler och webbappar – från idé till lansering och support.",
  path: "/webb",
});

export default function Page() {
  return (
    <>
      <PageHero
        eyebrow="Webb"
        title="Från enkel hemsida till digital plattform."
        lead="BERRYiT bygger moderna webbplatser för företag, föreningar, organisationer och projekt. Och eftersom vi också jobbar med IT, appar och system slutar det inte vid hemsidan."
      />
      <Section>
        <SectionHeading eyebrow="Vi kan bygga" title="Det du behöver – inte en mall." />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {webBuilds.map((w, i) => (
            <li key={w} className="flex items-center justify-between rounded-2xl border border-line bg-ink-2 px-6 py-5">
              <span className="font-display text-lg font-semibold">{w}</span>
              <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section tone="raised">
        <SectionHeading
          eyebrow="Hela processen"
          title="Vi hjälper med hela processen."
          lead="Du behöver inte samordna designer, utvecklare, webbhotell och domän själv."
        />
        <ol className="mt-12 flex flex-wrap items-center gap-2">
          {webProcess.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span className="rounded-full border border-line bg-ink px-4 py-2 text-sm">{step}</span>
              {i < webProcess.length - 1 && (
                <span aria-hidden className="text-berry">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
      </Section>
      <CtaBand
        title="Behöver du en ny webbplats?"
        text="Eller behöver den du har bli bättre? Berätta vad du vill uppnå."
        primary={{ label: "Berätta om ditt projekt", href: "/kontakt?intent=bygga&area=webb" }}
        secondary={{ label: "Se kundcase", href: "/cases/aurorapark" as Route }}
      />
    </>
  );
}
