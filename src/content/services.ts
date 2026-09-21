export type ServiceGroup = { title: string; intro?: string; items: string[] };

export const itGroups: ServiceGroup[] = [
  {
    title: "Datorer",
    items: [
      "Windows",
      "Installation",
      "Felsökning",
      "Uppgraderingar",
      "Prestanda",
      "Program",
      "Backup",
      "Dataöverföring",
      "Nya datorer",
      "Gamla datorer",
    ],
  },
  {
    title: "Mobiler & surfplattor",
    items: ["Installation", "Konton", "E-post", "Appar", "Synkronisering", "Backup", "Överföring", "Säkerhet", "Felsökning"],
  },
  {
    title: "Nätverk",
    items: ["Wi-Fi", "Mesh", "Router", "Switch", "Accesspunkter", "VPN", "Brandvägg", "Kabelnätverk", "Företagsnätverk"],
  },
  {
    title: "Företags-IT",
    items: [
      "Microsoft 365",
      "Google Workspace",
      "Windows Server",
      "Active Directory",
      "Användare & grupper",
      "Behörigheter",
      "Enheter",
      "Backup",
      "Säkerhet",
      "Cloud",
      "Support",
    ],
  },
];

export const avGroups: ServiceGroup[] = [
  {
    title: "Ljud",
    items: [
      "PA-system",
      "Högtalare",
      "Mixer",
      "Mikrofoner",
      "Trådlösa system",
      "Signalvägar",
      "Installation",
      "Felsökning",
      "Konfiguration",
    ],
  },
  {
    title: "Ljus",
    items: ["Eventljus", "Scenljus", "Styrning", "DMX", "Installation", "Programmering", "Felsökning"],
  },
  {
    title: "Bild & AV",
    items: [
      "Projektorer",
      "TV",
      "Displays",
      "Presentationsteknik",
      "Streaming",
      "Kameror",
      "Mötesrum",
      "Digital signage",
    ],
  },
  {
    title: "Event & produktion",
    intro: "BERRYiT kan hjälpa med tekniken för:",
    items: ["Företagsevent", "Föreningar", "Scener", "Presentationer", "Möten", "Streaming", "Mindre produktioner"],
  },
];

export const webBuilds = [
  "Företagshemsidor",
  "Landningssidor",
  "Kampanjsidor",
  "Föreningssidor",
  "Bokningssidor",
  "E-handel",
  "Kundportaler",
  "Administrationsgränssnitt",
  "Webbappar",
];

export const webProcess = [
  "Idé",
  "Struktur",
  "Design",
  "UX",
  "Text",
  "Utveckling",
  "Mobilanpassning",
  "SEO-grund",
  "Integrationer",
  "Hosting",
  "Domän",
  "Lansering",
  "Support",
  "Underhåll",
];

export const smallApps = [
  "Bokningsverktyg",
  "Inventariesystem",
  "Formulär",
  "Dashboard",
  "Kundregister",
  "Personalverktyg",
  "Checklistor",
  "Administrationsverktyg",
  "Enklare mobilappar",
  "Interna webbsystem",
];

export const smallSystems = [
  "Bokningssystem",
  "Ärendehantering",
  "Kundportal",
  "Medlemssystem",
  "Orderhantering",
  "Lager",
  "Schema",
  "Dokumenthantering",
  "Intern administration",
];

export const bigProducts = [
  "SaaS",
  "Mobilappar",
  "Webbplattformar",
  "Multi-tenant-system",
  "Bokningsplattformar",
  "Marknadsplatser",
  "Administrationssystem",
  "Realtidssystem",
  "Media-plattformar",
  "Sportplattformar",
  "AI-baserade tjänster",
];

export const buildFlow = ["Idé", "Krav", "Arkitektur", "Design", "Utveckling", "Test", "Drift"];

export const ideaHelp = [
  "Produktidé",
  "Scope",
  "MVP",
  "UX",
  "Arkitektur",
  "Databas",
  "API",
  "Frontend",
  "Backend",
  "Integrationer",
  "Testning",
  "Deployment",
  "Fortsatt utveckling",
];

export const businessServices = [
  "IT-support",
  "Nätverk",
  "Microsoft 365",
  "Google Workspace",
  "Servrar",
  "Säkerhet",
  "Backup",
  "AV",
  "Webb",
  "Appar",
  "System",
  "Automation",
  "Integrationer",
  "Tekniska projekt",
];

export const automationFlows: [string, string][] = [
  ["Bokning", "Kalender"],
  ["Webb", "CRM"],
  ["Formulär", "Databas"],
  ["Order", "Ekonomi"],
  ["Betalning", "Administration"],
  ["Kund", "Automatiska meddelanden"],
  ["API", "API"],
  ["AI", "Interna arbetsflöden"],
];

export const aiUses = [
  "Interna assistenter",
  "Sökning",
  "Innehåll",
  "Analys",
  "Automation",
  "Support",
  "Dokument",
  "Data",
  "Arbetsflöden",
];

export const sustainableActions = ["Uppgradera", "Optimera", "Reparera", "Konfigurera", "Integrera", "Modernisera"];
