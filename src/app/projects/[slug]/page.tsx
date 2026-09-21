import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageMeta } from "@/lib/seo";
import { getProject, projects } from "@/content/projects";
import { ProjectVisual } from "@/components/ProjectCard";
import { Container, CtaBand, Eyebrow, Tags } from "@/components/ui";

export function generateStaticParams() {
  return projects.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(props: PageProps<"/projects/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const p = getProject(slug);
  return p ? pageMeta({ title: p.name, description: p.summary, path: `/projects/${p.slug}` }) : {};
}

export default async function Page(props: PageProps<"/projects/[slug]">) {
  const { slug } = await props.params;
  const project = getProject(slug);
  if (!project) notFound();

  const facts: [string, string[] | string | undefined][] = [
    ["Plattform", project.platform],
    ["Teknik", project.tech],
    ["Status", project.status],
  ];

  return (
    <>
      <section className="border-b border-line pt-32 pb-16 sm:pt-40">
        <Container>
          <Link href="/projects" className="text-sm text-muted hover:text-paper">
            ← Våra projekt
          </Link>
          <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-end">
            <div>
              <Eyebrow>Egen produkt</Eyebrow>
              <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight sm:text-6xl">{project.name}</h1>
              <p className="mt-6 max-w-xl text-lg text-muted sm:text-xl">{project.summary}</p>
              {project.description && <p className="mt-4 max-w-xl text-paper/85">{project.description}</p>}
              {project.url && (
                <a
                  href={project.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-block font-semibold text-berry-2 hover:underline"
                >
                  Besök {project.name} ↗
                </a>
              )}
            </div>
            <ProjectVisual name={project.name} accent={project.accent} className="aspect-[16/10]" />
          </div>
        </Container>
      </section>

      <section className="py-16 sm:py-20">
        <Container>
          <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
            <div>
              {project.features && (
                <>
                  <h2 className="font-display text-2xl font-semibold">Funktioner & områden</h2>
                  <Tags items={project.features} className="mt-5" />
                </>
              )}
              {project.screenshots && project.screenshots.length > 0 && (
                <div className="mt-12 grid gap-4 sm:grid-cols-2">
                  {project.screenshots.map((src) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={src} src={src} alt={`${project.name} – skärmbild`} className="rounded-xl border border-line" />
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-6 self-start rounded-2xl border border-line bg-ink-2 p-6">
              <dl className="space-y-6">
              {facts
                .filter(([, v]) => v && (typeof v === "string" || v.length > 0))
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="font-mono text-xs uppercase tracking-[0.2em] text-muted">{k}</dt>
                    <dd className="mt-1">{Array.isArray(v) ? v.join(", ") : v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-muted">
                {project.name} är ett eget varumärke med egen identitet. Projektet visas här som exempel på vad BERRYiT
                kan bygga.
              </p>
            </div>
          </div>
        </Container>
      </section>

      <CtaBand
        title="Vill du bygga något liknande?"
        text="Berätta om din idé så hjälper vi dig från scope och MVP till drift."
        primary={{ label: "Jag vill bygga något", href: "/kontakt?intent=bygga" }}
        secondary={{ label: "Alla projekt", href: "/projects" }}
      />
    </>
  );
}
