import test from 'node:test';import assert from 'node:assert/strict';import {isolatedResultSummary} from './isolated-results.mjs';
test('all performed checks must pass before the gate is green',()=>assert.deepEqual(isolatedResultSummary([{status:'PASS'}]),{passed:1,failed:0,blocked:0,status:'PASS',exitCode:0}));
test('a blocked real verification can never return success',()=>assert.deepEqual(isolatedResultSummary([{status:'PASS'},{status:'BLOCKED'}]),{passed:1,failed:0,blocked:1,status:'BLOCKED',exitCode:2}));
test('a failure takes precedence over a blocker',()=>assert.equal(isolatedResultSummary([{status:'BLOCKED'},{status:'FAIL'}]).exitCode,1));
test('empty or invented statuses fail closed',()=>{assert.throws(()=>isolatedResultSummary([]));assert.throws(()=>isolatedResultSummary([{status:'MOCK_PASS'}]));});
