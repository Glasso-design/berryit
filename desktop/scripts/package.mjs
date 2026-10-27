// Explicit owner/generic packaging. Never install or overwrite a user's config.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { distributionProfile, packageKind } from "./distribution-profile.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kind = packageKind(process.argv.slice(2));
const profile = distributionProfile(loadEnv("production", root, "BERRYIT_PUBLIC_"), kind);
const config = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
if (version !== config.version) throw new Error("Tauri/npm-versionerna skiljer sig.");
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows x64 krävs för detta distributionspaket.");
const started = Date.now();
execFileSync(process.execPath, [path.join(root, "node_modules/@tauri-apps/cli/tauri.js"), "build", "--bundles", "nsis"], {
  cwd: root, stdio: "inherit", env: { ...process.env, ...profile, BERRYIT_DISTRIBUTION_KIND: kind },
});
// Exact versioned artifact; no newest-file fallback that can select stale output.
const source = path.join(root, "src-tauri/target/release/bundle/nsis", `${config.productName}_${version}_x64-setup.exe`);
if (!fs.existsSync(source) || fs.statSync(source).mtimeMs < started - 2000) throw new Error("Förväntad ny versionsmärkt installerare saknas.");
const output = path.join(root, "dist-installer", kind);
fs.mkdirSync(output, { recursive: true });
const target = path.join(output, `BerryIT-Control-Center-${kind === "owner" ? "Owner" : "Generic"}-${version}-x64-Setup.exe`);
fs.copyFileSync(source, target);
const sha256 = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const manifest = {
  kind, version, builtAt: new Date().toISOString(), installer: path.basename(target), bytes: fs.statSync(target).size,
  sha256: sha256(target), executableSha256: sha256(path.join(root, "src-tauri/target/release/berryit-control-center.exe")),
  backendUrl: profile.BERRYIT_PUBLIC_BACKEND_URL, controlUrl: profile.BERRYIT_PUBLIC_CONTROL_URL,
  publicKeySha256: profile.BERRYIT_PUBLIC_ANON_KEY ? createHash("sha256").update(profile.BERRYIT_PUBLIC_ANON_KEY).digest("hex") : null,
};
fs.writeFileSync(target + ".json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`Installerare: ${target}\nVersion: ${version}\nSHA-256: ${manifest.sha256}`);
