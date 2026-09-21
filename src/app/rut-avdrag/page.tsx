import type { Metadata } from "next";
import { hemmaOgImage, pageMeta } from "@/lib/seo";
import { rut } from "@/content/home";
import { Icon } from "@/components/icons";
import { ButtonLink, Card, CtaBand, PageHero, Section, SectionHeading } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "RUT-avdrag för IT- och teknikhjälp hemma",
  description:
    "Många IT- och tekniktjänster i hemmet kan omfattas av RUT-avdrag när Skatteverkets villkor är uppfyllda. Avdraget gäller arbetskostnaden – inte material, utrustning eller resor.",
  path: "/rut-avdrag",
  image: hemmaOgImage,
});

/*
 * Sammanfattat från Skatteverkets villkor för "Fiber- och it-tjänster" (rutavdrag),
 * kontrollerat 2026-09-22. Inga procentsatser eller takbelopp anges här – de
 * kan ändras och hänvisas till Skatteverket.
 */
const canQualify = [
  "Installation, reparation och underhåll av datorer, surfplattor, mobiler och spelkonsoler",
  "Skrivare, skannrar, högtalare och mediaspelare",
  "Routrar, wifi-utrustning, bredband och nätverk i bostaden",
  "TV-apparater som kan kopplas upp mot internet",
  "Felsökning samt installation och uppdatering av operativsystem och program",
  "Enklare rådgivning i samband med reparation och installation",
];

const notQualify = [
  "Material, utrustning och reservdelar",
  "Resor och resekostnader",
  "Hjälp via telefon eller på distans",
  "Larm och övervakningskameror",
  "Hushållsutrustning som styrs via app, t.ex. värmepumpar och robotdammsugare",
  "Programmering och kundanpassning av programvara",
];

const conditions = [
  "Arbetet utförs i, eller i nära anslutning till, din bostad.",
  "Avdraget gäller arbetskostnaden.",
  "Du uppfyller Skatteverkets villkor för att få avdraget.",
  "Aktuell procentsats och maxbelopp per år finns hos Skatteverket.",
];

export default function Page() {
  return (
    <>
      <PageHero eyebrow="BERRYiT HEMMA · RUT-avdrag" title="RUT-avdrag för teknikhjälp hemma." lead={rut.statement}>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/kontakt?kund=hem">Få hjälp hemma</ButtonLink>
          <a
            href={rut.skatteverketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-6 py-3 text-sm font-semibold transition hover:border-muted"
          >
            Skatteverket om rot och rut <span aria-hidden>↗</span>
          </a>
        </div>
      </PageHero>

      <Section>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
              <Icon name="check" className="h-6 w-6 text-signal" /> Kan omfattas
            </h2>
            <p className="mt-2 text-sm text-muted">Arbete i hemmet med IT-utrustning som kan kopplas upp mot internet, till exempel:</p>
            <ul className="mt-5 space-y-2.5">
              {canQualify.map((i) => (
                <li key={i} className="flex gap-3 text-paper/90">
                  <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-signal" />
                  {i}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="flex items-center gap-2 font-display text-2xl font-semibold">
              <span aria-hidden className="text-berry-2">×</span> Omfattas inte
            </h2>
            <p className="mt-2 text-sm text-muted">Exempel på sådant som inte ger rätt till RUT-avdrag:</p>
            <ul className="mt-5 space-y-2.5">
              {notQualify.map((i) => (
                <li key={i} className="flex gap-3 text-paper/90">
                  <span aria-hidden className="mt-px w-5 shrink-0 text-center text-berry-2">×</span>
                  {i}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      <Section tone="raised">
        <div className="grid gap-10 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Villkor"
            title="Det här behöver stämma."
            lead="RUT-avdrag är inte automatiskt för alla tjänster. Det är arbetets innehåll och Skatteverkets villkor som avgör."
          />
          <ul className="space-y-3 self-center">
            {conditions.map((c) => (
              <li key={c} className="flex gap-3 rounded-xl border border-line bg-ink px-4 py-3">
                <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-signal" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Speldatorer och nya prylar"
          title="Nytt och byggt från grunden bedöms för sig."
          lead={
            <>
              <p>
                Att installera, felsöka och uppgradera befintlig utrustning hemma är typiskt den sortens arbete som kan
                omfattas. Att bygga en helt ny speldator räknas inte automatiskt som RUT-berättigat – och datorn och
                komponenterna är aldrig en del av avdraget.
              </p>
              <p className="mt-4">Är du osäker? Fråga oss i förväg, så går vi igenom vad som gäller för just ditt besök.</p>
            </>
          }
        />
      </Section>

      <CtaBand
        title="Samla allt på samma besök."
        text="Berätta vad som behöver fungera hemma – så får du veta vad som kan gälla."
        primary={{ label: "Få hjälp hemma", href: "/kontakt?kund=hem" }}
        secondary={{ label: "BERRYiT HEMMA", href: "/hemma" }}
      />
    </>
  );
}
