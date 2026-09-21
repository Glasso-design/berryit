import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { privateServices } from "@/content/services";
import { ButtonLink, CtaBand, PageHero, Section } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "Privatpersoner",
  description:
    "Datorhjälp och teknikhjälp utan teknikspråk i Sjöbo och Skåne – datorer, mobiler, Wi-Fi, TV, ljud, skrivare, backup och smarta hem.",
  path: "/privat",
});

export default function Page() {
  return (
    <>
      <PageHero
        eyebrow="För privatpersoner"
        title="Teknikhjälp utan teknikspråk."
        lead="Du behöver inte veta vad problemet heter. Berätta bara vad som inte fungerar."
      >
        <ButtonLink href="/kontakt">Få hjälp</ButtonLink>
      </PageHero>
      <Section>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {privateServices.map((s) => (
            <li key={s} className="rounded-2xl border border-line bg-ink-2 px-6 py-5 font-display text-lg font-semibold">
              {s}
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title="Vad fungerar inte?" text="Beskriv det med dina egna ord. Vi översätter." secondary={null} />
    </>
  );
}
