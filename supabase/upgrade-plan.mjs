// Metadata only. This module never connects to a database or applies SQL.
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
export const DEPLOYED_BASELINE = Object.freeze([
  "20261013080000_platform_bootstrap.sql",
  "20261013090000_support_desk_core.sql",
  "20261013090100_support_desk_rls.sql",
  "20261013090200_support_desk_storage.sql",
  "20261013090300_support_authority.sql",
  "20261013091000_support_authority_hardening.sql",
]);
export const PENDING_MIGRATIONS = Object.freeze([
  "20261013110000_support_mfa_enforcement.sql",
  "20261013120000_onarly_ai_assistant.sql",
  "20261013130000_connector_engine.sql",
  "20261013140000_infrastructure_monitoring.sql",
  "20261013150000_communications.sql",
  "20261014110000_onarly_desk_integration.sql",
  "20261014190857_security_ci_repair.sql",
  "20261014235633_complete_support_workflow.sql",
]);
// Separate from the historical PASS 1 eight-step review; never silently deploy.
export const ADDITIONAL_MIGRATIONS = Object.freeze(['20261016090000_project_access.sql','20261016150000_ai_diagnostics.sql','20261029090000_registration_gotrue_metadata.sql']);
export function upgradeManifest() {
  const directory = new URL("./migrations/", import.meta.url);
  const files = readdirSync(directory).filter(name => name.endsWith(".sql")).sort();
  const expected = [...DEPLOYED_BASELINE, ...PENDING_MIGRATIONS,...ADDITIONAL_MIGRATIONS];
  if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error("Migration inventory differs from the reviewed chain plus explicit local extension; review required");
  return expected.map((name, index) => ({
    name, state: index < 6 ? "deployed_baseline" : "pending",
    predecessor: expected[index - 1] ?? null,
    sha256: createHash("sha256").update(readFileSync(new URL(name, directory))).digest("hex"),
  }));
}

export function planPendingUpgrade(applied) {
  const manifest = upgradeManifest();
  if (!Array.isArray(applied) || applied.length < DEPLOYED_BASELINE.length || applied.length > manifest.length || applied.some((name, index) => name !== manifest[index].name)) {
    throw new Error("Applied ledger is not a reviewed baseline/prefix; no migration plan produced");
  }
  return manifest.slice(applied.length);
}
