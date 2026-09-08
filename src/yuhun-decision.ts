import { speedDecisionCategoryKey, type SpeedCategoryDecision } from "./decision.js";
import { matchFilterShare } from "./matcher.js";
import type { FilterCriteria, StatId, YuhunFilterShare } from "./types.js";
import type { TeamCalculationPieceDTO, TeamCalculationReportDTO, TeamCalculationYuhunDTO } from "./team-calculation.js";
import type { YyxYuhun } from "./yyx.js";
import type { YuhunPotentialStrategy } from "./yuhun-potential.js";

export type YuhunDecisionDisposition = "discard" | "retain";

export interface AnalysisRuleInput {
  readonly id: string;
  readonly pool: "discard" | "enhance";
  readonly label: string;
  readonly criteria: FilterCriteria;
}

export interface YuhunPotentialTarget {
  readonly position: number;
  readonly teamLabel: string;
  readonly shikigamiName: string;
  readonly metricName: string;
  readonly score: number | null;
  readonly strategy: YuhunPotentialStrategy;
  readonly statesEvaluated: number;
  readonly referenceSuit: string | null;
  readonly referenceLevel: number | null;
  readonly exactEmbryo: boolean;
  readonly candidate: YuhunPotentialPieceDTO | null;
  readonly reference: YuhunPotentialPieceDTO | null;
  readonly upperScore: number | null;
  readonly baselineScore: number | null;
}

/** Display-only attributes for a private, in-browser potential-yuhun comparison. */
export interface YuhunPotentialPieceDTO {
  readonly position: number;
  readonly suit: string;
  readonly mainStat: StatId;
  readonly mainStatLabel: string;
  readonly mainValue?: number;
  readonly level: number;
  readonly star: number;
  readonly subStats?: readonly { readonly stat: StatId; readonly value: number }[];
  readonly intrinsicStats?: readonly { readonly stat: StatId; readonly value: number }[];
}

/** A privacy-safe, one-row-per-yuhun decision DTO. It intentionally omits the raw item ID. */
export interface YuhunDecisionRowDTO {
  readonly row: number;
  readonly suit: string;
  readonly position: number;
  readonly star: number;
  readonly level: number;
  readonly mainStat: StatId;
  readonly subStats: readonly StatId[];
  readonly initialSubStatCount: number | null;
  readonly locked: boolean;
  readonly garbage: boolean;
  readonly disposition: YuhunDecisionDisposition;
  readonly reason: string;
  readonly matchedRuleNames: readonly string[];
  readonly potentialTargets: readonly YuhunPotentialTarget[];
}

function emptyRuleMatches(): { discard: string[]; enhance: string[] } {
  return { discard: [], enhance: [] };
}

function potentialPiece(item: TeamCalculationYuhunDTO | TeamCalculationPieceDTO | null): YuhunPotentialPieceDTO | null {
  if (item === null) return null;
  return {
    position: item.position,
    suit: item.suit,
    mainStat: item.mainStat,
    mainStatLabel: item.mainStatLabel,
    ...(item.mainValue === undefined ? {} : { mainValue: item.mainValue }),
    level: item.level,
    star: item.star,
    ...(item.subStats === undefined ? {} : { subStats: item.subStats }),
    ...(item.intrinsicStats === undefined ? {} : { intrinsicStats: item.intrinsicStats })
  };
}

function ruleShare(rule: AnalysisRuleInput): YuhunFilterShare {
  return {
    format: "onmyoji-yuhun-filter",
    schemaVersion: 1,
    headerHex: "",
    planKind: rule.pool,
    planKindValue: rule.pool === "discard" ? 0 : 1,
    groups: [{
      name: rule.label,
      raw: { typeMaskHex: "", optionMaskHex: "" },
      criteria: rule.criteria
    }],
    warnings: []
  };
}

function potentialTargetsByItem(
  reports: readonly TeamCalculationReportDTO[]
): ReadonlyMap<string, readonly YuhunPotentialTarget[]> {
  const result = new Map<string, YuhunPotentialTarget[]>();
  for (const report of reports) {
    for (const entity of report.entities) {
      if (entity.status !== "success") continue;
      const evidence = entity.potentialEvidence ?? (entity.potentialYuhunIds ?? []).map((yuhunId) => ({
        yuhunId,
        strategy: "candidate-build" as const,
        position: 0,
        referenceSuit: null,
        referenceYuhunId: null,
        referenceLevel: null,
        statesEvaluated: 0,
        upperScore: null,
        baselineScore: entity.score,
        exactEmbryo: false
      }));
      if (evidence.length === 0) continue;
      for (const entry of evidence) {
        const reference = entry.strategy === "candidate-build"
          ? null
          : entry.referenceYuhunId === undefined || entry.referenceYuhunId === null
          ? entity.pieces.find((item) => item.position === entry.position) ?? null
          : entity.pieces.find((item) => item.yuhunId === entry.referenceYuhunId) ?? null;
        const target: YuhunPotentialTarget = {
          position: entry.position,
          teamLabel: report.label,
          shikigamiName: entity.shikigamiName,
          metricName: entity.metricName,
          score: entity.score,
          strategy: entry.strategy,
          statesEvaluated: entry.statesEvaluated,
          referenceSuit: entry.referenceSuit,
          referenceLevel: entry.referenceLevel,
          exactEmbryo: entry.exactEmbryo,
          candidate: potentialPiece(entity.potentialYuhunDetails?.find((item) => item.yuhunId === entry.yuhunId) ?? null),
          reference: potentialPiece(reference),
          upperScore: entry.upperScore,
          baselineScore: entry.baselineScore
        };
        const id = entry.yuhunId;
        const values = result.get(id) ?? [];
        const duplicate = values.some((value) =>
          value.teamLabel === target.teamLabel &&
          value.shikigamiName === target.shikigamiName &&
          value.metricName === target.metricName &&
          value.strategy === target.strategy
        );
        if (!duplicate) values.push(target);
        result.set(id, values);
      }
    }
  }
  return result;
}

