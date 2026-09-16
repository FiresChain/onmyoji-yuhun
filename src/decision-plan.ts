import { filterShareFromDraft, previewDualFilterShares, type DualFilterDrafts, DEFAULT_STATIC_RETENTION_POLICY } from "./rules.js";
import { optimizeDecisionRules } from "./filter-optimization.js";
import type { FilterCriteria, YuhunFilterDraft, YuhunFilterDraftGroup } from "./types.js";
import type { YyxYuhun } from "./yyx.js";

export type DecisionPlan = Omit<DualFilterDrafts, "decision">;
function draft(headerHex: string, kind: "discard" | "enhance", groups: FilterCriteria[]): YuhunFilterDraft | null {
  return groups.length ? { headerHex, planKind: kind, groups: groups.map((criteria, i): YuhunFilterDraftGroup => ({ name: `${kind === "discard" ? "D" : "E"}${String(i + 1).padStart(2, "0")}|${kind === "discard" ? "清理" : "保留"}`, criteria })) } : null;
}

/** Current-inventory safe rule compression. Unknown/future inventory is not certified. */
export function buildDecisionPlan(items: readonly YyxYuhun[], discardIds: ReadonlySet<string>, headerHex: string, requiredRelease = Infinity): DecisionPlan {
  if (!/^[0-9a-f]{32}$/i.test(headerHex)) throw new Error("Header 必须是 16 字节十六进制");
  if (requiredRelease !== Infinity && (!Number.isSafeInteger(requiredRelease) || requiredRelease < 0)) throw new Error("清理目标必须为非负整数");
  const domain = items.filter(item => !item.lock && !item.garbage && item.star === 6 && item.level <= 2);
  const wanted = new Set(domain.filter(item => item.level === 0 && discardIds.has(item.id)).map(item => item.id));
  const optimized = optimizeDecisionRules(items, wanted, requiredRelease);
  const discardDraft = draft(headerHex, "discard", optimized.discard);
  const rescueDraft = draft(headerHex, "enhance", optimized.rescue);
  const preview = previewDualFilterShares({ items, discardShare: discardDraft && filterShareFromDraft(discardDraft), rescueShare: rescueDraft && filterShareFromDraft(rescueDraft) });
  if (preview.finalNewDiscardIds.some(id => !wanted.has(id))) throw new Error("双码覆盖验证失败：命中了应保留御魂");
  if (preview.incidentalRestoreIds.length) throw new Error("双码覆盖验证失败：恢复了历史弃置御魂");
  const dCount = discardDraft?.groups.length ?? 0, eCount = rescueDraft?.groups.length ?? 0;
  return { discardDraft, rescueDraft, manifest: { policy: DEFAULT_STATIC_RETENTION_POLICY, discardSuitIds: [], protectedSuitIds: [], discardGroupCount: dCount, rescueGroupCount: eCount, decisionRescueGroupCount: eCount, staticRescueGroupCount: 0, decisionCellCount: optimized.cellCount, discardDomainDecisionCellCount: domain.length, requiredDecisionRetainCellCount: domain.length - wanted.size, auditedDecisionRetainCellCount: domain.length - wanted.size, groups: [...(discardDraft?.groups ?? []).map(group => ({ name: group.name, kind: "discard-domain" as const, description: "按本次分析生成的 +0 清理规则" })), ...(rescueDraft?.groups ?? []).map(group => ({ name: group.name, kind: "decision" as const, description: "保护分析保留项及无法区分的 1–2 级御魂" }))] } };
}
