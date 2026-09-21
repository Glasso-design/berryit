import type { Route } from "next";

export const site = {
  name: "BERRYiT",
  tagline: "Teknik som bara fungerar.",
  oneLiner:
    "BERRYiT hjälper människor och företag med teknik – från den krånglande datorn till den kompletta digitala plattformen.",
  coreMessage: "Vi fixar tekniken du har och hjälper dig bygga tekniken du behöver.",
  secondaryMessage: "Från ett litet problem till en stor idé.",
  area: "Lokalt i Sjöbo och Skåne – och digitalt för kunder långt utanför Skåne.",
  /*
   * CONTENT NEEDED: telefon, e-post, org.nr och adress är inte verifierade.
   * Lämna null tills ägaren bekräftat – sidan visar då bara formuläret.
   */
  contact: {
    email: null as string | null,
    phone: null as string | null,
    orgNr: null as string | null,
  },
};

export type NavItem = { label: string; href: Route };

export const mainNav: NavItem[] = [
  { label: "Start", href: "/" },
  { label: "Hemma", href: "/hemma" },
  { label: "IT & Teknik", href: "/it-teknik" },
  { label: "Ljud & Ljus", href: "/ljud-ljus" },
  { label: "Webb", href: "/webb" },
  { label: "Appar & System", href: "/appar-system" },
  { label: "Företag", href: "/foretag" },
  { label: "Våra projekt", href: "/projects" },
  { label: "Om oss", href: "/om" },
  { label: "Kontakt", href: "/kontakt" },
];

export const primaryCta: NavItem = { label: "Få hjälp", href: "/kontakt" };

export const areas: { label: string; href: Route; text: string; icon: string }[] = [
  { label: "IT", href: "/it-teknik", text: "Datorer, mobiler, nätverk och företags-IT.", icon: "it" },
  { label: "Ljud & ljus", href: "/ljud-ljus", text: "PA, scenljus, AV och event.", icon: "av" },
  { label: "Webb", href: "/webb", text: "Från enkel hemsida till digital plattform.", icon: "web" },
  { label: "Appar", href: "/appar-system", text: "Mindre appar, mobilappar och webbappar.", icon: "app" },
  { label: "System", href: "/appar-system", text: "Bokning, kundportaler och administration.", icon: "system" },
];

export const pillars = [
  {
    key: "fixa",
    title: "Fixa",
    lead: "Något fungerar inte.",
    items: [
      "Datorn krånglar.",
      "Mobilen behöver konfigureras.",
      "Wi-Fi är dåligt.",
      "Ljudet fungerar inte.",
      "En webbplats har problem.",
      "Ett system behöver felsökas.",
    ],
    outro: "Vi hjälper dig lösa det.",
  },
  {
    key: "installera",
    title: "Installera",
    lead: "Du har köpt eller ska installera teknik.",
    items: ["Datorer", "Mobiler", "Nätverk & Wi-Fi", "Skrivare", "Ljud & ljus", "Bildskärmar & AV", "Servrar", "Programvara"],
    outro: "Vi hjälper dig få allt på plats och fungerande.",
  },
  {
    key: "forbattra",
    title: "Förbättra",
    lead: "Tekniken fungerar, men inte tillräckligt bra.",
    items: ["Optimera", "Modernisera", "Uppgradera", "Automatisera", "Säkra", "Integrera", "Förenkla"],
    outro: "Vi gör det du har bättre.",
  },
  {
    key: "bygga",
    title: "Bygga",
    lead: "Du behöver något som inte finns.",
    items: [
      "En hemsida",
      "En mindre app",
      "Ett internt verktyg",
      "Ett bokningssystem",
      "En kundportal",
      "En dashboard",
      "En mobilapp",
      "Ett större komplett system",
    ],
    outro: "Vi hjälper dig från idé till fungerande produkt.",
  },
] as const;

export const devLevels = [
  {
    name: "SMALL",
    title: "För mindre lösningar.",
    items: ["Enklare webbapp", "Intern app", "Dashboard", "Formulärsystem", "Automation", "Bokningsfunktion", "Mindre kundportal"],
  },
  {
    name: "BUILD",
    title: "För kompletta appar och system.",
    items: ["Mobilapp", "SaaS", "Bokningsplattform", "Företagssystem", "Medlemssystem", "Kundplattform"],
  },
  {
    name: "PARTNER",
    title: "För större idéer och en långsiktig teknisk partner.",
    items: [
      "Produktutveckling & krav",
      "Arkitektur & roadmap",
      "Frontend & backend",
      "Databas & API",
      "QA",
      "Hosting & drift",
      "Vidareutveckling",
    ],
  },
] as const;
