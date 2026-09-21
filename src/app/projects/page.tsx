import type { Metadata, Route } from "next";
import { pageMeta } from "@/lib/seo";
import { projects } from "@/content/projects";
import { cases } from "@/content/cases";
import { ProjectCard } from "@/components/ProjectCard";
import { CtaBand, PageHero, Section, SectionHeading } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "Våra projekt",
  description: "Egna produkter och kundcase – exempel på appar, plattformar och system som BERRYiT har byggt.",
  path: "/projects",
});

export default function Page() {
  return (
    <>
      <PageHero
        eyebrow="Våra appar & system"
        title="Vi bygger också själva."
        lead="BERRYiT arbetar inte bara med kundprojekt. Vi utvecklar även egna digitala produkter och använder samma erfarenhet när vi hjälper våra kunder."
      />
      <Section>
        <SectionHeading
          eyebrow="Egna produkter"
          title="Saker vi redan har byggt."
          lead="Projekten visas som exempel på teknisk erfarenhet och vad vi kan bygga. Varje varumärke behåller sin egen identitet."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard
              key={p.slug}
              href={`/projects/${p.slug}` as Route}
              name={p.name}
              summary={p.summary}
              accent={p.accent}
              meta={p.status}
              tags={p.features}
            />
          ))}
        </div>
      </Section>
      <Section tone="raised" id="cases">
        <SectionHeading eyebrow="Kundcase" title="Projekt vi gjort åt andra." />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {cases.map((c) => (
            <ProjectCard
              key={c.slug}
              href={`/cases/${c.slug}` as Route}
              name={c.client}
              summary={c.summary}
              accent={c.accent}
              meta={c.category}
              tags={c.work}
            />
          ))}
        </div>
      </Section>
      <CtaBand
        title="Nästa projekt kan vara ditt."
        text="Berätta om idén – stor eller liten."
        primary={{ label: "Jag vill bygga något", href: "/kontakt?intent=bygga" }}
        secondary={null}
      />
    </>
  );
}