function baselineDecisionByItem(
  items: readonly YyxYuhun[],
  decisions: readonly SpeedCategoryDecision[]
): ReadonlyMap<string, SpeedCategoryDecision | undefined> {
  const byKey = new Map(decisions.map((decision) => [decision.key, decision]));
  const result = new Map<string, SpeedCategoryDecision | undefined>();
  for (const item of items) {
    const initial = item.initialSubStats;
    if (initial === null) {
      result.set(item.id, undefined);
      continue;
    }
    const initialCount = Object.keys(initial).length;
    if (initialCount < 1 || initialCount > 4) {
      result.set(item.id, undefined);
      continue;
    }
    const key = speedDecisionCategoryKey({
      suitId: item.suitId,
      category: {
        position: item.position as 1 | 2 | 3 | 4 | 5 | 6,
        mainStatIsSpeed: item.mainStat === "speed",
        initialCount: initialCount as 1 | 2 | 3 | 4,
        initialSpeedPresent: Object.prototype.hasOwnProperty.call(initial, "speed")
      }
    });
    result.set(item.id, byKey.get(key));
  }
  return result;
}

function formatPotentialTargets(targets: readonly YuhunPotentialTarget[]): string {
  const labels: Readonly<Record<YuhunPotentialStrategy, string>> = {
    "candidate-build": "候选组合",
    "embryo-comparison": "胚子对比",
    "upgrade-upper-bound": "强化上界"
  };
  const groups = new Map<YuhunPotentialStrategy, string[]>();
  for (const target of targets) {
    const suffix = target.strategy === "upgrade-upper-bound" && target.statesEvaluated > 0
      ? `（${target.statesEvaluated} 种状态）`
      : target.referenceSuit === null ? "" : `（对比 ${target.referenceSuit} ${target.referenceLevel === null ? "" : `+${target.referenceLevel}`}）`;
    const description = `${target.teamLabel}/${target.shikigamiName}/${target.metricName}${suffix}`;
    const values = groups.get(target.strategy) ?? [];
    if (!values.includes(description)) values.push(description);
    groups.set(target.strategy, values);
  }
  if (groups.size === 1 && groups.has("candidate-build")) {
    return groups.get("candidate-build")!.join("、");
  }
  return [...groups.entries()]
    .map(([strategy, values]) => {
      const label = strategy === "embryo-comparison" && targets.some((target) => target.strategy === strategy && !target.exactEmbryo)
        ? "胚子属性类型对比"
        : labels[strategy];
      return `${label}：${values.join("、")}`;
    })
    .join("；");
}

/**
 * Resolve explicit filter rules first, then use the team calculator's candidate
 * and potential strategies, and finally preserve the existing speed baseline as
 * a conservative fallback.
 */
export function buildYuhunDecisionRows(
  items: readonly YyxYuhun[],
  rules: readonly AnalysisRuleInput[],
  baselineDecisions: readonly SpeedCategoryDecision[],
  teamReports: readonly TeamCalculationReportDTO[]
): YuhunDecisionRowDTO[] {
  const matches = new Map<string, { discard: string[]; enhance: string[] }>();
  for (const rule of rules) {
    const report = matchFilterShare(ruleShare(rule), items);
    const group = report.groups[0];
    for (const id of group?.matchedIds ?? []) {
      const entry = matches.get(id) ?? emptyRuleMatches();
      entry[rule.pool].push(rule.label);
      matches.set(id, entry);
    }
  }
  const potential = potentialTargetsByItem(teamReports);
  const baseline = baselineDecisionByItem(items, baselineDecisions);
  return items.map((item, index): YuhunDecisionRowDTO => {
    const ruleMatch = matches.get(item.id) ?? emptyRuleMatches();
    const potentialTargets = potential.get(item.id) ?? [];
    const matchedRuleNames = [...ruleMatch.enhance, ...ruleMatch.discard];
    let disposition: YuhunDecisionDisposition = "retain";
    let reason: string;
    if (item.lock) {
      reason = "已锁定";
    } else if (ruleMatch.enhance.length > 0) {
      disposition = "retain";
      reason = `命中规则：${ruleMatch.enhance.join("、")}`;
      if (ruleMatch.discard.length > 0) reason += `；同时命中弃置规则：${ruleMatch.discard.join("、")}`;
    } else if (ruleMatch.discard.length > 0) {
      disposition = "discard";
      reason = ruleMatch.discard.length > 1
        ? `弃置未捞回（规则：${ruleMatch.discard.join("、")}）`
        : "弃置未捞回";
    } else if (potentialTargets.length > 0) {
      reason = `可能提升：${formatPotentialTargets(potentialTargets)}`;
    } else {
      const fallback = baseline.get(item.id);
      disposition = fallback?.disposition ?? "retain";
      reason = fallback === undefined
        ? "未命中规则且没有可用的 baseline 依据"
        : `未命中规则且未发现阵容提升；baseline ${fallback.disposition === "discard" ? "判定弃置" : "保留"}`;
    }
    return {
      row: index + 1,
      suit: item.name,
      position: item.position,
      star: item.star,
      level: item.level,
      mainStat: item.mainStat,
      subStats: Object.keys(item.subStats) as StatId[],
      initialSubStatCount: item.initialSubStats === null ? null : Object.keys(item.initialSubStats).length,
      locked: item.lock,
      garbage: item.garbage,
      disposition,
      reason,
      matchedRuleNames,
      potentialTargets
    };
  });
}
