import type { Metadata } from "next";
import { hemmaOgImage, pageMeta } from "@/lib/seo";
import { hemma, homeServices, visitSteps } from "@/content/home";
import { HomeServiceGrid, RutCallout, RutHighlight } from "@/components/hemma";
import { ButtonLink, CtaBand, PageHero, Section, SectionHeading } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "Teknikhjälp hemma",
  description:
    "Datorhjälp och teknikhjälp hemma i Sjöbo och Skåne: dator, Wi-Fi, skrivare, gaming, TV, ljud, mobil och smart hem. Flera saker på samma besök.",
  path: "/teknikhjalp-hemma",
  image: hemmaOgImage,
});

export default function Page() {
  return (
    <>
      <PageHero
        eyebrow="BERRYiT HEMMA · Teknikhjälp hemma"
        title="Teknikhjälp utan teknikspråk."
        lead={`${hemma.lead} ${hemma.categoryNote}`}
      >
        <ButtonLink href="/kontakt?kund=hem">Få hjälp hemma</ButtonLink>
        <RutHighlight className="mt-8 max-w-xl" />
      </PageHero>

      <Section>
        <SectionHeading eyebrow="Tjänsteområden" title="Det här hjälper vi med hemma." />
        <div className="mt-12">
          <HomeServiceGrid services={homeServices} detailed />
        </div>
      </Section>

      <Section tone="raised">
        <SectionHeading
          eyebrow="Så går ett besök till"
          title="Ett besök. Flera saker lösta."
          lead="Samla allt som krånglar på samma lista – det sparar tid för dig."
        />
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {visitSteps.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-line bg-ink p-6">
              <span className="font-mono text-xs text-berry-2">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-3 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section>
        <RutCallout />
      </Section>

      <CtaBand
        title="Berätta vad som krånglar."
        text="Stort eller litet – och gärna flera saker på en gång."
        primary={{ label: "Få hjälp hemma", href: "/kontakt?kund=hem" }}
        secondary={{ label: "Till BERRYiT HEMMA", href: "/hemma" }}
      />
    </>
  );
}
