import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { itGroups, sustainableActions } from "@/content/services";
import { CtaBand, GroupGrid, PageHero, Section, SectionHeading, Tags } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "IT & Teknik",
  description:
    "IT-hjälp och IT-support i Sjöbo och Skåne: datorer, mobiler, nätverk, Wi-Fi och företags-IT. Installation, felsökning, uppgraderingar och säkerhet.",
  path: "/it-teknik",
});

export default function Page() {
  return (
    <>
      <PageHero
        eyebrow="IT & Teknik"
        title="All teknik på ett ställe."
        lead="BERRYiT hjälper till med både vardagsteknik och professionella IT-miljöer – från den krånglande datorn till företagets nätverk, konton och servrar."
      />
      <Section>
        <GroupGrid groups={itGroups} />
      </Section>
      <Section tone="raised">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <SectionHeading
            eyebrow="Hållbar teknik"
            title="Köp inte nytt innan vi har tittat på det."
            lead={
              <>
                <p>
                  En långsam dator behöver inte alltid ersättas. Ett nätverk behöver inte alltid byggas om. Och ett
                  gammalt system behöver inte alltid kastas.
                </p>
                <p className="mt-4">BERRYiT försöker hitta en lösning som är rimlig både tekniskt och ekonomiskt.</p>
              </>
            }
          />
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Ibland räcker det att</p>
            <Tags items={sustainableActions} className="mt-4" />
          </div>
        </div>
      </Section>
      <CtaBand secondary={null} />
    </>
  );
}
