import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfigFromFile } from "vite";
import { resolve } from "node:path";

afterEach(() => vi.unstubAllEnvs());
const load = () => loadConfigFromFile({ command: "build", mode: "production" }, resolve("vite.config.ts"));

describe("public Desktop distribution configuration", () => {
  it("only forwards the three known public settings", async () => {
    vi.stubEnv("BERRYIT_PUBLIC_BACKEND_URL", "https://backend.example.test");
    vi.stubEnv("BERRYIT_PUBLIC_ANON_KEY", "sb_publishable_synthetic");
    vi.stubEnv("BERRYIT_PUBLIC_CONTROL_URL", "");
    vi.stubEnv("BERRYIT_PUBLIC_SERVICE_ROLE_KEY", "sb_secret_synthetic_must_not_ship");
    const loaded = await load();
    expect(loaded?.config.envPrefix).toEqual([]);
    expect(Object.keys(loaded?.config.define ?? {})).toEqual([
      "import.meta.env.BERRYIT_PUBLIC_BACKEND_URL",
      "import.meta.env.BERRYIT_PUBLIC_ANON_KEY",
      "import.meta.env.BERRYIT_PUBLIC_CONTROL_URL",
    ]);
    expect(JSON.stringify(loaded?.config.define)).not.toContain("sb_secret_");
  });

  it("refuses to package either form of administrative API key", async () => {
    vi.stubEnv("BERRYIT_PUBLIC_BACKEND_URL", "https://backend.example.test");
    vi.stubEnv("BERRYIT_PUBLIC_CONTROL_URL", "");
    for (const key of ["sb_secret_synthetic", `header.${btoa(JSON.stringify({ role: "service_role" }))}.signature`]) {
      vi.stubEnv("BERRYIT_PUBLIC_ANON_KEY", key);
      await expect(load()).rejects.toThrow("Administrativa nycklar");
    }
  });

  it("rejects an incomplete or credential-bearing backend profile", async () => {
    vi.stubEnv("BERRYIT_PUBLIC_CONTROL_URL", "");
    vi.stubEnv("BERRYIT_PUBLIC_BACKEND_URL", "https://backend.example.test");
    vi.stubEnv("BERRYIT_PUBLIC_ANON_KEY", "");
    await expect(load()).rejects.toThrow("publik klientnyckel");
    vi.stubEnv("BERRYIT_PUBLIC_ANON_KEY", "sb_publishable_synthetic");
    vi.stubEnv("BERRYIT_PUBLIC_BACKEND_URL", "https://user:pass@backend.example.test");
    await expect(load()).rejects.toThrow("origin");
  });
});
