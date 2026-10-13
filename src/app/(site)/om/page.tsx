import type { Metadata } from "next";
import { pageMeta } from "@/lib/seo";
import { CtaBand, PageHero, Section, Tags } from "@/components/ui";

export const metadata: Metadata = pageMeta({
  title: "Om oss",
  description: "BERRYiT arbetar i gränslandet mellan IT, teknik, AV, webb, appar och system – och ser helheten.",
  path: "/om",
});

const fields = ["IT", "Teknik", "Digital utveckling", "AV", "Webb", "Appar", "System"];
const notJust = ["en datorreparatör.", "en webbyrå.", "en apputvecklare.", "en AV-tekniker."];

export default function Page() {
  return (
    <>
      <PageHero
        eyebrow="Om BERRYiT"
        title="Vi gillar problem."
        lead="Inte för att problem är roliga för kunden. Utan för att nästan varje tekniskt problem går att bryta ner och lösa."
      />
      <Section>
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
              BERRYiT arbetar i gränslandet mellan
            </p>
            <Tags items={fields} className="mt-4" />
            <p className="mt-8 text-lg text-muted">
              Det gör att vi kan se helheten istället för bara en liten del av problemet.
            </p>
          </div>
          <div className="space-y-5 text-lg leading-relaxed">
            <p>
              En kund kanske tror att de behöver en ny dator.{" "}
              <span className="text-muted">Problemet kanske egentligen är nätverket.</span>
            </p>
            <p>
              En verksamhet kanske tror att den behöver ännu ett abonnemang.{" "}
              <span className="text-muted">Den kanske egentligen behöver ett litet eget system.</span>
            </p>
            <p>Och ibland behöver man faktiskt bygga något helt nytt.</p>
            <p className="font-display text-2xl font-semibold text-berry-2">Det är där BERRYiT kommer in.</p>
          </div>
        </div>
      </Section>
      <Section tone="raised">
        <ul className="space-y-2 font-display text-2xl sm:text-4xl">
          {notJust.map((n) => (
            <li key={n} className="text-muted">
              Inte bara <span className="text-paper">{n}</span>
            </li>
          ))}
        </ul>
        <p className="mt-10 max-w-2xl text-lg text-muted">
          BERRYiT binder ihop alla dessa områden. Det gör att du kan komma med{" "}
          <span className="text-paper">problemet</span>, istället för att först behöva veta vilken typ av konsult som
          krävs.
        </p>
      </Section>
      <CtaBand />
    </>
  );
}
