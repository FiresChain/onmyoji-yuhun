import { filterShareFromDraft, previewDualFilterShares } from "./rules.js";
import type { FilterCriteria, YuhunFilterShare } from "./types.js";
import type { YyxYuhun } from "./yyx.js";

export interface PlanCriteria {
  readonly discard: readonly FilterCriteria[];
  readonly rescue: readonly FilterCriteria[];
}

export type PlanDifference = "extra-discard" | "extra-retain" | "both-discard" | "both-retain";
export type PlanComparisonFilter = PlanDifference | "changed" | "all";
export type PlanComparisonCounts = Readonly<Record<PlanDifference, number>>;

export interface PlanComparisonResult {
  readonly differences: readonly PlanDifference[];
  readonly counts: PlanComparisonCounts;
  readonly baseDiscardCount: number;
  readonly nextDiscardCount: number;
}

function share(criteria: readonly FilterCriteria[], planKind: "discard" | "enhance"): YuhunFilterShare | null {
  return criteria.length === 0 ? null : filterShareFromDraft({
    headerHex: "00".repeat(16), planKind,
    groups: criteria.map((entry, index) => ({ name: String(index + 1), criteria: entry }))
  });
}

function finalDiscardIds(items: readonly YyxYuhun[], plan: PlanCriteria): ReadonlySet<string> {
  const preview = previewDualFilterShares({ items, discardShare: share(plan.discard, "discard"), rescueShare: share(plan.rescue, "enhance") });
  const restored = new Set(preview.incidentalRestoreIds);
  return new Set([
    ...items.filter(item => item.garbage && !restored.has(item.id)).map(item => item.id),
    ...preview.finalNewDiscardIds
  ]);
}

/** Apply each D/E pair independently to the same starting inventory. */
export function comparePlanCriteria(items: readonly YyxYuhun[], base: PlanCriteria, next: PlanCriteria): PlanComparisonResult {
  const baseDiscard = finalDiscardIds(items, base);
  const nextDiscard = finalDiscardIds(items, next);
  const counts: Record<PlanDifference, number> = { "extra-discard": 0, "extra-retain": 0, "both-discard": 0, "both-retain": 0 };
  const differences = items.map((item): PlanDifference => {
    const before = baseDiscard.has(item.id);
    const after = nextDiscard.has(item.id);
    const difference = before ? (after ? "both-discard" : "extra-retain") : (after ? "extra-discard" : "both-retain");
    counts[difference]++;
    return difference;
  });
  return { differences, counts, baseDiscardCount: baseDiscard.size, nextDiscardCount: nextDiscard.size };
}
