import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { backendUrlSchema, looksLikeServiceRoleKey } from "../shared/schemas";

/*
 * Vite-konfiguration för BERRYiT Control Center (desktop).
 *
 * Porten är låst (strictPort) eftersom Tauri startar mot exakt denna adress.
 * Endast tre uttryckligen tillåtna publika variabler når bundlen. Automatiskt
 * envPrefix är avstängt; administrativa nycklar stoppar bygget.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "BERRYIT_PUBLIC_");
  const names = ["BERRYIT_PUBLIC_BACKEND_URL", "BERRYIT_PUBLIC_ANON_KEY", "BERRYIT_PUBLIC_CONTROL_URL"] as const;
  const backend = env.BERRYIT_PUBLIC_BACKEND_URL?.trim() ?? "";
  const key = env.BERRYIT_PUBLIC_ANON_KEY?.trim() ?? "";
  if (backend || key || env.BERRYIT_PUBLIC_CONTROL_URL) {
    if (!backendUrlSchema.safeParse(backend).success || !key) throw new Error("Desktop-förval kräver en säker backend-URL och publik klientnyckel.");
    if (looksLikeServiceRoleKey(key)) throw new Error("Administrativa nycklar får aldrig byggas in i Desktop.");
    const origin = new URL(backend);
    if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Desktop-förval måste ange backendens origin utan credentials eller sökväg.");
    if (env.BERRYIT_PUBLIC_CONTROL_URL) {
      const control = backendUrlSchema.safeParse(env.BERRYIT_PUBLIC_CONTROL_URL);
      if (!control.success) throw new Error("Ogiltig Control Center-origin i Desktop-förval.");
      const url = new URL(control.data);
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Control Center-förval måste vara en origin.");
    }
  }
  return {
  plugins: [react(), tailwindcss()],
  // Only these three public settings can enter the client, even if another
  // environment variable is accidentally prefixed BERRYIT_PUBLIC_.
  envPrefix: [],
  define: Object.fromEntries(names.map(name => [`import.meta.env.${name}`, JSON.stringify(env[name]?.trim() ?? "")])),
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@berryit/shared": fileURLToPath(new URL("../shared", import.meta.url)),
      // De godkända logotypvarianterna ligger kvar i webbens assets – samma
      // filer används av båda klienterna i stället för att kopieras hit.
      "@brand": fileURLToPath(new URL("../src/assets/brand", import.meta.url)),
    },
  },
  server: {
    port: 3601,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome120",
    sourcemap: false,
  },
  };
});
