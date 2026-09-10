import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDecisionPlan } from "./decision-plan.js";
import { filterShareFromDraft, previewDualFilterShares, DEFAULT_STATIC_RETENTION_POLICY } from "./rules.js";
import { YuhunWorkflow } from "./workflow.js";
import { YUHUN_TYPES } from "./mappings.js";
import type { YyxYuhun } from "./yyx.js";

const header = "00".repeat(16);
const item = (id: string, changes: Partial<YyxYuhun> = {}): YyxYuhun => ({ id, name: "招财猫", suitId: 300010, position: 2, level: 0, star: 6, mainStat: "speed", mainValue: 12, subStats: { speed: 2.4, crit: .03 }, intrinsicStats: {}, initialSubStats: { speed: 2.4, crit: .03 }, born: 0, lock: false, garbage: false, ...changes });
function run(items: YyxYuhun[], wanted: string[]) {
  const plan = buildDecisionPlan(items, new Set(wanted), header);
  assert.ok((plan.discardDraft?.groups.length ?? 0) <= 60);
  assert.ok((plan.rescueDraft?.groups.length ?? 0) <= 60);
  const preview = previewDualFilterShares({ items, discardShare: plan.discardDraft && filterShareFromDraft(plan.discardDraft), rescueShare: plan.rescueDraft && filterShareFromDraft(plan.rescueDraft) });
  for (const id of preview.finalNewDiscardIds) {
    assert.ok(wanted.includes(id));
    const source = items.find(item => item.id === id)!;
    assert.equal(source.level, 0);
    assert.ok(!source.lock && !source.garbage && source.star === 6);
  }
  return { plan, preview };
}
test("indistinguishable retained values and levels protect the whole bucket", () => {
  assert.deepEqual(run([item("a"), item("b", { subStats: { speed: 3, crit: .03 } })], ["a"]).preview.finalNewDiscardIds, []);
  for (const level of [1, 2]) assert.deepEqual(run([item("a"), item("b", { level })], ["a"]).preview.finalNewDiscardIds, []);
});
test("speed main stat is eligible; locked, historical and upgraded pieces are excluded", () => {
  const items = [item("a"), item("b", { lock: true }), item("c", { garbage: true }), item("d", { level: 15 }), item("e", { star: 5 })];
  assert.deepEqual(run(items, items.map(i => i.id)).preview.finalNewDiscardIds, ["a"]);
});
test("large decision tables use bounded rescue groups and never lose protection", () => {
  const items = YUHUN_TYPES.slice(0, 65).flatMap((name, index) => [item(`keep${index}`, { name }), item(`drop${index}`, { name, subStats: { attack: 20 } })]);
  const wanted = items.filter(i => i.id.startsWith("drop")).map(i => i.id);
  const { plan, preview } = run(items, wanted);
  assert.equal(preview.finalNewDiscardIds.length, 65);
  assert.equal(plan.discardDraft?.groups.length, 1);
  assert.equal(plan.rescueDraft?.groups.length, 1);
  assert.deepEqual(buildDecisionPlan(items, new Set(wanted), header), plan);
});
test("empty inventory and all-retain produce no codes", () => {
  for (const items of [[], [item("a")]]) {
    const { plan } = run(items, []);
    assert.equal(plan.discardDraft, null);
    assert.equal(plan.rescueDraft, null);
  }
});
test("analysis and generation work without +15 inventory or speed templates", () => {
  const workflow = new YuhunWorkflow();
  Object.assign(workflow, { items: [item("a"), item("b", { level: 1 })] });
  const summary = workflow.analyze({ templateIds: [], riskTier: "tier1", defaultDisposition: "discard" });
  assert.equal(summary.markedDiscardProjection.discardCount, 1);
  const plan = workflow.generatePlan({ headerHex: header, staticPolicy: DEFAULT_STATIC_RETENTION_POLICY });
  assert.equal(plan.summary.finalNewDiscardCount, 0);
  assert.equal(plan.summary.cleanupComparison?.extraCleanupCount, 0);
  assert.equal(workflow.getGateState().retainedItemsProtected, true);
});
