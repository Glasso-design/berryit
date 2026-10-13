import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { devLevels } from "@/content/site";
import { bigProducts, buildFlow, ideaHelp, smallApps, smallSystems } from "@/content/services";
import { ButtonLink, Card, CtaBand, PageHero, Section, SectionHeading, Tags } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "Appar & System",
  description: "Mindre appar, interna system, mobilappar, SaaS och kompletta plattformar – från idé till drift.",
  path: "/appar-system",
});

export default function Page() {
  return (
    <>
      <PageHero
        eyebrow="Appar & System"
        title="Har du en idé? Vi hjälper dig bygga den."
        lead="BERRYiT arbetar inte bara med färdiga produkter. Vi utvecklar också nya digitala lösningar – små som stora."
      >
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/kontakt?intent=bygga">Jag vill bygga något</ButtonLink>
          <ButtonLink href="/projects" variant="ghost">
            Se vad vi har byggt
          </ButtonLink>
        </div>
      </PageHero>

      <Section>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="font-display text-2xl font-semibold">Mindre appar</h2>
            <p className="mt-3 text-muted">
              När Excel, papper eller manuellt arbete börjar bli för begränsat kan en mindre specialbyggd app vara
              lösningen.
            </p>
            <Tags items={smallApps} className="mt-6" />
          </Card>
          <Card>
            <h2 className="font-display text-2xl font-semibold">Mindre system</h2>
            <p className="mt-3 text-muted">För verksamheter som behöver mer struktur.</p>
            <Tags items={smallSystems} className="mt-6" />
          </Card>
        </div>
      </Section>

      <Section tone="raised">
        <SectionHeading
          eyebrow="Större appar & system"
          title="När idén är större."
          lead="BERRYiT hjälper även företag och entreprenörer som vill bygga större produkter."
        />
        <ol className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {buildFlow.map((step, i) => (
            <li key={step} className="rounded-2xl border border-line bg-ink p-4">
              <span className="font-mono text-xs text-berry-2">{String(i + 1).padStart(2, "0")}</span>
              <p className="mt-2 font-display font-semibold">{step}</p>
            </li>
          ))}
        </ol>
        <p className="mt-12 font-mono text-xs uppercase tracking-[0.2em] text-muted">Det kan handla om</p>
        <Tags items={bigProducts} className="mt-4" />
      </Section>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <SectionHeading
              eyebrow="Ingen spec? Inga problem."
              title="Du behöver inte komma med en färdig teknisk specifikation."
            />
            <blockquote className="mt-8 border-l-2 border-berry pl-5 font-display text-2xl text-paper">
              ”Jag har en idé.”
            </blockquote>
            <p className="mt-4 text-lg text-muted">Det räcker. BERRYiT hjälper till att göra den byggbar.</p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Vi hjälper till med</p>
            <Tags items={ideaHelp} className="mt-4" />
          </div>
        </div>
      </Section>

      <Section tone="raised">
        <SectionHeading eyebrow="Tre nivåer" title="Utveckling i den storlek du behöver." />
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {devLevels.map((lvl, i) => (
            <div
              key={lvl.name}
              className={`flex flex-col rounded-2xl border p-6 sm:p-8 ${
                i === 1 ? "border-berry/60 bg-gradient-to-b from-berry/10 to-ink" : "border-line bg-ink"
              }`}
            >
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">BERRYiT</p>
              <h3 className="mt-1 font-display text-3xl font-bold tracking-tight">{lvl.name}</h3>
              <p className="mt-3 text-paper/90">{lvl.title}</p>
              <ul className="mt-6 space-y-2 text-sm text-muted">
                {lvl.items.map((it) => (
                  <li key={it} className="flex gap-2">
                    <span aria-hidden className="text-signal">
                      ✓
                    </span>
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand
        title="Berätta vad du vill bygga."
        text="En idé, ett problem eller en skiss räcker för att börja."
        primary={{ label: "Starta ett projekt", href: "/kontakt?intent=bygga" }}
        secondary={null}
      />
    </>
  );
}
