/*
 * Egna produkter. Varje varumärke behåller sin egen identitet – BERRYiT visar
 * dem som exempel på teknisk erfarenhet, inte som BERRYiT-produkter.
 *
 * Endast uppgifter från BERRYiT V2-briefen är ifyllda. Fält som saknar
 * verifierad information (logotyp, screenshots, status, teknikstack, länk)
 * lämnas tomma och döljs i gränssnittet – fyll på här när de bekräftats.
 */
export type Project = {
  slug: string;
  name: string;
  summary: string;
  description?: string;
  platform?: string[];
  tech?: string[];
  features?: string[];
  status?: string;
  url?: string;
  logo?: string;
  screenshots?: string[];
  /** Accentfärg för den genererade projektytan (ingen logotyp ännu). */
  accent: string;
};

export const projects: Project[] = [
  {
    slug: "onarly",
    name: "ONARLY",
    summary: "Digitala plattformar och verktyg för flera branscher.",
    features: ["Produktutveckling", "Webbappar", "Mobilappar", "Realtid", "Cloud", "Backend"],
    accent: "#7b3fe4",
  },
  {
    slug: "onarly-drive",
    name: "ONARLY DRIVE",
    summary: "Boknings-, dispatch- och förarplattform.",
    features: [
      "Kundbokning",
      "Dispatch",
      "Förarapp",
      "Företagsadministration",
      "Betalningar",
      "Prissättning",
      "Multi-tenant",
    ],
    accent: "#e3266f",
  },
  {
    slug: "qabgo",
    name: "QabGo",
    summary: "Kundapp för bokning och hantering av resor.",
    accent: "#f5a524",
  },
  {
    slug: "onarly-performance",
    name: "ONARLY PERFORMANCE",
    summary: "Digital plattform för idrott.",
    features: ["Lagadministration", "Film", "Coaching", "Playbook", "Träning", "Kommunikation", "Analys"],
    accent: "#35e0c1",
  },
  {
    slug: "opera",
    name: "OPERA",
    summary: "Commerce-, POS- och ekonomiplattform.",
    accent: "#4f8cff",
  },
  {
    slug: "printhaus",
    name: "Printhaus",
    summary: "E-handel, designverktyg och produktionsflöden för print.",
    accent: "#ff7a45",
  },
  {
    slug: "triply",
    name: "Triply",
    summary: "Digital reseprodukt och reseupplevelse.",
    accent: "#22c55e",
  },
];

export function getProject(slug: string) {
  return projects.find((p) => p.slug === slug);
}
