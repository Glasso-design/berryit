import type { Metadata } from "next";
import Link from "next/link";
import { hemmaOgImage, pageMeta } from "@/lib/seo";
import { hemma, homeServices, smartHome, visitScenario } from "@/content/home";
import { HemmaLockup, HomeServiceGrid, RutCallout, RutHighlight, SunvoltPartner } from "@/components/hemma";
import { Icon } from "@/components/icons";
import { ButtonLink, Container, CtaBand, Eyebrow, Section, SectionHeading } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "BERRYiT HEMMA – Hela hemmets teknik. Ett ställe.",
  absoluteTitle: true,
  description:
    "Hela hemmets teknik. Ett ställe. Dator, Wi-Fi, skrivare, gaming, TV, ljud och smart hem – flera saker på samma besök. Sjöbo och Skåne. RUT-avdrag kan gälla.",
  path: "/hemma",
  image: hemmaOgImage,
});

export default function Page() {
  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-line pt-32 pb-20 sm:pt-44 sm:pb-28">
        <div aria-hidden className="bg-grid absolute inset-0" />
        <div aria-hidden className="glow absolute -top-40 right-[-10%] h-[520px] w-[720px] rounded-full bg-berry/20 blur-[130px]" />
        <div aria-hidden className="glow absolute bottom-[-30%] left-[-10%] h-[420px] w-[620px] rounded-full bg-grape/20 blur-[130px]" />
        <Container className="relative">
          <HemmaLockup size="lg" />
          <h1 className="mt-10 max-w-4xl font-display text-5xl leading-[1.03] font-semibold tracking-tight text-balance sm:text-7xl">
            Hela hemmets teknik.
            <br />
            <span className="text-berry-2">Ett ställe.</span>
          </h1>
          <p className="mt-7 max-w-2xl text-lg text-paper/90 sm:text-xl">{hemma.lead}</p>
          <p className="mt-3 max-w-2xl text-lg text-muted">{hemma.multi}</p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <ButtonLink href="/kontakt?kund=hem">Få hjälp hemma</ButtonLink>
            <ButtonLink href="/teknikhjalp-hemma" variant="ghost">
              Det här hjälper vi med
            </ButtonLink>
          </div>
          <RutHighlight className="mt-8 max-w-xl" />
        </Container>
      </section>

      {/* TJÄNSTEOMRÅDEN */}
      <Section>
        <SectionHeading
          eyebrow="Det här fixar vi hemma"
          title="Allt som har en sladd, en app eller ett lösenord."
          lead={hemma.categoryNote}
        />
        <div className="mt-12">
          <HomeServiceGrid services={homeServices} />
        </div>
        <Link href="/teknikhjalp-hemma" className="mt-8 inline-flex font-semibold text-berry-2 hover:underline">
          Se allt vi hjälper med <span aria-hidden className="ml-1">→</span>
        </Link>
      </Section>

      {/* SAMMA BESÖK */}
      <Section tone="raised">
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <SectionHeading
              eyebrow="Ett besök – flera lösningar"
              title="Samla allt på samma besök."
              lead="Du behöver inte veta om det är IT, AV eller nätverk. Skriv ner allt som krånglar, så tar vi det i tur och ordning när vi ändå är på plats."
            />
            <ButtonLink href="/kontakt?kund=hem" className="mt-8">
              Boka ett besök
            </ButtonLink>
          </div>
          <div className="rounded-3xl border border-line bg-ink p-6 sm:p-8">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">Exempel på ett besök</p>
            <ol className="mt-5 space-y-3">
              {visitScenario.map((task, i) => (
                <li key={task} className="flex items-center gap-4 rounded-xl border border-line bg-ink-2 px-4 py-3">
                  <span className="font-mono text-xs text-berry-2">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1">{task}</span>
                  <Icon name="check" className="h-5 w-5 shrink-0 text-signal" />
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Section>

      {/* RUT */}
      <Section>
        <RutCallout />
      </Section>

      {/* SMART HEM */}
      <Section tone="raised">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <SectionHeading
            eyebrow="Smart hem"
            title="Uppkopplade prylar som fungerar tillsammans."
            lead="Wi-Fi, högtalare, TV, hubbar och appar – vi får hemmets uppkopplade teknik att prata med varandra."
          />
          <div>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {smartHome.areas.slice(0, 6).map((a) => (
                <li key={a.title} className="flex items-center gap-2 rounded-xl border border-line bg-ink px-3 py-2.5 text-sm">
                  <Icon name="check" className="h-4 w-4 shrink-0 text-signal" />
                  {a.title}
                </li>
              ))}
            </ul>
            <ButtonLink href="/smart-hem" variant="ghost" className="mt-6">
              Läs om smart hem
            </ButtonLink>
          </div>
        </div>
      </Section>

      {/* SUNVOLT */}
      <section id="energi" className="scroll-mt-24 py-20 sm:py-28">
        <Container>
          <Eyebrow>Energi</Eyebrow>
          <div className="mt-6">
            <SunvoltPartner />
          </div>
        </Container>
      </section>

      <CtaBand
        title="Vad behöver fungera hemma?"
        text={hemma.categoryNote}
        primary={{ label: "Få hjälp hemma", href: "/kontakt?kund=hem" }}
        secondary={{ label: "Om RUT-avdrag", href: "/rut-avdrag" }}
      />
    </>
  );
}
