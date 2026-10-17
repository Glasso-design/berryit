import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: ["connection.spec.ts", "render.spec.ts"], workers: 1,
  timeout: 30000, reporter: "list", use: { headless: true },
  outputDir: "../../test-results/desktop-connection",
});
