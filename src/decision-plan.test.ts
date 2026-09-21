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
  assert.deepEqual(preview.incidentalRestoreIds, []);
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
test("safe merging covers more than 60 exact buckets without needing rescue", () => {
  const items = YUHUN_TYPES.slice(0, 65).flatMap((name, index) => [item(`keep${index}`, { name }), item(`drop${index}`, { name, subStats: { attack: 20 } })]);
  const wanted = items.filter(i => i.id.startsWith("drop")).map(i => i.id);
  const { plan, preview } = run(items, wanted);
  assert.equal(preview.finalNewDiscardIds.length, 65);
  assert.equal(plan.discardDraft?.groups.length, 1);
  assert.equal(plan.rescueDraft, null);
  assert.deepEqual(buildDecisionPlan(items, new Set(wanted), header), plan);
});
test("joint search expands D through E protection and respects historical discards", () => {
  const keep = item("keep", { name: YUHUN_TYPES[0]! });
  const targets = YUHUN_TYPES.slice(1, 66).map((name, i) => item(`drop${i}`, { name }));
  const wanted = targets.map(item => item.id);
  assert.equal(targets.length, 65);
  const { plan, preview } = run([keep, ...targets], wanted);
  assert.equal(preview.finalNewDiscardIds.length, 65);
  assert.equal(preview.rescuedFromNewDiscardIds.length, 1);
  assert.equal(plan.discardDraft?.groups.length, 1);
  assert.equal(plan.rescueDraft?.groups.length, 1);

  const mixed = run([keep, { ...keep, id: "indistinguishable-target" }, ...targets], [...wanted, "indistinguishable-target"]);
  assert.equal(mixed.preview.finalNewDiscardIds.length, 65);
  assert.equal(mixed.preview.rescuedFromNewDiscardIds.length, 2);

  // E cannot distinguish this old discard from the retained normal item.
  const blocked = run([keep, ...targets, { ...keep, id: "history", garbage: true }], wanted);
  assert.equal(blocked.preview.finalNewDiscardIds.length, 60);
  assert.equal(blocked.plan.rescueDraft, null);
});
test("boss intrinsic filters separate retained variants and still protect ordinary souls", () => {
  const target = item("boss-drop", { name: "土蜘蛛", intrinsicStats: { crit: .08 } });
  const keep = { ...target, id: "boss-keep", intrinsicStats: { defensePercent: .16 } };
  const ordinary = item("ordinary-keep");
  const { plan, preview } = run([target, keep, ordinary], [target.id]);
  assert.deepEqual(preview.finalNewDiscardIds, [target.id]);
  assert.deepEqual(plan.discardDraft?.groups[0]?.criteria?.intrinsicStats, ["crit"]);
});
test("generalized rules reach the net cleanup quota while preserving non-targets", () => {
  const items = [
    item("a", { subStats: { speed: 2, crit: .03 } }),
    item("b", { subStats: { speed: 2, attack: 20 } }),
    item("c", { subStats: { crit: .03, attack: 20 } }),
    item("keep", { subStats: { effectHit: .04, effectResist: .04 } })
  ];
  const plan = buildDecisionPlan(items, new Set(["a", "b", "c"]), header, 3);
  const preview = previewDualFilterShares({ items, discardShare: plan.discardDraft && filterShareFromDraft(plan.discardDraft), rescueShare: plan.rescueDraft && filterShareFromDraft(plan.rescueDraft) });
  assert.deepEqual(new Set(preview.finalNewDiscardIds), new Set(["a", "b", "c"]));
  assert.ok((plan.discardDraft?.groups.length ?? 0) <= 2);
});
test("mixed inventories preserve every non-target and historical pool across deterministic runs", () => {
  const stats = ["speed", "crit", "attack", "defense", "hp", "effectHit", "effectResist"] as const;
  for (let seed = 1; seed <= 4; seed++) {
    let state = seed;
    const random = (limit: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % limit; };
    const items = Array.from({ length: 400 }, (_, i) => {
      const subStats: YyxYuhun["subStats"] = {};
      for (let j = 0, size = 2 + random(3); j < size; j++) subStats[stats[random(stats.length)]!] = 1;
      return item(`${seed}-${i}`, {
        name: YUHUN_TYPES[random(25)]!, position: 1 + random(6), subStats,
        level: random(8) < 6 ? 0 : 1 + random(15), star: random(10) ? 6 : 5,
        lock: random(10) === 0, garbage: random(8) === 0,
        intrinsicStats: random(4) === 0 ? { crit: .08 } : {}
      });
    });
    const wanted = items.filter(() => random(5) < 3).map(item => item.id);
    const { plan } = run(items, wanted);
    assert.deepEqual(buildDecisionPlan(items, new Set(wanted), header), plan);
  }
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

test("impact allowance unlocks indistinguishable +0 retain classes but never hard protection", () => {
  const items = [
    ...Array.from({ length: 100 }, (_, i) => item(`drop-a-${i}`)), item("soft-a"),
    ...Array.from({ length: 100 }, (_, i) => item(`drop-b-${i}`, { name: "火灵" })), item("soft-b", { name: "火灵" }),
    item("enhance", { name: "破势" }), item("locked", { lock: true }), item("upgraded", { level: 15 }),
    item("history", { garbage: true }),
    item("level2", { name: "针女", level: 2 }), item("drop-blocked", { name: "针女" })
  ];
  const wanted = new Set(items.filter(i => i.id.startsWith("drop")).map(i => i.id));
  const eligible = new Set(["soft-a", "soft-b", "locked", "upgraded", "history", "level2"]);
  const preview = (budget: number, quota: number) => {
    const plan = buildDecisionPlan(items, wanted, header, quota, eligible, budget);
    return previewDualFilterShares({ items, discardShare: plan.discardDraft && filterShareFromDraft(plan.discardDraft), rescueShare: plan.rescueDraft && filterShareFromDraft(plan.rescueDraft) });
  };
  assert.equal(preview(0, 202).finalNewDiscardIds.length, 0);
  assert.equal(preview(1, 202).finalNewDiscardIds.length, 101);
  const both = preview(2, 202);
  assert.equal(both.finalNewDiscardIds.length, 202);
  assert.deepEqual(both.incidentalRestoreIds, []);
  assert.deepEqual(both.finalNewDiscardIds.filter(id => !wanted.has(id)).sort(), ["soft-a", "soft-b"]);
  assert.equal(preview(2, 101).finalNewDiscardIds.length, 101);
  assert.equal(preview(2, 0).finalNewDiscardIds.length, 0);
});

test("zero-impact coverage takes priority even with a generous allowance", () => {
  const items = [item("drop"), item("soft", { name: "火灵" })];
  const plan = buildDecisionPlan(items, new Set(["drop"]), header, 1, new Set(["soft"]), 1);
  const preview = previewDualFilterShares({ items, discardShare: plan.discardDraft && filterShareFromDraft(plan.discardDraft), rescueShare: plan.rescueDraft && filterShareFromDraft(plan.rescueDraft) });
  assert.deepEqual(preview.finalNewDiscardIds, ["drop"]);
});

test("workflow excludes enhancement matches from allowance, including overlapping discard rules", () => {
  const items = [item("soft"), item("enhance", { name: "火灵" }), item("locked", { lock: true }), item("history", { garbage: true }), item("level1", { level: 1 }), item("level15", { level: 15 }), item("five", { star: 5 })];
  const workflow = new YuhunWorkflow();
  Object.assign(workflow, { items });
  const criteria = filterShareFromDraft({ headerHex: header, planKind: "enhance", groups: [{ name: "强化", criteria: { types: ["火灵"] } }] }).groups[0]!.criteria;
  const summary = workflow.analyze({ defaultDisposition: "retain", templateIds: [], riskTier: "tier1", rules: [
    { id: "e", label: "强化", pool: "enhance", criteria }, { id: "d", label: "弃置", pool: "discard", criteria }
  ] });
  assert.equal(summary.impactEligibleCount, 1);
  const generate = (percent: number) => workflow.generatePlan({ staticPolicy: DEFAULT_STATIC_RETENTION_POLICY, retainedImpactPercent: percent });
  assert.equal(generate(99.9).summary.retentionImpact?.budget, 0);
  assert.equal(generate(100).summary.retentionImpact?.budget, 1);
  assert.equal(generate(0).summary.retentionImpact?.budget, 0);
  assert.throws(() => generate(101));
  assert.throws(() => generate(NaN));
});

test("workflow validates and reports a nonzero allowance without weakening enhancement protection", () => {
  const items = [...Array.from({ length: 101 }, (_, i) => item(`drop-${i}`)), item("soft"), item("enhance", { name: "火灵" }), ...Array.from({ length: 5897 }, (_, i) => item(`locked-${i}`, { lock: true }))];
  const workflow = new YuhunWorkflow();
  Object.assign(workflow, { items });
  const criteria = filterShareFromDraft({ headerHex: header, planKind: "enhance", groups: [{ name: "强化", criteria: { types: ["火灵"] } }] }).groups[0]!.criteria;
  workflow.analyze({ defaultDisposition: "discard", templateIds: [], riskTier: "tier1", rules: [{ id: "e", pool: "enhance", label: "强化", criteria }], teamReports: [{
    id: "t", label: "测试阵容", scope: "individual-best", successfulCount: 1, unsupportedCount: 0, entities: [{
      entityIndex: 0, shikigamiId: null, shikigamiName: "测试式神", metricId: null, metricName: "输出", status: "success", message: "", score: 1, panel: null, pieces: [], exact: true,
      candidateCount: 1, candidateCombinations: 1, evaluatedCombinations: 1, constraints: [], targetScoreRaw: null,
      potentialEvidence: [{ yuhunId: "soft", strategy: "upgrade-upper-bound", position: 2, referenceSuit: null, referenceLevel: null, statesEvaluated: 1, upperScore: 2, baselineScore: 1, exactEmbryo: false }]
    }]
  }] });
  const generate = (retainedImpactPercent: number) => workflow.generatePlan({ staticPolicy: DEFAULT_STATIC_RETENTION_POLICY, desiredFreeSlots: 100, retainedImpactPercent });
  assert.equal(generate(0).summary.finalNewDiscardCount, 0);
  const relaxed = generate(100).summary;
  assert.equal(relaxed.finalNewDiscardCount, 102);
  assert.equal(relaxed.desiredFreeSlotsReached, true);
  assert.equal(relaxed.retentionImpact?.eligibleCount, 1);
  assert.equal(relaxed.retentionImpact?.budget, 1);
  assert.equal(relaxed.retentionImpact?.actualPercent, 100);
  assert.equal(relaxed.retentionImpact?.affectedItems.length, 1);
  assert.equal(relaxed.retentionImpact?.affectedItems[0]?.reason, "阵容提升");
  assert.equal(workflow.getGateState().retainedItemsProtected, true);
  assert.equal(generate(0).summary.finalNewDiscardCount, 0);
});
