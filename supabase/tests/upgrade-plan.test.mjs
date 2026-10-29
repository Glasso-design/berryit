import test from "node:test";
import assert from "node:assert/strict";
import { DEPLOYED_BASELINE, PENDING_MIGRATIONS, ADDITIONAL_MIGRATIONS, planPendingUpgrade, upgradeManifest } from "../upgrade-plan.mjs";
import { readFileSync } from "node:fs";
test("six deployed migrations produce eight historical candidates plus the explicitly reviewed local access extension", () => {
  const plan = planPendingUpgrade([...DEPLOYED_BASELINE]);
  assert.deepEqual(plan.map(m => m.name), [...PENDING_MIGRATIONS,...ADDITIONAL_MIGRATIONS]);
  assert.ok(plan.every(m => /^[0-9a-f]{64}$/.test(m.sha256)));
  assert.equal(plan[0].predecessor, DEPLOYED_BASELINE.at(-1));
  assert.deepEqual(planPendingUpgrade(upgradeManifest().map(m => m.name)), []);
  const reviewed = JSON.parse(readFileSync(new URL("../../docs/master-integration-pass1-migrations.json", import.meta.url), "utf8"));
  assert.deepEqual(reviewed.entries, upgradeManifest().slice(0,14), "Historical review checksums remain unchanged");
  const extension=JSON.parse(readFileSync(new URL('../../docs/project-access-migrations.json',import.meta.url),'utf8'));
  assert.deepEqual(extension.entries,upgradeManifest().slice(0,15), 'Prior project/access review checksums remain unchanged');
  const diagnostics=JSON.parse(readFileSync(new URL('../../docs/ai-find-error-migrations.json',import.meta.url),'utf8'));
  assert.deepEqual(diagnostics.entries,upgradeManifest().slice(0,16), 'Prior diagnostic review checksums remain unchanged');
  const masterpass=JSON.parse(readFileSync(new URL('../../docs/masterpass1-migrations.json',import.meta.url),'utf8'));
  assert.deepEqual(masterpass.entries,upgradeManifest(), 'MASTER PASS 1 review manifest must match every tested SQL file');
});
test("unknown, missing, duplicate and reordered ledger entries fail closed", () => {
  for (const applied of [[], DEPLOYED_BASELINE.slice(1), [...DEPLOYED_BASELINE, "unknown.sql"], [...DEPLOYED_BASELINE, PENDING_MIGRATIONS[1]], [...DEPLOYED_BASELINE, DEPLOYED_BASELINE.at(-1)]]) {
    assert.throws(() => planPendingUpgrade(applied), /reviewed/);
  }
});
