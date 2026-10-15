/*
 * Tunnt lager mot Tauri.
 *
 * Appen ska gå att köra i en vanlig webbläsare under utveckling och testning.
 * Utanför Tauri finns inga kommandon – då används byggtidens förval och
 * konfigurationen sparas inte. Inget här hittar på värden.
 */
import { invoke } from "@tauri-apps/api/core";
import { BUILD_DEFAULTS, type AppConfig } from "@/config";
import { runningInTauri } from "@/auth/secure-store";

export type AppInfo = { version: string; platform: string; secure_storage: boolean };

/** Nyckel för konfiguration i webbläsarläge (endast utveckling/test). */
const DEV_CONFIG_KEY = "berryit-desktop-config";

export async function loadConfig(): Promise<Partial<AppConfig>> {
  if (runningInTauri()) {
    const stored = await invoke<{ backend_url: string; anon_key: string; control_url?: string }>("config_load");
    const config = { backendUrl: stored.backend_url, anonKey: stored.anon_key,controlUrl:stored.control_url };
    if (config.backendUrl && config.anonKey) return config;
    return { ...BUILD_DEFAULTS, ...stripEmpty(config) };
  }
  try {
    const raw = localStorage.getItem(DEV_CONFIG_KEY);
    if (raw) return { ...BUILD_DEFAULTS, ...stripEmpty(JSON.parse(raw) as Partial<AppConfig>) };
  } catch {
    /* ingen lagring tillgänglig – förvalen gäller */
  }
  return { ...BUILD_DEFAULTS };
}

export async function saveConfig(config: AppConfig): Promise<void> {
  if (runningInTauri()) {
    await invoke("config_save", {
      config: { backend_url: config.backendUrl, anon_key: config.anonKey,control_url:config.controlUrl??"" },
    });
    return;
  }
  try {
    localStorage.setItem(DEV_CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* utvecklingsläge utan lagring – konfigurationen gäller sessionen ut */
  }
}

export async function appInfo(): Promise<AppInfo> {
  if (runningInTauri()) return invoke<AppInfo>("app_info");
  return { version: "dev", platform: "webb", secure_storage: false };
}

function stripEmpty(input: Partial<AppConfig>): Partial<AppConfig> {
  const out: Partial<AppConfig> = {};
  if (input.backendUrl) out.backendUrl = input.backendUrl;
  if (input.anonKey) out.anonKey = input.anonKey;
  if (input.controlUrl) out.controlUrl = input.controlUrl;
  return out;
}
