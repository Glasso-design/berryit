// Bygger Windows-installeraren och lägger den under ett förutsägbart namn.
//
// Tauri namnger artefakten efter produktnamn och version. Teknikerna ska få en
// fil som alltid heter likadant, därför kopieras den hit. Originalet ligger
// kvar, så versionen går att se i efterhand.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const UT = path.join(rot, "dist-installer");
const NAMN = "BerryIT-Control-Center-Setup.exe";

execFileSync("npx", ["tauri", "build"], { cwd: rot, stdio: "inherit", shell: process.platform === "win32" });

const bundleDir = path.join(rot, "src-tauri", "target", "release", "bundle", "nsis");
const artefakt = fs
  .readdirSync(bundleDir)
  .filter((f) => f.endsWith("-setup.exe"))
  .map((f) => ({ f, t: fs.statSync(path.join(bundleDir, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0];

if (!artefakt) throw new Error(`Hittade ingen installerare i ${bundleDir}`);

fs.mkdirSync(UT, { recursive: true });
const mal = path.join(UT, NAMN);
fs.copyFileSync(path.join(bundleDir, artefakt.f), mal);

const storlek = (fs.statSync(mal).size / 1024 / 1024).toFixed(2);
console.log(`\nInstallerare: ${mal} (${storlek} MiB)`);
console.log(`Källa:        ${path.join(bundleDir, artefakt.f)}`);
