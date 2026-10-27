import test from "node:test";
import assert from "node:assert/strict";
import { DEPLOYED_BASELINE, PENDING_MIGRATIONS, ADDITIONAL_MIGRATIONS, PCC_R1_MIGRATIONS, planPendingUpgrade, upgradeManifest } from "../upgrade-plan.mjs";
import { readFileSync } from "node:fs";
test("six deployed migrations produce the reviewed local extensions including PCC R1", () => {
  const plan = planPendingUpgrade([...DEPLOYED_BASELINE]);
  assert.deepEqual(plan.map(m => m.name), [...PENDING_MIGRATIONS,...ADDITIONAL_MIGRATIONS,...PCC_R1_MIGRATIONS]);
  assert.ok(plan.every(m => /^[0-9a-f]{64}$/.test(m.sha256)));
  assert.equal(plan[0].predecessor, DEPLOYED_BASELINE.at(-1));
  assert.deepEqual(planPendingUpgrade(upgradeManifest().map(m => m.name)), []);
  const reviewed = JSON.parse(readFileSync(new URL("../../docs/master-integration-pass1-migrations.json", import.meta.url), "utf8"));
  assert.deepEqual(reviewed.entries, upgradeManifest().slice(0,14), "Historical review checksums remain unchanged");
  const extension=JSON.parse(readFileSync(new URL('../../docs/project-access-migrations.json',import.meta.url),'utf8'));
  assert.deepEqual(extension.entries,upgradeManifest().slice(0,15), 'Prior project/access review checksums remain unchanged');
  const diagnostics=JSON.parse(readFileSync(new URL('../../docs/ai-find-error-migrations.json',import.meta.url),'utf8'));
  assert.deepEqual(diagnostics.entries,upgradeManifest().slice(0,16), 'Earlier diagnostic review checksums remain unchanged');
  const control=JSON.parse(readFileSync(new URL('../../docs/project-control-center-migrations.json',import.meta.url),'utf8'));
  assert.deepEqual(control.entries,upgradeManifest().slice(0,-PCC_R1_MIGRATIONS.length), 'The locked isolated PCC review remains an immutable prefix');
  assert.equal(control.status,'local-only-not-approved-for-production');
  assert.deepEqual(upgradeManifest().slice(-PCC_R1_MIGRATIONS.length).map(entry=>entry.name),PCC_R1_MIGRATIONS, 'PCC R1 follows the locked PCC package without rewriting it');
});
test("unknown, missing, duplicate and reordered ledger entries fail closed", () => {
  for (const applied of [[], DEPLOYED_BASELINE.slice(1), [...DEPLOYED_BASELINE, "unknown.sql"], [...DEPLOYED_BASELINE, PENDING_MIGRATIONS[1]], [...DEPLOYED_BASELINE, DEPLOYED_BASELINE.at(-1)]]) {
    assert.throws(() => planPendingUpgrade(applied), /reviewed/);
  }
});
