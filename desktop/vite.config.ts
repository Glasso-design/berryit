import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { distributionProfile, publicNames } from "./scripts/distribution-profile.mjs";

/*
 * Vite-konfiguration för BERRYiT Control Center (desktop).
 *
 * Porten är låst (strictPort) eftersom Tauri startar mot exakt denna adress.
 * Endast tre uttryckligen tillåtna publika variabler når bundlen. Automatiskt
 * envPrefix är avstängt; administrativa nycklar stoppar bygget.
 */
export default defineConfig(({ mode, command }) => {
  const input = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "BERRYIT_PUBLIC_");
  const env = distributionProfile(input, process.env.BERRYIT_DISTRIBUTION_KIND ?? (command === "build" ? "owner" : "development"));
  return {
  plugins: [react(), tailwindcss()],
  // Only these three public settings can enter the client, even if another
  // environment variable is accidentally prefixed BERRYIT_PUBLIC_.
  envPrefix: [],
  define: Object.fromEntries(publicNames.map(name => [`import.meta.env.${name}`, JSON.stringify(env[name])])),
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
