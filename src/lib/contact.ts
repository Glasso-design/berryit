import { z } from "zod";
import { buildTypes, customerTypes, helpAreas, intents } from "./contact-options";

export * from "./contact-options";

// Svenska standardmeddelanden för fel som inte har egen text.
z.config(z.locales.sv());

type Opt = readonly { value: string }[];
const oneOf = <T extends Opt>(opts: T, message?: string) =>
  z.enum(opts.map((o) => o.value) as [T[number]["value"], ...T[number]["value"][]], message ? { message } : undefined);

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

export const contactSchema = z
  .object({
    customerType: oneOf(customerTypes, "Välj om det gäller hemmet eller ett företag."),
    areas: z.array(oneOf(helpAreas)).min(1, "Välj minst ett område."),
    intent: oneOf(intents),
    buildType: oneOf(buildTypes).optional(),
    name: z.string().trim().min(2, "Skriv ditt namn.").max(120, "Namnet är för långt."),
    company: optionalText(160),
    phone: optionalText(40),
    email: z.string().trim().max(254, "E-postadressen är för lång.").email("Ange en giltig e-postadress."),
    city: optionalText(80),
    description: z.string().trim().min(10, "Beskriv kort vad du behöver hjälp med.").max(5000, "Beskrivningen är för lång (max 5000 tecken)."),
    budget: optionalText(120),
    timeline: optionalText(120),
    // Honeypot – ska alltid vara tom.
    website: z.string().max(0).optional(),
  })
  .refine((d) => d.intent !== "bygga" || d.buildType, {
    path: ["buildType"],
    message: "Välj vad du vill bygga.",
  });

export type ContactInput = z.infer<typeof contactSchema>;
