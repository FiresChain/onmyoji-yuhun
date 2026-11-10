import { filterShareFromDraft, previewDualFilterShares, type DualFilterDrafts, DEFAULT_STATIC_RETENTION_POLICY, MAX_FILTER_GROUPS } from "./rules.js";
import { optimizeDecisionRules, type PriorityPlanInput } from "./filter-optimization.js";
import { matchFilterShare } from "./matcher.js";
import type { YuhunFilterDraft, YuhunFilterDraftGroup } from "./types.js";
import type { YyxYuhun } from "./yyx.js";

export type DecisionPlan = Omit<DualFilterDrafts, "decision">;
function draft(headerHex: string, kind: "discard" | "enhance", groups: YuhunFilterDraftGroup[]): YuhunFilterDraft | null {
  return groups.length ? { headerHex, planKind: kind, groups } : null;
}

/** Current-inventory safe rule compression. Unknown/future inventory is not certified. */
export function buildDecisionPlan(items: readonly YyxYuhun[], discardIds: ReadonlySet<string>, headerHex: string, requiredRelease = Infinity, impactIds: ReadonlySet<string> = new Set(), impactBudget = 0, priority?: PriorityPlanInput & { readonly presetDiscardIds: ReadonlySet<string> }): DecisionPlan {
  if (!/^[0-9a-f]{32}$/i.test(headerHex)) throw new Error("Header 必须是 16 字节十六进制");
  if (requiredRelease !== Infinity && (!Number.isSafeInteger(requiredRelease) || requiredRelease < 0)) throw new Error("清理目标必须为非负整数");
  const domain = items.filter(item => !item.lock && !item.garbage && item.star === 6 && item.level <= 2);
  const wanted = new Set(domain.filter(item => item.level === 0 && discardIds.has(item.id)).map(item => item.id));
  if (!Number.isSafeInteger(impactBudget) || impactBudget < 0) throw new Error("允许影响数量必须为非负整数");
  const eligibleImpact = new Set(domain.filter(item => item.level === 0 && !wanted.has(item.id) && impactIds.has(item.id)).map(item => item.id));
  const previewDrafts = (discard: YuhunFilterDraft | null, rescue: YuhunFilterDraft | null) => previewDualFilterShares({
    items, discardShare: discard && filterShareFromDraft(discard), rescueShare: rescue && filterShareFromDraft(rescue)
  });
  const presetTargets = new Set([...wanted].filter(id => priority?.presetDiscardIds.has(id)));
  const base = presetTargets.size && priority
    ? optimizeDecisionRules(items, presetTargets, Infinity, undefined, 0, { tiers: [], presetRules: priority.presetRules })
    : { discard: [], rescue: [], cellCount: 0 };
  const baseRescue = draft(headerHex, "enhance", base.rescue);
  const basePreview = base.discard.length ? previewDrafts(draft(headerHex, "discard", base.discard), baseRescue) : null;
  const baseDiscardIds = new Set(basePreview?.finalNewDiscardIds);
  // Supplemental E must treat the base cleanup as already discarded. Base E
  // matches remain protected even if supplemental D would otherwise select them.
  const supplementItems = baseDiscardIds.size ? items.map(item => baseDiscardIds.has(item.id) ? { ...item, garbage: true } : item) : items;
  const protectedByBaseE = baseRescue ? new Set(matchFilterShare(filterShareFromDraft(baseRescue), items).unionIds) : new Set<string>();
  const supplementalTargets = new Set([...wanted].filter(id => !presetTargets.has(id) && !protectedByBaseE.has(id)));
  const tiers = priority?.tiers.map(tier => new Set([...tier].filter(id => !protectedByBaseE.has(id))));
  const optimized = optimizeDecisionRules(
    supplementItems, supplementalTargets, Math.max(0, requiredRelease - baseDiscardIds.size), eligibleImpact, impactBudget,
    tiers === undefined ? undefined : { tiers, presetRules: [] },
    { discard: MAX_FILTER_GROUPS - base.discard.length, rescue: MAX_FILTER_GROUPS - base.rescue.length }
  );
  const discardDraft = draft(headerHex, "discard", [...base.discard, ...optimized.discard]);
  const rescueDraft = draft(headerHex, "enhance", [...base.rescue, ...optimized.rescue]);
  const preview = previewDrafts(discardDraft, rescueDraft);
  const affected = preview.finalNewDiscardIds.filter(id => !wanted.has(id));
  const allowed = tiers === undefined ? eligibleImpact : new Set(tiers.slice(0, optimized.activeTierCount).flatMap(tier => [...tier]));
  const allowedCount = tiers === undefined ? impactBudget : allowed.size;
  const cleanupDomain = new Set(domain.filter(item => item.level === 0).map(item => item.id));
  const finalDiscard = new Set(preview.finalNewDiscardIds);
  if (affected.length > allowedCount || affected.some(id => !allowed.has(id)) || preview.finalNewDiscardIds.some(id => !cleanupDomain.has(id))) throw new Error("双码覆盖验证失败：超出允许影响范围或数量");
  if ([...baseDiscardIds].some(id => !finalDiscard.has(id)) || [...presetTargets].some(id => finalDiscard.has(id) !== baseDiscardIds.has(id))) throw new Error("双码覆盖验证失败：额外规则改变了预设清理结果");
  if (preview.incidentalRestoreIds.length) throw new Error("双码覆盖验证失败：恢复了历史弃置御魂");
  const dCount = discardDraft?.groups.length ?? 0, eCount = rescueDraft?.groups.length ?? 0;
  return { discardDraft, rescueDraft, manifest: { policy: DEFAULT_STATIC_RETENTION_POLICY, discardSuitIds: [], protectedSuitIds: [], discardGroupCount: dCount, rescueGroupCount: eCount, decisionRescueGroupCount: eCount, staticRescueGroupCount: 0, decisionCellCount: Math.max(base.cellCount, optimized.cellCount), discardDomainDecisionCellCount: domain.length, requiredDecisionRetainCellCount: domain.length - wanted.size - affected.length, auditedDecisionRetainCellCount: domain.length - wanted.size - affected.length, groups: [...(discardDraft?.groups ?? []).map(group => ({ name: group.name, kind: "discard-domain" as const, description: "按本次分析生成的 +0 清理规则" })), ...(rescueDraft?.groups ?? []).map(group => ({ name: group.name, kind: "decision" as const, description: "保护额度外保留项及无法区分的 1–2 级御魂" }))] } };
}
