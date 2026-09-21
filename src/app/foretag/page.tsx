import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { aiUses, automationFlows, businessServices } from "@/content/services";
import { Card, CtaBand, PageHero, Section, SectionHeading, Tags } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "Företag",
  description: "IT-support, nätverk, Microsoft 365, säkerhet, AV, webb, appar, automation och AI – en teknisk partner för hela verksamheten.",
  path: "/foretag",
});

export default function Page() {
  return (
    <>
      <PageHero
        eyebrow="Företag"
        title="En teknisk partner för hela verksamheten."
        lead="Support när det behövs – eller företagets löpande tekniska partner."
      >
        <Tags items={businessServices} />
      </PageHero>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Automation & integrationer"
            title="Låt systemen göra mer av jobbet."
            lead={
              <>
                <p>
                  Många företag använder flera olika system som inte pratar med varandra. BERRYiT kan hjälpa till att
                  koppla ihop dem.
                </p>
                <p className="mt-4 text-paper">
                  Målet är inte automation för automationens skull. Målet är att minska manuellt arbete.
                </p>
              </>
            }
          />
          <ul className="grid content-start gap-3 sm:grid-cols-2">
            {automationFlows.map(([from, to]) => (
              <li
                key={from + to}
                className="flex items-center gap-3 rounded-xl border border-line bg-ink-2 px-4 py-3 text-sm"
              >
                <span>{from}</span>
                <span aria-hidden className="text-berry">
                  →
                </span>
                <span className="text-muted">{to}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section tone="raised">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <SectionHeading
            eyebrow="AI"
            title="AI när det faktiskt gör nytta."
            lead="AI ska användas där det ger verkligt värde – inte för att det låter modernt."
          />
          <Card className="bg-ink">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">BERRYiT kan hjälpa med AI för</p>
            <Tags items={aiUses} className="mt-4" />
          </Card>
        </div>
      </Section>

      <CtaBand
        title="Vad behöver verksamheten?"
        text="Ett akut problem, ett projekt eller en långsiktig teknisk partner – börja med att berätta."
        primary={{ label: "Kontakta oss", href: "/kontakt?area=foretags-it" }}
        secondary={{ label: "Appar & system", href: "/appar-system" }}
      />
    </>
  );
}
