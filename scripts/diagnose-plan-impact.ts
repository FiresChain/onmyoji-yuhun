/** Read a private diagnostic export locally; print aggregate counts only. Never encode or upload. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { YuhunWorkflow, type AnalyzeInput, type AnalysisSummaryDTO, type GeneratePlanInput } from "../src/workflow.js";
import { parseGameSnapshot } from "../src/yyx.js";
import { buildYuhunDecisionRows, type AnalysisRuleInput } from "../src/yuhun-decision.js";
import { filterShareFromDraft, previewDualFilterShares } from "../src/rules.js";
import type { FilterCriteria, StatId, SubStatCount } from "../src/types.js";

interface DiagnosticSession {
  settings: Omit<AnalyzeInput, "templateIds"> & { templateIds: readonly string[]; staticPolicy: GeneratePlanInput["staticPolicy"] };
  presetRules: readonly { id: string; pool: "discard" | "enhance"; label: string; enabled: boolean;
    filter?: FilterCriteria; suits: string[]; positions: number[]; mainStats: StatId[]; requiredSubStats: StatId[];
    subStatCounts?: SubStatCount[]; subStatCount?: SubStatCount | "any" }[];
  teamCalculations: NonNullable<AnalyzeInput["teamReports"]>;
  analysis: AnalysisSummaryDTO | null;
}

const [path, targetText = "500", ...percentTexts] = process.argv.slice(2);
if (!path) throw new Error("用法：node --import tsx scripts/diagnose-plan-impact.ts <私有诊断文件> [预期空位=500] [比例，如 0 1 3 5]");
const data = JSON.parse(await readFile(path, "utf8")) as { snapshotText: string; snapshotSha256: string; session: DiagnosticSession };
assert.equal(createHash("sha256").update(data.snapshotText).digest("hex"), data.snapshotSha256, "快照哈希不匹配");
const session = data.session;
const rules: AnalysisRuleInput[] = session.presetRules.filter(rule => rule.enabled).map(rule => ({
  id: rule.id, pool: rule.pool, label: rule.label,
  criteria: rule.filter ?? {
    types: [...rule.suits], positions: [...rule.positions], stars: [], levelRanges: [], mainStats: [...rule.mainStats],
    subStats: rule.requiredSubStats.map(stat => ({ stat, requirement: "include" })),
    subStatCounts: [...(rule.subStatCounts ?? (rule.subStatCount && rule.subStatCount !== "any" ? [rule.subStatCount] : []))],
    intrinsicStats: [], unknownTypeBits: [], unknownOptionBits: []
  }
}));
const workflow = new YuhunWorkflow();
workflow.importSnapshot(JSON.parse(data.snapshotText), data.snapshotSha256);
const analysis = workflow.analyze({ ...session.settings, templateIds: session.settings.templateIds.filter((id): id is "zhaocai-speed" | "scattered-speed" => id === "zhaocai-speed" || id === "scattered-speed"), rules, teamReports: session.teamCalculations });
assert.equal(analysis.markedDiscardProjection.discardCount, session.analysis?.markedDiscardProjection.discardCount, "重算标记数量与诊断不一致");
const items = parseGameSnapshot(JSON.parse(data.snapshotText)).items;
const decisions = buildYuhunDecisionRows(items, rules, session.teamCalculations, session.settings.defaultDisposition);
const eligible = new Set(items.filter((item, index) => {
  const row = decisions[index]!;
  return row.disposition === "retain" && item.star === 6 && item.level === 0 && !item.lock && !item.garbage && !row.matchedRules?.some(rule => rule.pool === "enhance");
}).map(item => item.id));
const marked = new Set(items.filter((item, index) => decisions[index]!.disposition === "discard" && item.star === 6 && item.level === 0 && !item.lock && !item.garbage).map(item => item.id));
const desiredFreeSlots = Number(targetText);
assert.ok(Number.isSafeInteger(desiredFreeSlots) && desiredFreeSlots >= 0);
const percentages = percentTexts.length ? percentTexts.map(Number) : [0, 1, 3, 5];
console.log(JSON.stringify({ marked: marked.size, eligible: eligible.size, capacity: analysis.inventoryCapacity }));
for (const retainedImpactPercent of percentages) {
  const started = performance.now();
  const generated = workflow.generatePlan({ staticPolicy: session.settings.staticPolicy, desiredFreeSlots, retainedImpactPercent });
  const plan = generated.summary, impact = plan.retentionImpact!;
  const preview = previewDualFilterShares({ items,
    discardShare: generated.discardDraft && filterShareFromDraft(generated.discardDraft),
    rescueShare: generated.rescueDraft && filterShareFromDraft(generated.rescueDraft)
  });
  const affected = preview.finalNewDiscardIds.filter(id => !marked.has(id));
  assert.ok(affected.every(id => eligible.has(id)), "清理了严格保护项");
  assert.ok(affected.length <= impact.budget, "超出允许影响额度");
  assert.equal(new Set(impact.affectedItems.map(row => row.row)).size, affected.length);
  assert.equal(plan.finalNewDiscardCount, preview.finalNewDiscardIds.length);
  assert.deepEqual(preview.incidentalRestoreIds, []);
  assert.ok(plan.discardGroupCount <= 60 && plan.rescueGroupCount <= 60);
  assert.equal(workflow.getGateState().retainedItemsProtected, true);
  console.log(JSON.stringify({ percent: retainedImpactPercent, budget: impact.budget, affected: affected.length,
    actualPercent: impact.actualPercent, required: plan.requiredRelease, cleaned: plan.finalNewDiscardCount,
    free: plan.capacityProjection?.after.freeSlots, reached: plan.desiredFreeSlotsReached,
    D: plan.discardGroupCount, E: plan.rescueGroupCount, elapsedMs: Math.round(performance.now() - started) }));
}
