import { calculateCleanupQuota } from "./capacity.js";
import { filterShareFromDraft, previewDualFilterShares, validateGroupName, type DualFilterDrafts, DEFAULT_STATIC_RETENTION_POLICY, MAX_FILTER_GROUPS } from "./rules.js";
import { optimizeDecisionRules, type PriorityPlanInput } from "./filter-optimization.js";
import { matchFilterShare } from "./matcher.js";
import type { YuhunFilterDraft, YuhunFilterDraftGroup } from "./types.js";
import type { YyxYuhun } from "./yyx.js";
import type { AnalysisRuleInput } from "./yuhun-decision.js";

export type DecisionPlan = Omit<DualFilterDrafts, "decision">;
function draft(headerHex: string, kind: "discard" | "enhance", groups: YuhunFilterDraftGroup[]): YuhunFilterDraft | null {
  return groups.length ? { headerHex, planKind: kind, groups } : null;
}

/** Current-inventory safe rule compression. Unknown/future inventory is not certified. */
export function buildDecisionPlan(items: readonly YyxYuhun[], discardIds: ReadonlySet<string>, headerHex: string, requiredRelease = Infinity, impactIds: ReadonlySet<string> = new Set(), impactBudget = 0, priority?: PriorityPlanInput & { readonly presetRules: readonly AnalysisRuleInput[]; readonly desiredFreeSlots?: number }): DecisionPlan {
  if (!/^[0-9a-f]{32}$/i.test(headerHex)) throw new Error("Header 必须是 16 字节十六进制");
  if (requiredRelease !== Infinity && (!Number.isSafeInteger(requiredRelease) || requiredRelease < 0)) throw new Error("清理目标必须为非负整数");
  const domain = items.filter(item => !item.lock && !item.garbage && item.star === 6 && item.level <= 2);
  const wanted = new Set(domain.filter(item => item.level === 0 && discardIds.has(item.id)).map(item => item.id));
  if (!Number.isSafeInteger(impactBudget) || impactBudget < 0) throw new Error("允许影响数量必须为非负整数");
  const eligibleImpact = new Set(domain.filter(item => item.level === 0 && !wanted.has(item.id) && impactIds.has(item.id)).map(item => item.id));
  const previewDrafts = (discard: YuhunFilterDraft | null, rescue: YuhunFilterDraft | null) => previewDualFilterShares({
    items, discardShare: discard && filterShareFromDraft(discard), rescueShare: rescue && filterShareFromDraft(rescue)
  });
  const baseDiscard: YuhunFilterDraftGroup[] = [], baseRescue: YuhunFilterDraftGroup[] = [];
  for (const { label, criteria, pool } of priority?.presetRules ?? []) {
    validateGroupName(label);
    (pool === "discard" ? baseDiscard : baseRescue).push({ name: label, criteria });
  }
  if (baseDiscard.length > MAX_FILTER_GROUPS || baseRescue.length > MAX_FILTER_GROUPS) throw new Error("预设 D 码和 E 码各最多允许 60 条规则");
  const originalDiscardDraft = draft(headerHex, "discard", baseDiscard);
  const originalRescueDraft = draft(headerHex, "enhance", baseRescue);
  const basePreview = originalDiscardDraft || originalRescueDraft ? previewDrafts(originalDiscardDraft, originalRescueDraft) : null;
  const baseDiscardIds = new Set(basePreview?.finalNewDiscardIds);
  // Only uncovered normal items are optimization targets. Make original D
  // drops look historical to the optimizer so appended E cannot undo them.
  let baseSixStarCount = 0, remainingSixStarCount = 0, remainingLevel15Count = 0;
  const supplementItems = priority ? items.map(item => {
    const discarded = baseDiscardIds.has(item.id);
    if (item.star === 6) {
      if (discarded) baseSixStarCount++;
      else {
        remainingSixStarCount++;
        if (item.level === 15) remainingLevel15Count++;
      }
    }
    return discarded ? { ...item, garbage: true } : item;
  }) : items;
  const baseCovered = new Set(basePreview?.newDiscardIds);
  if (originalRescueDraft) for (const id of matchFilterShare(filterShareFromDraft(originalRescueDraft), items.filter(item => !item.garbage)).unionIds) baseCovered.add(id);
  const supplementalTargets = new Set([...wanted].filter(id => !baseCovered.has(id)));
  const tiers = priority?.tiers.map(tier => new Set([...tier].filter(id => eligibleImpact.has(id) && !baseCovered.has(id))));
  const supplementQuota = priority?.desiredFreeSlots === undefined
    ? Math.max(0, requiredRelease - baseSixStarCount)
    : calculateCleanupQuota({ totalCount: remainingSixStarCount, level15Count: remainingLevel15Count, desiredFreeSlots: priority.desiredFreeSlots }).requiredRelease;
  const optimized = optimizeDecisionRules(
    supplementItems, supplementalTargets, supplementQuota, eligibleImpact, impactBudget,
    tiers === undefined ? undefined : { tiers },
    { discard: MAX_FILTER_GROUPS - baseDiscard.length, rescue: MAX_FILTER_GROUPS - baseRescue.length }
  );
  const discardDraft = draft(headerHex, "discard", [...baseDiscard, ...optimized.discard]);
  const rescueDraft = draft(headerHex, "enhance", [...baseRescue, ...optimized.rescue]);
  if (!baseDiscard.every((group, i) => discardDraft?.groups[i] === group) || !baseRescue.every((group, i) => rescueDraft?.groups[i] === group)) throw new Error("双码覆盖验证失败：预设规则发生改变");
  const preview = previewDrafts(discardDraft, rescueDraft);
  const extraDiscard = preview.finalNewDiscardIds.filter(id => !baseDiscardIds.has(id));
  const affected = extraDiscard.filter(id => !supplementalTargets.has(id));
  const allowed = tiers === undefined ? eligibleImpact : new Set(tiers.slice(0, optimized.activeTierCount).flatMap(tier => [...tier]));
  const cleanupDomain = new Set(domain.filter(item => item.level === 0).map(item => item.id));
  const finalDiscard = new Set(preview.finalNewDiscardIds);
  if (affected.length > impactBudget || affected.some(id => !allowed.has(id)) || extraDiscard.some(id => !cleanupDomain.has(id))) throw new Error("双码覆盖验证失败：额外规则超出允许影响范围或数量");
  if ([...baseCovered].some(id => finalDiscard.has(id) !== baseDiscardIds.has(id))) throw new Error("双码覆盖验证失败：额外规则改变了预设清理结果");
  const baseRestoredIds = new Set(basePreview?.incidentalRestoreIds);
  if (preview.incidentalRestoreIds.length !== baseRestoredIds.size || preview.incidentalRestoreIds.some(id => !baseRestoredIds.has(id))) throw new Error("双码覆盖验证失败：额外规则改变了历史弃置御魂的捞回结果");
  const dCount = discardDraft?.groups.length ?? 0, eCount = rescueDraft?.groups.length ?? 0;
  return { discardDraft, rescueDraft, manifest: { policy: DEFAULT_STATIC_RETENTION_POLICY, discardSuitIds: [], protectedSuitIds: [], discardGroupCount: dCount, rescueGroupCount: eCount, decisionRescueGroupCount: eCount, staticRescueGroupCount: 0, decisionCellCount: optimized.cellCount, discardDomainDecisionCellCount: domain.length, requiredDecisionRetainCellCount: domain.length - wanted.size - affected.length, auditedDecisionRetainCellCount: domain.length - wanted.size - affected.length, groups: [...(discardDraft?.groups ?? []).map((group, i) => ({ name: group.name, kind: "discard-domain" as const, description: i < baseDiscard.length ? "预设弃置规则" : "按本次分析生成的 +0 清理规则" })), ...(rescueDraft?.groups ?? []).map((group, i) => ({ name: group.name, kind: "decision" as const, description: i < baseRescue.length ? "预设捞回规则" : "保护额度外保留项及无法区分的 1–2 级御魂" }))] } };
}
