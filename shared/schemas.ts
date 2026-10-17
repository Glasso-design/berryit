/*
 * Validering som används av båda klienterna. Samma regler i webbformulär och i
 * desktopappen, så att felmeddelanden och gränser aldrig glider ifrån varandra.
 *
 * Validering här är ett hjälpmedel för användaren, inte ett skydd: databasens
 * constraints och RLS är det som faktiskt håller.
 */
import { z } from "zod";
import { TICKET_PRIORITY_KEYS, TICKET_REFERENCE_PATTERN } from "./domain";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Ange din e-postadress.")
  .max(254, "E-postadressen är för lång.")
  .email("Ange en giltig e-postadress.");

export const loginSchema = z.object({
  email: emailSchema,
  // Ingen övre gräns på innehållet utöver GoTrues egen – fält som är för korta
  // avvisas lokalt, resten avgör backenden.
  password: z.string().min(1, "Ange ditt lösenord."),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** TOTP enligt RFC 6238: sex siffror. Mellanslag tillåts och rensas bort. */
export const totpCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Ange den sexsiffriga koden."));

export const searchTermSchema = z
  .string()
  .trim()
  .min(2, "Skriv minst två tecken.")
  .max(100, "Söktermen är för lång.");

export const ticketReferenceSchema = z
  .string()
  .trim()
  .regex(TICKET_REFERENCE_PATTERN, "Ogiltig ärendereferens.");

export const ticketDraftSchema = z.object({
  subject: z.string().trim().min(3, "Ämnet är för kort.").max(200, "Ämnet är för långt."),
  description: z
    .string()
    .trim()
    .min(10, "Beskriv ärendet med minst tio tecken.")
    .max(10_000, "Beskrivningen är för lång."),
  category_key: z.string().trim().min(1, "Välj kategori."),
  priority_key: z.enum(TICKET_PRIORITY_KEYS as unknown as [string, ...string[]]).default("normal"),
});
export type TicketDraft = z.infer<typeof ticketDraftSchema>;

/**
 * Backendens bas-URL. Krävs för att desktopappen ska veta vart den ansluter.
 * Måste vara https utanför loopback/Tailscale – klartext över internet tillåts inte.
 */
export const backendUrlSchema = z
  .string()
  .trim()
  .min(1, "Backend-URL saknas.")
  .transform((v) => v.replace(/\/+$/, ""))
  .refine((v) => /^https?:\/\//.test(v), "Backend-URL måste börja med http:// eller https://")
  .refine((v) => {
    try {
      const u = new URL(v);
      if (u.protocol === "https:") return true;
      // http tillåts bara mot loopback eller Tailscale-adresser (100.64.0.0/10).
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]") return true;
      const m = u.hostname.match(/^100\.(\d{1,3})\./);
      return m ? Number(m[1]) >= 64 && Number(m[1]) <= 127 : false;
    } catch {
      return false;
    }
  }, "Klartext (http) tillåts bara mot loopback eller Tailscale. Använd https.");

/** Säkerställer att en sträng inte är en service-role-nyckel innan den används i klienten. */
export function looksLikeServiceRoleKey(value: string): boolean {
  if (value.trim().startsWith("sb_secret_")) return true;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const json = JSON.parse(
      // base64url → utf8 utan Buffer, så att funktionen fungerar i både Node och WebView.
      decodeURIComponent(
        atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
          .split("")
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join(""),
      ),
    );
    return json?.role === "service_role";
  } catch {
    return false;
  }
}
