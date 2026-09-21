// Formulärets val – utan zod, så att klientkomponenten inte drar in valideringsbiblioteket.

export const customerTypes = [
  { value: "hem", label: "Hemma" },
  { value: "foretag", label: "Företag / förening" },
] as const;

export type CustomerType = (typeof customerTypes)[number]["value"];

export const helpAreas = [
  { value: "it", label: "IT / dator", homeLabel: "Dator" },
  { value: "skrivare", label: "Skrivare" },
  { value: "mobil", label: "Mobil / surfplatta" },
  { value: "natverk", label: "Wi-Fi / nätverk" },
  { value: "gaming", label: "Gaming" },
  { value: "tv", label: "TV / streaming" },
  { value: "ljud", label: "Ljud" },
  { value: "smarthem", label: "Smart hem" },
  { value: "energi", label: "Energi / sol" },
  { value: "ljus", label: "Ljus" },
  { value: "av", label: "AV" },
  { value: "webb", label: "Webbplats" },
  { value: "app", label: "App" },
  { value: "system", label: "System" },
  { value: "automation", label: "Automation" },
  { value: "foretags-it", label: "Företags-IT" },
  { value: "annat", label: "Annat" },
] as const;

export type HelpArea = (typeof helpAreas)[number]["value"];

/** Vilka områden som visas – och i vilken ordning – för respektive kundtyp. */
export const areasFor: Record<CustomerType, readonly HelpArea[]> = {
  hem: ["it", "skrivare", "natverk", "gaming", "tv", "ljud", "mobil", "smarthem", "energi", "annat"],
  foretag: ["it", "mobil", "natverk", "skrivare", "ljud", "ljus", "av", "webb", "app", "system", "automation", "foretags-it", "annat"],
};

export function areaLabel(value: string, type?: CustomerType) {
  const a = helpAreas.find((x) => x.value === value);
  if (!a) return value;
  return type === "hem" && "homeLabel" in a ? a.homeLabel : a.label;
}

/** Kundtyp från förvald ?area= när ?kund= saknas (länkar från tjänstesidorna). */
export function inferCustomerType(area?: string): CustomerType | undefined {
  if (!area) return undefined;
  const hem = (areasFor.hem as readonly string[]).includes(area);
  const foretag = (areasFor.foretag as readonly string[]).includes(area);
  if (hem && !foretag) return "hem";
  if (foretag) return "foretag";
  return undefined;
}

export const intents = [
  { value: "fixa", label: "Något fungerar inte" },
  { value: "installera", label: "Installera något" },
  { value: "forbattra", label: "Förbättra befintlig lösning" },
  { value: "bygga", label: "Bygga något nytt" },
  { value: "radgivning", label: "Få rådgivning" },
  { value: "vet-inte", label: "Vet inte" },
] as const;

/** Hemma-flödet visar inte "Bygga något nytt" – det hör till företagsprojekt. */
export const intentsFor: Record<CustomerType, readonly string[]> = {
  hem: ["fixa", "installera", "forbattra", "radgivning", "vet-inte"],
  foretag: intents.map((i) => i.value),
};

export const buildTypes = [
  { value: "hemsida", label: "Hemsida" },
  { value: "mindre-app", label: "Mindre app" },
  { value: "mobilapp", label: "Mobilapp" },
  { value: "webbapp", label: "Webbapp" },
  { value: "internt-system", label: "Internt system" },
  { value: "kundportal", label: "Kundportal" },
  { value: "storre-plattform", label: "Större plattform" },
  { value: "ide", label: "Jag har bara en idé än så länge" },
] as const;

export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function labelFor(opts: readonly { value: string; label: string }[], value?: string) {
  return opts.find((o) => o.value === value)?.label ?? value ?? "";
}
