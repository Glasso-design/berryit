import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageMeta } from "@/lib/seo";
import { cases, getCase } from "@/content/cases";
import { ProjectVisual } from "@/components/ProjectCard";
import { Container, CtaBand, Eyebrow, Tags } from "@/components/ui";

export function generateStaticParams() {
  return cases.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata(props: PageProps<"/cases/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const c = getCase(slug);
  return c
    ? pageMeta({ title: `${c.client} – kundcase`, description: `${c.category}. ${c.summary}`, path: `/cases/${c.slug}` })
    : {};
}

export default async function Page(props: PageProps<"/cases/[slug]">) {
  const { slug } = await props.params;
  const cs = getCase(slug);
  if (!cs) notFound();

  const blocks = [
    { n: "01", title: "Problemet", body: <p>{cs.problem}</p> },
    { n: "02", title: "Lösningen", body: <p>{cs.solution}</p> },
    { n: "03", title: "Vad BERRYiT gjorde", body: <Tags items={cs.work} /> },
    cs.tech && { n: "04", title: "Teknik", body: <Tags items={cs.tech} /> },
    cs.result && { n: "05", title: "Resultatet", body: <p>{cs.result}</p> },
  ].filter(Boolean) as { n: string; title: string; body: React.ReactNode }[];

  return (
    <>
      <section className="border-b border-line pt-32 pb-16 sm:pt-40">
        <Container>
          <Link href="/projects#cases" className="text-sm text-muted hover:text-paper">
            ← Projekt & cases
          </Link>
          <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-end">
            <div>
              <Eyebrow>Kundcase · {cs.category}</Eyebrow>
              <h1 className="mt-5 font-display text-4xl font-semibold tracking-tight sm:text-6xl">{cs.client}</h1>
              <p className="mt-6 max-w-xl text-lg text-muted sm:text-xl">{cs.summary}</p>
              {cs.status && (
                <p className="mt-6 inline-flex rounded-full border border-line px-3 py-1 font-mono text-xs uppercase tracking-[0.18em] text-signal">
                  {cs.status}
                </p>
              )}
            </div>
            <ProjectVisual name={cs.client} accent={cs.accent} className="aspect-[16/10]" />
          </div>
        </Container>
      </section>

      <section className="py-16 sm:py-24">
        <Container>
          <ol className="divide-y divide-line border-y border-line">
            {blocks.map((b) => (
              <li key={b.title} className="grid gap-4 py-10 md:grid-cols-[80px_240px_1fr]">
                <span className="font-mono text-sm text-berry-2">{b.n}</span>
                <h2 className="font-display text-2xl font-semibold">{b.title}</h2>
                <div className="text-lg leading-relaxed text-paper/85">{b.body}</div>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <CtaBand
        title="Behöver din verksamhet något liknande?"
        text="Berätta vad ni vill uppnå så föreslår vi en rimlig väg dit."
        primary={{ label: "Kontakta oss", href: "/kontakt?intent=bygga&area=webb" }}
        secondary={null}
      />
    </>
  );
}
