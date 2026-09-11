import { filterShareFromDraft, previewDualFilterShares, type DualFilterDrafts, DEFAULT_STATIC_RETENTION_POLICY } from "./rules.js";
import { STAT_LABELS } from "./mappings.js";
import type { FilterCriteria, StatId, YuhunFilterDraft, YuhunFilterDraftGroup } from "./types.js";
import type { YyxYuhun } from "./yyx.js";

export type DecisionPlan = Omit<DualFilterDrafts, "decision">;
const stats = Object.keys(STAT_LABELS) as StatId[];
function criteria(item: YyxYuhun): FilterCriteria {
  return { types: [item.name], positions: [item.position], stars: [6], levelRanges: ["0-2"], mainStats: [item.mainStat],
    subStats: stats.map(stat => ({ stat, requirement: Object.hasOwn(item.subStats, stat) ? "include" : "exclude" })),
    subStatCounts: [], intrinsicStats: [], unknownTypeBits: [], unknownOptionBits: [] };
}
const key = (value: FilterCriteria) => JSON.stringify(value);
function draft(headerHex: string, kind: "discard" | "enhance", groups: FilterCriteria[]): YuhunFilterDraft | null {
  return groups.length ? { headerHex, planKind: kind, groups: groups.map((criteria, i): YuhunFilterDraftGroup => ({ name: `${kind === "discard" ? "D" : "E"}${String(i + 1).padStart(2, "0")}|${kind === "discard" ? "清理" : "保留"}`, criteria })) } : null;
}

/** Current-inventory safe rule compression. Unknown/future inventory is not certified. */
export function buildDecisionPlan(items: readonly YyxYuhun[], discardIds: ReadonlySet<string>, headerHex: string, requiredRelease = Infinity): DecisionPlan {
  if (!/^[0-9a-f]{32}$/i.test(headerHex)) throw new Error("Header 必须是 16 字节十六进制");
  if (requiredRelease !== Infinity && (!Number.isSafeInteger(requiredRelease) || requiredRelease < 0)) throw new Error("清理目标必须为非负整数");
  const domain = items.filter(item => !item.lock && !item.garbage && item.star === 6 && item.level <= 2);
  const wanted = new Set(domain.filter(item => item.level === 0 && discardIds.has(item.id)).map(item => item.id));
  const buckets = new Map<string, { criteria: FilterCriteria; wanted: number; protected: boolean }>();
  for (const item of domain) {
    const c = criteria(item), k = key(c);
    const bucket = buckets.get(k) ?? { criteria: c, wanted: 0, protected: false };
    if (wanted.has(item.id)) bucket.wanted++; else bucket.protected = true;
    buckets.set(k, bucket);
  }
  // Always available fallback: at most 60 exact, safe buckets, ranked by cleanup.
  const safe = [...buckets.values()].filter(bucket => !bucket.protected && bucket.wanted > 0)
    .sort((a, b) => b.wanted - a.wanted || key(a.criteria).localeCompare(key(b.criteria)));
  const selected: typeof safe = [];
  let best = 0;
  const available = [...safe];
  while (available.length && selected.length < 60 && best < requiredRelease) {
    const remaining = requiredRelease - best;
    // A whole rule must be applied. Prefer the smallest rule that finishes the
    // quota when the largest rule would otherwise overshoot it.
    let index = 0;
    if (available[0]!.wanted >= remaining) {
      for (let i = 1; i < available.length && available[i]!.wanted >= remaining; i++) index = i;
    }
    const bucket = available.splice(index, 1)[0]!;
    selected.push(bucket);
    best += bucket.wanted;
  }
  let discardDraft = draft(headerHex, "discard", selected.map(bucket => bucket.criteria));
  let rescueDraft: YuhunFilterDraft | null = null;
  if (wanted.size && best < requiredRelease) {
    const broad = { ...criteria(domain[0]!), types: [], positions: [], mainStats: [], subStats: [] };
    const broadD = draft(headerHex, "discard", [broad]);
    let protections = [...buckets.values()].filter(bucket => bucket.protected).map(bucket => bucket.criteria);
    // Bounded coarsening: widen rescue rules only, never lose a protected bucket.
    for (const dimension of [null, "types", "subStats", "mainStats", "positions"] as const) {
      if (dimension) protections = [...new Map(protections.map(c => { const widened = { ...c, [dimension]: [] }; return [key(widened), widened]; })).values()];
      if (protections.length > 60) continue;
      const e = draft(headerHex, "enhance", protections);
      const preview = previewDualFilterShares({ items, discardShare: broadD && filterShareFromDraft(broadD), rescueShare: e && filterShareFromDraft(e) });
      if (preview.finalNewDiscardIds.length > best) {
        best = preview.finalNewDiscardIds.length; discardDraft = broadD; rescueDraft = e;
        if (best >= requiredRelease) break;
      }
    }
  }
  const preview = previewDualFilterShares({ items, discardShare: discardDraft && filterShareFromDraft(discardDraft), rescueShare: rescueDraft && filterShareFromDraft(rescueDraft) });
  if (preview.finalNewDiscardIds.some(id => !wanted.has(id))) throw new Error("双码覆盖验证失败：命中了应保留御魂");
  const dCount = discardDraft?.groups.length ?? 0, eCount = rescueDraft?.groups.length ?? 0;
  return { discardDraft, rescueDraft, manifest: { policy: DEFAULT_STATIC_RETENTION_POLICY, discardSuitIds: [], protectedSuitIds: [], discardGroupCount: dCount, rescueGroupCount: eCount, decisionRescueGroupCount: eCount, staticRescueGroupCount: 0, decisionCellCount: buckets.size, discardDomainDecisionCellCount: domain.length, requiredDecisionRetainCellCount: domain.length - wanted.size, auditedDecisionRetainCellCount: domain.length - wanted.size, groups: [...(discardDraft?.groups ?? []).map(group => ({ name: group.name, kind: "discard-domain" as const, description: "按本次分析生成的 +0 清理规则" })), ...(rescueDraft?.groups ?? []).map(group => ({ name: group.name, kind: "decision" as const, description: "保护分析保留项及无法区分的 1–2 级御魂" }))] } };
}
