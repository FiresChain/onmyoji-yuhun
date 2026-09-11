import assert from "node:assert/strict";
import { test } from "node:test";
import { comparePlanCriteria, type PlanCriteria } from "./plan-comparison.js";
import { filterShareFromDraft } from "./rules.js";
import { YuhunWorkflow } from "./workflow.js";
import type { YyxYuhun } from "./yyx.js";

function criteria(positions: number[]) {
  return filterShareFromDraft({ headerHex: "00".repeat(16), planKind: "discard", groups: [{ name: "test", criteria: { positions } }] }).groups[0]!.criteria;
}
const item = (id: string, position: number, changes: Partial<YyxYuhun> = {}): YyxYuhun => ({ id, name: "招财猫", suitId: 300010, position, level: 0, star: 6, mainStat: "attack", mainValue: 100, subStats: { speed: 2.4 }, intrinsicStats: {}, initialSubStats: { speed: 2.4 }, born: 0, lock: false, garbage: false, ...changes });
const items = [item("old-only", 1), item("new-only", 2), item("both", 3), item("neither", 4), item("locked", 2, { lock: true }), item("history", 5, { garbage: true }), item("locked-history", 5, { lock: true, garbage: true }), item("rescued", 6)];
const base: PlanCriteria = { discard: [criteria([1, 3, 6])], rescue: [] };
const next: PlanCriteria = { discard: [criteria([2, 3, 6])], rescue: [criteria([5, 6])] };

test("classifies net D/E outcomes, including historical restores and locked items", () => {
  const original = JSON.stringify(items);
  const result = comparePlanCriteria(items, base, next);
  assert.deepEqual(result.differences, ["extra-retain", "extra-discard", "both-discard", "both-retain", "both-retain", "extra-retain", "both-discard", "extra-retain"]);
  assert.deepEqual(result.counts, { "extra-discard": 1, "extra-retain": 3, "both-discard": 2, "both-retain": 2 });
  assert.equal(result.baseDiscardCount, 5);
  assert.equal(result.nextDiscardCount, 3);
  assert.equal(JSON.stringify(items), original);
});

test("swapping the base reverses changes and comparing the same plan has none", () => {
  const reversed = comparePlanCriteria(items, next, base);
  assert.equal(reversed.counts["extra-discard"], 3);
  assert.equal(reversed.counts["extra-retain"], 1);
  for (const plan of [base, next, { discard: [], rescue: [] }]) {
    const same = comparePlanCriteria(items, plan, plan);
    assert.equal(same.counts["extra-retain"] + same.counts["extra-discard"], 0);
    assert.equal(same.counts["both-retain"] + same.counts["both-discard"], items.length);
  }
});

test("comparison queries paginate differences, apply inventory filters and replace snapshot caches", () => {
  const workflow = new YuhunWorkflow();
  Object.assign(workflow, { items });
  const first = workflow.comparePlans({ base, next, pageSize: 2 });
  assert.equal(first.total, 4);
  assert.deepEqual(first.rows.map(row => row.row), [1, 2]);
  assert.deepEqual(first.rows.map(row => [row.baseDisposition, row.nextDisposition]), [["discard", "retain"], ["retain", "discard"]]);
  assert.deepEqual(workflow.comparePlans({ base, next, pageSize: 2, page: 2 }).rows.map(row => row.row), [6, 8]);
  const locked = workflow.comparePlans({ base, next, filter: "both-retain", criteria: criteria([2]) });
  assert.equal(locked.total, 1);
  assert.equal(locked.rows[0]?.locked, true);
  assert.deepEqual(locked.counts, first.counts);
  assert.equal(workflow.comparePlans({ base, next, search: "火灵" }).total, 0);
  Object.assign(workflow, { items: [item("replacement", 2)] });
  assert.deepEqual(workflow.comparePlans({ base, next }).counts, { "extra-discard": 1, "extra-retain": 0, "both-discard": 0, "both-retain": 0 });
  workflow.resetSession();
  assert.throws(() => workflow.comparePlans({ base, next }), /快照/);
});
