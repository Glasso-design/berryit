/*
 * Lagringsadapter för Supabase-sessionen.
 *
 * Webbklienten lagrar sessionen i httpOnly-cookies, vilket bara fungerar när en
 * server sätter dem. Desktopappen har ingen server i mitten, och localStorage i
 * en WebView är en fil på disk i klartext. Därför går lagringen genom Rust till
 * Windows Credential Manager (se src-tauri/src/secure_store.rs).
 *
 * Supabase-klienten anropar adaptern synkront i vissa lägen; biblioteket
 * accepterar dock Promise-svar. En liten cache i minnet gör uppslagen snabba
 * och överlever inte processen – allt beständigt ligger i Credential Manager.
 */
import { invoke } from "@tauri-apps/api/core";

export interface SessionStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const cache = new Map<string, string | null>();

export const secureStorage: SessionStorage = {
  async getItem(key) {
    if (cache.has(key)) return cache.get(key) ?? null;
    try {
      const value = await invoke<string | null>("secret_get", { key });
      cache.set(key, value ?? null);
      return value ?? null;
    } catch (fel) {
      // En session som inte går att läsa är ingen session. Det kan hända om en
      // skrivning avbrutits eller om en delpost tagits bort manuellt i
      // Credential Manager. Rensa resten och låt användaren logga in igen –
      // alternativet är ett program som fastnar i uppstart.
      console.warn("Sparad session kunde inte läsas, rensar den:", fel);
      try {
        await invoke("secret_remove", { key });
      } catch {
        /* går inte att rensa heller – då är inloggning ändå enda vägen vidare */
      }
      cache.set(key, null);
      return null;
    }
  },
  async setItem(key, value) {
    await invoke("secret_set", { key, value });
    cache.set(key, value);
  },
  async removeItem(key) {
    try {
      await invoke("secret_remove", { key });
    } catch (fel) {
      console.warn("Kunde inte rensa sparad session:", fel);
    }
    cache.delete(key);
  },
};

/** Nollställer minnescachen. Används vid utloggning och i tester. */
export function clearStorageCache(): void {
  cache.clear();
}

/**
 * Lagring i minnet. Används bara när appen körs utanför Tauri (vitest och
 * webbläsarbaserad UI-testning), aldrig i det byggda programmet.
 */
export function memoryStorage(): SessionStorage {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

export function runningInTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
