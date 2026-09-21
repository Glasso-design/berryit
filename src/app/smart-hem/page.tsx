import type { Metadata } from "next";
import Link from "next/link";
import { hemmaOgImage, pageMeta } from "@/lib/seo";
import { smartHome } from "@/content/home";
import { SunvoltPartner } from "@/components/hemma";
import { Icon } from "@/components/icons";
import { ButtonLink, Card, CtaBand, PageHero, Section, SectionHeading } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "Smart hem",
  description:
    "Smart hem som fungerar: Wi-Fi och mesh, uppkopplad media, högtalare, hubbar, appar och uppkopplade enheter – installation och felsökning i Sjöbo och Skåne.",
  path: "/smart-hem",
  image: hemmaOgImage,
});

export default function Page() {
  return (
    <>
      <PageHero
        eyebrow="BERRYiT HEMMA · Smart hem"
        title="Smart hem som faktiskt är smart."
        lead={smartHome.together}
      >
        <ButtonLink href="/kontakt?kund=hem&area=smarthem">Få hjälp med smart hem</ButtonLink>
      </PageHero>

      <Section>
        <SectionHeading eyebrow="Det här hjälper vi med" title="Från nätverket och uppåt." />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {smartHome.areas.map((a) => (
            <li key={a.title} className="rounded-2xl border border-line bg-ink-2 p-5">
              <Icon name="check" className="h-5 w-5 text-signal" />
              <h3 className="mt-3 font-display text-lg font-semibold">{a.title}</h3>
              <p className="mt-1.5 text-sm text-muted">{a.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="raised">
        <div className="grid gap-8 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Så jobbar vi"
            title="Grunden först."
            lead="De flesta problem i ett smart hem börjar i nätverket. Därför börjar vi där – och bygger vidare med rätt appar, konton och inställningar så att enheterna fungerar tillsammans."
          />
          <Card className="self-start bg-ink">
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-signal">
              <Icon name="receipt" className="h-4 w-4" /> Om RUT och smart hem
            </p>
            <p className="mt-4 text-paper/90">
              RUT-avdrag kan gälla för arbete med IT-utrustning i hemmet, till exempel nätverk, routrar och vissa
              uppkopplade mediaenheter. Allt smart hem omfattas inte – exempelvis larm, kameror och hushållsutrustning som
              styrs via en app ger enligt Skatteverket inte rätt till RUT-avdrag.
            </p>
            <Link href="/rut-avdrag" className="mt-4 inline-flex font-semibold text-signal hover:underline">
              Läs mer om RUT-avdrag <span aria-hidden className="ml-1">→</span>
            </Link>
          </Card>
        </div>
      </Section>

      <Section>
        <SunvoltPartner />
      </Section>

      <CtaBand
        title="Vilka prylar ska fungera ihop?"
        text="Lista dem – så tar vi det därifrån."
        primary={{ label: "Få hjälp hemma", href: "/kontakt?kund=hem&area=smarthem" }}
        secondary={{ label: "BERRYiT HEMMA", href: "/hemma" }}
      />
    </>
  );
}
