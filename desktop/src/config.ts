/*
 * Klientkonfiguration för desktopappen.
 *
 * Två lager:
 *   1. Byggtidsvärden (BERRYIT_PUBLIC_*) – bara publika värden, används som
 *      förval i installationen.
 *   2. Användarens egen konfiguration, sparad av Rust-sidan i appens
 *      konfigurationsmapp. Teknikern kan peka om klienten utan att bygga om.
 *
 * Här får aldrig en service-role-nyckel eller annan administrativ hemlighet
 * förekomma. `assertNoServiceRoleKey` är ett aktivt skydd, inte en kommentar:
 * appen vägrar starta mot en nyckel som ger administrativ åtkomst.
 */
import { backendUrlSchema, looksLikeServiceRoleKey } from "@berryit/shared/schemas";

export type AppConfig = {
  /** Bas-URL till berryit-support-gatewayen, t.ex. http://127.0.0.1:8700 */
  backendUrl: string;
  /** Publik anon-nyckel. Ger ingen åtkomst i sig – RLS avgör allt. */
  anonKey: string;
};

export const BUILD_DEFAULTS: Partial<AppConfig> = {
  backendUrl: import.meta.env.BERRYIT_PUBLIC_BACKEND_URL ?? "",
  anonKey: import.meta.env.BERRYIT_PUBLIC_ANON_KEY ?? "",
};

export class ConfigError extends Error {}

/** Kastar om värdet är en nyckel som inte hör hemma i en klient. */
export function assertNoServiceRoleKey(key: string): void {
  if (looksLikeServiceRoleKey(key)) {
    throw new ConfigError(
      "Nyckeln är en service-role-nyckel. Den ger administrativ åtkomst och får aldrig användas i desktopappen.",
    );
  }
}

export function validateConfig(input: Partial<AppConfig>): AppConfig {
  const url = backendUrlSchema.safeParse(input.backendUrl ?? "");
  if (!url.success) throw new ConfigError(url.error.issues[0]?.message ?? "Ogiltig backend-URL.");

  const anonKey = (input.anonKey ?? "").trim();
  if (!anonKey) throw new ConfigError("Anon-nyckel saknas.");
  assertNoServiceRoleKey(anonKey);

  return { backendUrl: url.data, anonKey };
}

export function isConfigured(input: Partial<AppConfig> | null | undefined): boolean {
  if (!input) return false;
  try {
    validateConfig(input);
    return true;
  } catch {
    return false;
  }
}
