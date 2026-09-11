import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDecisionPlan } from "./decision-plan.js";
import { filterShareFromDraft, previewDualFilterShares, DEFAULT_STATIC_RETENTION_POLICY } from "./rules.js";
import { YuhunWorkflow } from "./workflow.js";
import { YUHUN_TYPES } from "./mappings.js";
import { calculateCleanupQuota, maximumDesiredFreeSlots, normalizeDesiredFreeSlots } from "./capacity.js";
import type { YyxYuhun } from "./yyx.js";

const header = "00".repeat(16);
test("ID-only drafts preview the same suit conditions as the encoder", () => {
  const share = (criteria: { types?: string[]; typeIds?: number[] }) => filterShareFromDraft({ headerHex: header, planKind: "discard", groups: [{ name: "测试", criteria }] });
  assert.deepEqual(share({ typeIds: [300006], types: ["狂骨"] }), share({ types: ["涅槃火"] }));
  assert.deepEqual(share({ typeIds: [], types: ["狂骨"] }), share({ types: [] }));
  assert.throws(() => share({ typeIds: [999] }), /未知御魂套装 ID/);
});
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

test("free-slot targets use hundreds strictly below the marked count", () => {
  for (const [marked, maximum] of [[2831, 2800], [1799, 1700], [2800, 2700], [101, 100], [100, 0], [0, 0]]) {
    assert.equal(maximumDesiredFreeSlots(marked!), maximum);
  }
  assert.equal(normalizeDesiredFreeSlots(500, 2831), 500);
  assert.equal(normalizeDesiredFreeSlots(500, 350), 300);
  assert.equal(normalizeDesiredFreeSlots(3000, 1799), 1700);
  assert.equal(normalizeDesiredFreeSlots(-100, 1799), 0);
  assert.equal(calculateCleanupQuota({ totalCount: 5816, level15Count: 0, desiredFreeSlots: 500 }).requiredRelease, 316);
  assert.equal(calculateCleanupQuota({ totalCount: 6050, level15Count: 0, desiredFreeSlots: 500 }).requiredRelease, 550);
});

test("a cleanup quota stops at whole safe rules without changing retained items", () => {
  const items = [
    ...Array.from({ length: 3 }, (_, i) => item(`large-${i}`)),
    ...Array.from({ length: 2 }, (_, i) => item(`small-${i}`, { name: "火灵", suitId: 300019 })),
    item("keep", { name: "火灵", suitId: 300019, subStats: { speed: 3 } })
  ];
  const wanted = new Set(items.filter(x => x.id !== "keep").map(x => x.id));
  const preview = (quota: number) => {
    const plan = buildDecisionPlan(items, wanted, header, quota);
    return previewDualFilterShares({ items, discardShare: plan.discardDraft && filterShareFromDraft(plan.discardDraft), rescueShare: plan.rescueDraft && filterShareFromDraft(plan.rescueDraft) });
  };
  assert.equal(preview(0).finalNewDiscardIds.length, 0);
  assert.equal(preview(1).finalNewDiscardIds.length, 2);
  assert.equal(preview(2).finalNewDiscardIds.length, 2);
  assert.equal(preview(3).finalNewDiscardIds.length, 3);
  assert.equal(preview(4).finalNewDiscardIds.length, 5);
  assert.equal(preview(100).finalNewDiscardIds.length, 5);
  assert.ok(!preview(100).finalNewDiscardIds.includes("keep"));
});

test("workflow separates target-dependent cache entries and reports unmet capacity", () => {
  const items = [
    ...Array.from({ length: 100 }, (_, i) => item(`drop-a-${i}`)),
    ...Array.from({ length: 101 }, (_, i) => item(`drop-b-${i}`, { name: "火灵", suitId: 300019 }))
  ];
  const workflow = new YuhunWorkflow();
  Object.assign(workflow, { items: [...items, ...Array.from({ length: 5799 }, (_, i) => item(`locked-${i}`, { lock: true }))] });
  workflow.analyze({ templateIds: [], riskTier: "tier1", defaultDisposition: "discard" });
  const generate = (desiredFreeSlots: number) => workflow.generatePlan({ staticPolicy: DEFAULT_STATIC_RETENTION_POLICY, desiredFreeSlots }).summary;
  assert.equal(generate(100).finalNewDiscardCount, 100);
  assert.equal(generate(100).desiredFreeSlotsReached, true);
  assert.equal(generate(200).finalNewDiscardCount, 201);
  assert.equal(generate(100).finalNewDiscardCount, 100);
  assert.equal(generate(0).finalNewDiscardCount, 0);
  assert.equal(generate(0).desiredFreeSlotsReached, true);
  assert.equal(generate(99999).desiredFreeSlots, 200);

  const blocked = new YuhunWorkflow();
  Object.assign(blocked, { items: [...Array.from({ length: 5900 }, (_, i) => item(`locked-${i}`, { lock: true })),
    ...Array.from({ length: 100 }, (_, i) => item(`drop-${i}`)),
    item("keep-level1", { level: 1 })] });
  blocked.analyze({ templateIds: [], riskTier: "tier1", defaultDisposition: "discard" });
  const unmet = blocked.generatePlan({ staticPolicy: DEFAULT_STATIC_RETENTION_POLICY, desiredFreeSlots: 500 }).summary;
  assert.equal(unmet.requiredRelease, 1);
  assert.equal(unmet.finalNewDiscardCount, 0);
  assert.equal(unmet.desiredFreeSlotsReached, false);
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

test("preview inventory uses the exact D/E pool membership and excludes locked pieces", () => {
  const workflow = new YuhunWorkflow();
  const items = [item("new"), item("history", { garbage: true }), item("locked", { lock: true }), item("outside", { name: "火灵", suitId: 300003 })];
  Object.assign(workflow, { items });
  const criteria = filterShareFromDraft({ headerHex: header, planKind: "discard", groups: [{ name: "rule", criteria: { types: ["招财猫"] } }] }).groups[0]!.criteria;
  const preview = { discard: [criteria], rescue: [criteria], index: 0 };
  const rows = (code: "D" | "E", pool: "normal" | "new-garbage" | "historical-garbage" | "combined") => workflow.queryInventory({ preview: { ...preview, code, pool } });
  assert.deepEqual(rows("D", "normal").rows.map(row => row.row), [1]);
  assert.deepEqual(rows("E", "new-garbage").rows.map(row => row.row), [1]);
  assert.deepEqual(rows("E", "historical-garbage").rows.map(row => row.row), [2]);
  assert.deepEqual(rows("E", "combined").rows.map(row => row.row), [1, 2]);
  assert.equal(workflow.queryInventory({ preview: { ...preview, code: "E", pool: "combined" }, search: "火灵" }).total, 0);
  const paged = workflow.queryInventory({ preview: { ...preview, code: "E", pool: "combined" }, pageSize: 1, page: 2 });
  assert.equal(paged.total, 2);
  assert.deepEqual(paged.rows.map(row => row.row), [2]);
  assert.equal(workflow.queryInventory().total, 4);
});
