// Formulärets val – utan zod, så att klientkomponenten inte drar in valideringsbiblioteket.
export const helpAreas = [
  { value: "it", label: "IT / dator" },
  { value: "mobil", label: "Mobil / surfplatta" },
  { value: "natverk", label: "Wi-Fi / nätverk" },
  { value: "ljud", label: "Ljud" },
  { value: "ljus", label: "Ljus" },
  { value: "av", label: "AV" },
  { value: "webb", label: "Webbplats" },
  { value: "app", label: "App" },
  { value: "system", label: "System" },
  { value: "automation", label: "Automation" },
  { value: "foretags-it", label: "Företags-IT" },
  { value: "annat", label: "Annat" },
] as const;

export const intents = [
  { value: "fixa", label: "Något fungerar inte" },
  { value: "installera", label: "Installera något" },
  { value: "forbattra", label: "Förbättra befintlig lösning" },
  { value: "bygga", label: "Bygga något nytt" },
  { value: "radgivning", label: "Få rådgivning" },
  { value: "vet-inte", label: "Vet inte" },
] as const;

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
