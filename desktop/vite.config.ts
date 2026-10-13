import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/*
 * Vite-konfiguration för BERRYiT Control Center (desktop).
 *
 * Porten är låst (strictPort) eftersom Tauri startar mot exakt denna adress.
 * `envPrefix` är avsiktligt smal: endast BERRYIT_PUBLIC_* läcker in i bundlen,
 * så att ingen service-role-nyckel eller annan hemlighet kan följa med av misstag.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  envPrefix: ["BERRYIT_PUBLIC_"],
  resolve: {
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
});
