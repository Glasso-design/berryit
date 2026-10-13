import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { avGroups } from "@/content/services";
import { CtaBand, GroupGrid, PageHero, Section } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "Ljud, ljus & AV",
  description: "Hjälp med ljud, ljus och AV-teknik i Skåne: PA-system, scenljus, DMX, projektorer, mötesrum, streaming och teknik för event och mindre produktioner.",
  path: "/ljud-ljus",
});

export default function Page() {
  return (
    <>
      <PageHero
        eyebrow="Ljud, ljus & AV"
        title="Teknik behöver inte sitta bakom ett skrivbord."
        lead="BERRYiT hjälper även med ljud, ljus och annan AV-teknik – för mötesrummet, scenen, föreningen och eventet."
      />
      <Section>
        <GroupGrid groups={avGroups} />
      </Section>
      <CtaBand
        title="Har du ett event eller en lokal som ska låta och synas bra?"
        text="Berätta vad som ska hända och vad ni har idag. Vi hjälper er med tekniken."
        primary={{ label: "Få hjälp", href: "/kontakt?area=ljud" }}
        secondary={null}
      />
    </>
  );
}
