/*
 * Supabase-klient för desktopappen.
 *
 * Skiljer sig medvetet från webbens klient:
 *   • ingen SSR, inga cookies – desktopappen har ingen server i mitten
 *   • sessionen lagras i Windows Credential Manager (secureStorage)
 *   • `detectSessionInUrl: false` – appen har ingen URL att läsa tokens ur
 *   • `autoRefreshToken: true` – klienten förnyar access-token i bakgrunden
 *
 * Endast anon-nyckeln används. Den är publik till sin natur och ger ingen
 * åtkomst i sig: varje läsning och skrivning passerar RLS i databasen.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { API_PREFIX } from "@berryit/shared/api";
import { assertNoServiceRoleKey, type AppConfig } from "@/config";
import { memoryStorage, runningInTauri, secureStorage, type SessionStorage } from "./secure-store";

/**
 * Nätverksanrop går genom Rust när appen körs i Tauri.
 *
 * Det är inte en genväg runt en säkerhetsspärr: en desktopklient är ingen
 * webbplats, och anropen ska därför inte utgå från WebView2:s origin. Vinsten
 * är dubbel – gatewayen behöver inga CORS-undantag för appen, och webbvyn får
 * aldrig själv tala med backenden.
 *
 * Utanför Tauri (utveckling i webbläsare) används vanliga fetch, som då lyder
 * webbläsarens origin-regler.
 */
export const backendFetch: typeof fetch = (input, init) =>
  // Valet görs vid varje anrop, inte när modulen läses in: Tauris API injiceras
  // i fönstret innan appen renderas, men inte nödvändigtvis innan den här
  // modulen evalueras. Ett modulnivåval kunde därför tyst falla tillbaka på
  // webbläsarens fetch – och då stoppas POST-anropen av origin-reglerna.
  runningInTauri()
    ? (tauriFetch as unknown as typeof fetch)(input, init)
    : fetch(input, init);

let client: SupabaseClient | null = null;
let clientKey = "";

export function createBackendClient(config: AppConfig, storage?: SessionStorage): SupabaseClient {
  assertNoServiceRoleKey(config.anonKey);
  const store = storage ?? (runningInTauri() ? secureStorage : memoryStorage());

  return createClient(config.backendUrl, config.anonKey, {
    auth: {
      storage: store,
      storageKey: "berryit-control-center-session",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // PKCE är rätt flöde för en desktopklient och är förvalt här. Observera
      // att det inte är i bruk i dag: backenden har varken OAuth-leverantör
      // eller SMTP, så inget flöde utfärdar auktoriseringskoder. Inloggningen
      // sker med lösenord + TOTP direkt mot GoTrue. Se desktop/README.md.
      flowType: "pkce",
    },
    global: {
      fetch: backendFetch,
      headers: { "X-Client-Info": "berryit-control-center-desktop" },
    },
  });
}

/** Återanvänder klienten så länge konfigurationen är oförändrad. */
export function getBackendClient(config: AppConfig): SupabaseClient {
  const key = `${config.backendUrl}|${config.anonKey}`;
  if (!client || clientKey !== key) {
    client = createBackendClient(config);
    clientKey = key;
  }
  return client;
}

export function resetBackendClient(): void {
  client = null;
  clientKey = "";
}

/**
 * Kontrollerar att backenden svarar innan inloggning försöks, så att ett
 * nätverksfel inte visas som "fel lösenord".
 */
export async function checkBackendReachable(
  backendUrl: string,
  signal?: AbortSignal,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const timer = setTimeout(cancel, 8000);
  let loopback = false;
  try { loopback = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(backendUrl).hostname); } catch { /* invalid URL is reported as a connection failure */ }
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    const res = await backendFetch(`${backendUrl.replace(/\/+$/, "")}${API_PREFIX.auth}/health`, { signal: controller.signal });
    if (res.ok) return { ok: true };
    return { ok: false, reason: `Backenden svarade med status ${res.status}.` };
  } catch (e) {
    return {
      ok: false,
      reason:
        controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")
          ? "Anslutningen tog för lång tid."
          : loopback
            ? "Ingen kontakt med backenden. Starta BerryITs lokala SSH-tunnel och försök igen."
            : "Ingen kontakt med backenden. Kontrollera nätverket eller Tailscale.",
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
