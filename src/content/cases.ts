/*
 * Kundcase. Struktur: Problemet → Lösningen → Vad BERRYiT gjorde → Teknik → Resultatet.
 * Resultat publiceras bara när de är verifierade – annars döljs sektionen.
 */
export type CaseStudy = {
  slug: string;
  client: string;
  category: string;
  summary: string;
  problem: string;
  solution: string;
  work: string[];
  tech?: string[];
  result?: string;
  status?: string;
  accent: string;
};

export const cases: CaseStudy[] = [
  {
    slug: "aurorapark",
    client: "AuroraPark",
    category: "Webb / UX / Digital utveckling",
    summary: "En modern digital presentation av verksamheten.",
    problem: "Kunden behövde en modern digital presentation av verksamheten.",
    solution:
      "En ny webbplats byggd från grunden med tydlig struktur, mobilanpassad design och en genomtänkt digital kundresa.",
    work: ["Struktur", "Design", "Webbutveckling", "Mobilanpassning", "Innehåll", "Digital kundresa"],
    tech: ["Next.js", "TypeScript", "Tailwind CSS", "PostgreSQL"],
    // CONTENT NEEDED: resultat publiceras när sajten är lanserad och kunden godkänt.
    status: "Pågående – ej lanserad",
    accent: "#35e0c1",
  },
];

export function getCase(slug: string) {
  return cases.find((c) => c.slug === slug);
}
