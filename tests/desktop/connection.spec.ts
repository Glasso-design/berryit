// Tests the actual production frontend. Auth health is synthetic and all
// non-fixture network requests are blocked: this never signs in a real user.
import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
let server: Server;
let origin: string;
const root = resolve("desktop/dist");

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://fixture.test").pathname;
    const path = resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
      res.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No fixture port");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); });

test("configured distribution reaches login without asking for a URL or key", async ({ page }) => {
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(origin + "/")) return route.continue();
    if (url === "http://127.0.0.1:8700/auth/v1/health") return route.fulfill({ json: { name: "GoTrue fixture" }, headers: { "Access-Control-Allow-Origin": origin } });
    return route.abort();
  });
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Logga in" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Ansluten till BERRYiT.");
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
  await expect(page.getByText("Backend-URL", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "test-results/desktop-connection/login.png" });
});

test("offline login explains the local tunnel and recovers using retry", async ({ page }) => {
  let online = false;
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(origin + "/")) return route.continue();
    if (url === "http://127.0.0.1:8700/auth/v1/health" && online) return route.fulfill({ json: {}, headers: { "Access-Control-Allow-Origin": origin } });
    return route.abort();
  });
  await page.goto(origin);
  await expect(page.getByRole("status")).toContainText("SSH-tunnel");
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeDisabled();
  online = true;
  await page.getByRole("button", { name: "Försök igen" }).click();
  await expect(page.getByRole("status")).toHaveText("Ansluten till BERRYiT.");
  await expect(page.getByRole("button", { name: "Logga in", exact: true })).toBeEnabled();
});

test("connection settings remain reachable before authentication and retain defaults", async ({ page }) => {
  await page.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(origin + "/")) return route.continue();
    if (url === "http://127.0.0.1:8700/auth/v1/health") return route.fulfill({ json: {}, headers: { "Access-Control-Allow-Origin": origin } });
    return route.abort();
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Anslutningsinställningar" }).click();
  await expect(page.getByLabel("Backend-URL")).toHaveValue("http://127.0.0.1:8700");
  await page.getByRole("button", { name: "Spara och anslut" }).click();
  await expect(page.getByRole("heading", { name: "Logga in" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Ansluten till BERRYiT.");
});
