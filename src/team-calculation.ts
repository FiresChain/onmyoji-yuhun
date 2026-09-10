import {
  calculateIndicator,
  calculatePanel,
  matchesConstraints,
  searchYuhunBuilds,
  type Indicator,
  type Panel,
  type PanelStatId,
  type ValueConstraint,
  type Yuhun
} from "./calculation.js";
import {
  STAT_LABELS,
  SUB_STAT_MAX_ROLLS,
  canonicalYuhunName,
  findTwoPieceEffectByName
} from "./mappings.js";
import type { IntrinsicStatId, StatId } from "./types.js";
import type { SnapshotHeroBase, YyxYuhun } from "./yyx.js";
import {
  enumerateMaximumUpgradeStates,
  samePotentialContribution,
  remainingUpgradeRolls,
  type YuhunPotentialStrategy
} from "./yuhun-potential.js";

export const TEAM_METRIC_NAMES = {
  1: "伤害输出",
  2: "效果命中",
  3: "效果抵抗",
  4: "生命",
  5: "攻击",
  6: "防御",
  7: "速度",
  8: "暴击",
  9: "暴击伤害",
  10: "治疗量",
  11: "命抗双修",
  12: "防御输出"
} as const;

/** Stable identifiers for performance comparisons across releases. */
export const TEAM_CALCULATION_ALGORITHM_VERSION = "team-search-v3" as const;
export const TEAM_CALCULATION_SEARCH_DEFAULTS = {
  maxCombinations: 5_000_000,
  beamWidth: 2_000,
  candidateLimitPerPosition: 40
} as const;

export type TeamMetricId = keyof typeof TEAM_METRIC_NAMES;
export type TeamCalculationStatus = "success" | "no-match" | "unsupported" | "disabled";

export interface ManualPanelRange {
  readonly stat: PanelStatId | "extra";
  readonly min?: number;
  readonly max?: number;
  readonly percentage: boolean;
}

export interface TeamExtraAttributes {
  readonly attackPercent?: number;
  readonly attack?: number;
  readonly crit?: number;
  readonly critDamage?: number;
}

export interface ManualSuitRequirement {
  readonly name: string;
  readonly count: 2 | 4;
}

export interface ManualShikigamiCalculationInput {
  readonly entityIndex: number;
  readonly shikigamiId: number;
  readonly shikigamiName: string;
  readonly metricId: TeamMetricId;
  /** Legacy display projection. New drafts also retain suitRequirements. */
  readonly suits: readonly string[];
  /** Each selected suit records its own two-piece or four-piece requirement. */
  readonly suitRequirements?: readonly ManualSuitRequirement[];
  /** Selecting 散件 ends suit selection without adding another set constraint. */
  readonly suitSelectionComplete?: boolean;
  readonly mainStats: Readonly<Partial<Record<2 | 4 | 6, readonly StatId[]>>>;
  readonly ranges: readonly ManualPanelRange[];
  /** Decimal units: 0.2 means 20% for percentage attributes. */
  readonly extraAttributes?: TeamExtraAttributes;
  readonly sixStarOnly: boolean;
  readonly maxLevelOnly: boolean;
  readonly highestStat: PanelStatId | "extra" | null;
  readonly scope: "all" | "unequipped";
  readonly excludeOccupied: boolean;
  readonly targetScore: number | null;
  /** Whether this lineup member participates in yuhun calculation. Missing legacy values default to true. */
  readonly yuhunConfigEnabled?: boolean;
}

export interface TeamCalculationRequest {
  readonly id: string;
  readonly label: string;
  /** Team-code input is projected by onmyoji-api before it reaches this calculator. */
  readonly manualTargets: readonly ManualShikigamiCalculationInput[];
  /** Scene identity used to scope temporary cross-lineup exclusion. */
  readonly sceneId?: string;
  /** When enabled, lineups in the same scene share temporary occupancy. */
  readonly sceneMutualExclusion?: boolean;
  /** Occupied yuhun IDs from earlier calculations in the same scene. */
  readonly occupiedYuhunIds?: readonly string[];
}

/**
 * A search-free workload estimate used only to order independent lineups.
 * It deliberately contains no inventory IDs or result data.
 */
export interface TeamCalculationWorkEstimate {
  readonly requestId: string;
  readonly activeEntityCount: number;
  readonly candidateCount: number;
  readonly candidateCombinations: number;
  readonly estimatedWork: number;
}

export interface TeamCalculationProgress {
  readonly phase: "team-calculation";
  /** The lineup currently being processed. Optional for compatibility with legacy callers. */
  readonly targetId?: string;
  /** Display name of the lineup currently being processed. */
  readonly targetLabel?: string;
  /** Zero-based lineup position in the current batch. */
  readonly targetIndex?: number;
  /** Number of lineups in the current batch. */
  readonly targetTotal?: number;
  readonly completed: number;
  readonly total: number;
  readonly current: string;
  readonly currentShikigamiId?: number;
  readonly detail: string;
}

export interface TeamCalculationPieceDTO {
  readonly yuhunId?: string;
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

/** Safe, display-only inventory data used by potential-yuhun drill-downs. */
export interface TeamCalculationYuhunDTO {
  readonly yuhunId: string;
  readonly position: number;
  readonly suit: string;
  readonly mainStat: StatId;
  readonly mainStatLabel: string;
  readonly mainValue: number;
  readonly level: number;
  readonly star: number;
  readonly subStats: readonly { readonly stat: StatId; readonly value: number }[];
  readonly intrinsicStats: readonly { readonly stat: StatId; readonly value: number }[];
}

export interface TeamCalculationPotentialEvidenceDTO {
  readonly comparisonNote?: string;
  readonly yuhunId: string;
  readonly strategy: YuhunPotentialStrategy;
  readonly position: number;
  readonly referenceSuit: string | null;
  readonly referenceYuhunId?: string | null;
  readonly referenceLevel: number | null;
  readonly statesEvaluated: number;
  readonly upperScore: number | null;
  readonly baselineScore: number | null;
  readonly exactEmbryo: boolean;
}

export interface TeamCalculationEntityDTO {
  readonly entityIndex: number;
  readonly shikigamiId: number | null;
  readonly shikigamiName: string;
  readonly metricId: number | null;
  readonly metricName: string;
  readonly status: TeamCalculationStatus;
  readonly message: string;
  readonly score: number | null;
  readonly panel: Panel | null;
  readonly pieces: readonly TeamCalculationPieceDTO[];
  readonly exact: boolean | null;
  readonly candidateCount: number;
  readonly candidateCombinations: number;
  readonly evaluatedCombinations: number;
  /** Wall-clock time spent calculating this target, in milliseconds. */
  readonly elapsedMs?: number;
  /** Stable stage timings used to compare algorithm changes. */
  readonly stageTimings?: readonly {
    readonly id: "candidate-filter" | "combination-search" | "potential-evaluation";
    readonly elapsedMs: number;
  }[];
  /** IDs are kept inside the worker-facing report and used to mark useful inventory rows. */
  readonly potentialYuhunIds?: readonly string[];
  readonly potentialYuhunDetails?: readonly TeamCalculationYuhunDTO[];
  readonly potentialEvidence?: readonly TeamCalculationPotentialEvidenceDTO[];
  readonly constraints: readonly string[];
  readonly targetScoreRaw: unknown;
}

export interface TeamCalculationReportDTO {
  readonly id: string;
  readonly label: string;
  readonly scope: "individual-best" | "ordered-dynamic-bounds";
  readonly entities: readonly TeamCalculationEntityDTO[];
  readonly successfulCount: number;
  readonly unsupportedCount: number;
  /** Temporary yuhun reservations produced by this lineup. */
  readonly reservedYuhunIds?: readonly string[];
  /** Wall-clock time spent calculating this lineup, in milliseconds. */
  readonly elapsedMs?: number;
}

interface IncludedSetGroup {
  readonly names: readonly string[];
  readonly count: number;
  /** Matching boss souls can use their per-piece intrinsic property instead of a named pair. */
  readonly intrinsicStat?: IntrinsicStatId;
}

interface CalculationTarget {
  readonly entityIndex: number;
  readonly shikigamiId: number;
  readonly shikigamiName: string | null;
  readonly metricId: number;
  readonly includedSetGroups: readonly IncludedSetGroup[];
  readonly excludedSuitNames: ReadonlySet<string>;
  readonly mainStats: Readonly<Partial<Record<2 | 4 | 6, readonly StatId[]>>>;
  readonly constraints: Partial<Record<PanelStatId, ValueConstraint>>;
  readonly bonusStats: TeamExtraAttributes;
  readonly highestStats: readonly PanelStatId[];
  readonly sixStarOnly: boolean;
  readonly maxLevelOnly: boolean;
  readonly unequippedOnly: boolean;
  readonly targetScoreRaw: unknown;
  readonly unsupportedReasons: readonly string[];
}

const INDICATORS: Readonly<Record<number, Indicator>> = {
  1: "damageOutput",
  2: "effectHit",
  3: "effectResist",
  4: "hp",
  5: "attack",
  6: "defense",
  7: "speed",
  8: "crit",
  9: "critDamage",
  10: "healing",
  11: "hitResist",
  12: "defenseOutput"
};

const SIX_STAR_MAIN_STAT_MAX: Readonly<Record<number, Partial<Record<StatId, number>>>> = {
  1: { attack: 486 },
  2: { attackPercent: 0.55, hpPercent: 0.55, defensePercent: 0.55, speed: 57 },
  3: { defense: 104 },
  4: { attackPercent: 0.55, hpPercent: 0.55, defensePercent: 0.55, effectHit: 0.55, effectResist: 0.55 },
  5: { hp: 2052 },
  6: { attackPercent: 0.55, hpPercent: 0.55, defensePercent: 0.55, crit: 0.55, critDamage: 0.89 }
};

function metricName(id: number | null): string {
  return id !== null && id in TEAM_METRIC_NAMES
    ? TEAM_METRIC_NAMES[id as TeamMetricId]
    : id === null ? "未知指标" : `指标 #${id}`;
}

function intrinsicStatForTwoPieceEffect(stat: StatId): IntrinsicStatId | undefined {
  switch (stat) {
    case "attackPercent":
    case "defensePercent":
    case "hpPercent":
    case "effectHit":
    case "effectResist":
    case "crit":
      return stat;
    default:
      return undefined;
  }
}

function broadTwoPieceEffectGroup(names: readonly string[], stat: StatId, count: number): IncludedSetGroup {
  const intrinsicStat = intrinsicStatForTwoPieceEffect(stat);
  return intrinsicStat === undefined
    ? { names, count }
    : { names, count, intrinsicStat };
}

function targetFromManual(input: ManualShikigamiCalculationInput): CalculationTarget {
  const unsupported: string[] = [];
  if (INDICATORS[input.metricId] === undefined) unsupported.push(`${metricName(input.metricId)}评分公式尚未确认`);
  if (input.highestStat === "extra") unsupported.push("额外属性不能作为动态上限");
  // Kept on the per-member schema for backward compatibility. Cross-lineup
  // occupancy is now controlled by the scene-level request metadata.
  const constraints: Partial<Record<PanelStatId, ValueConstraint>> = {};
  for (const range of input.ranges) {
    if (range.stat === "extra") {
      unsupported.push("额外属性尚未纳入面板叠加公式");
      continue;
    }
    const divisor = range.percentage ? 100 : 1;
    constraints[range.stat] = {
      ...(range.min === undefined ? {} : { min: range.min / divisor }),
      ...(range.max === undefined ? {} : { max: range.max / divisor })
    };
  }
  const bonusStats: TeamExtraAttributes = {};
  for (const [stat, value] of Object.entries(input.extraAttributes ?? {}) as Array<[keyof TeamExtraAttributes, number]>) {
    if (!Number.isFinite(value)) {
      unsupported.push(`额外${STAT_LABELS[stat]}数值无法识别`);
    } else if (value < 0) {
      unsupported.push(`额外${STAT_LABELS[stat]}不允许为负数`);
    } else if (value !== 0) {
      (bonusStats as Record<keyof TeamExtraAttributes, number>)[stat] = value;
    }
  }
  return {
    entityIndex: input.entityIndex,
    shikigamiId: input.shikigamiId,
    shikigamiName: input.shikigamiName,
    metricId: input.metricId,
    includedSetGroups: manualSuitRequirements(input).map(({ name, count }) => {
      const broadEffect = findTwoPieceEffectByName(name);
      return broadEffect === undefined
        ? { names: [canonicalYuhunName(name)], count }
        : broadTwoPieceEffectGroup(broadEffect.suitNames, broadEffect.stat, count);
    }),
    excludedSuitNames: new Set(),
    mainStats: Object.fromEntries(
      Object.entries(input.mainStats).filter(([, stats]) => stats !== undefined && stats.length > 0)
    ) as CalculationTarget["mainStats"],
    constraints,
    bonusStats,
    highestStats: input.highestStat === null || input.highestStat === "extra" ? [] : [input.highestStat],
    sixStarOnly: input.sixStarOnly,
    maxLevelOnly: input.maxLevelOnly,
    unequippedOnly: input.scope === "unequipped",
    targetScoreRaw: input.targetScore,
    unsupportedReasons: unsupported
  };
}

function manualSuitRequirements(input: ManualShikigamiCalculationInput): readonly ManualSuitRequirement[] {
  if (input.suitRequirements !== undefined) {
    return input.suitRequirements.filter((requirement) => (
      requirement.name.trim() !== "" && (requirement.count === 2 || requirement.count === 4)
    ));
  }
  // Existing saved drafts stored only names, with the first entry meaning four pieces.
  return input.suits.filter(Boolean).map((name, index) => ({ name, count: index === 0 ? 4 : 2 }));
}

interface DynamicUpperBound {
  readonly value: number;
  readonly sourceEntityIndex: number;
  readonly sourceName: string;
}

type DynamicUpperBounds = Partial<Record<PanelStatId, DynamicUpperBound>>;

function formatPanelValue(stat: PanelStatId, value: number): string {
  const percent = stat === "crit" || stat === "critDamage" || stat === "effectHit" || stat === "effectResist";
  return percent ? `${(value * 100).toFixed(1)}%` : value.toFixed(1).replace(/\.0$/, "");
}

function constraintDescriptions(target: CalculationTarget, dynamicBounds: DynamicUpperBounds = {}): string[] {
  const descriptions = target.includedSetGroups.map((group) => `${group.names.join("/")}${group.intrinsicStat === undefined ? "" : `/首领固有${STAT_LABELS[group.intrinsicStat]}`} ${group.count} 件套`);
  for (const [position, stats] of Object.entries(target.mainStats) as Array<[string, readonly StatId[]]>) {
    descriptions.push(`${position}号位 ${stats.map((stat) => STAT_LABELS[stat]).join("/")}`);
  }
  for (const [stat, range] of Object.entries(target.constraints) as Array<[PanelStatId, ValueConstraint]>) {
    const bound = dynamicBounds[stat];
    const maximum = bound?.value ?? range.max;
    const source = bound === undefined ? "" : `（上限由左侧 ${bound.sourceName} 的最高属性覆盖）`;
    const operator = bound === undefined ? "~" : `< ${maximum === undefined ? "-" : formatPanelValue(stat, maximum)}`;
    descriptions.push(`${STAT_LABELS[stat]} ${range.min === undefined ? "-" : formatPanelValue(stat, range.min)} ${operator}${bound === undefined && maximum !== undefined ? formatPanelValue(stat, maximum) : ""}${source}`);
  }
  for (const [stat, bound] of Object.entries(dynamicBounds) as Array<[PanelStatId, DynamicUpperBound]>) {
    if (target.constraints[stat] === undefined) {
      descriptions.push(`${STAT_LABELS[stat]} < ${formatPanelValue(stat, bound.value)}（由左侧 ${bound.sourceName} 的最高属性传递）`);
    }
  }
  const extraDescriptions: Array<[keyof TeamExtraAttributes, string, boolean]> = [
    ["attackPercent", "攻击加成", true],
    ["attack", "攻击", false],
    ["crit", "暴击", true],
    ["critDamage", "暴击伤害", true]
  ];
  for (const [stat, label, percentage] of extraDescriptions) {
    const value = target.bonusStats[stat];
    if (value !== undefined && value !== 0) {
      const formatted = percentage ? `${(value * 100).toFixed(1)}%` : String(value);
      descriptions.push(`额外${label} ${value > 0 ? "+" : ""}${formatted}`);
    }
  }
  if (target.highestStats.length > 0) descriptions.push(`向右传递最高属性：${target.highestStats.map((stat) => STAT_LABELS[stat]).join("/")}`);
  if (target.sixStarOnly) descriptions.push("仅六星");
  if (target.maxLevelOnly) descriptions.push("仅 +15");
  return descriptions;
}

function emptyResult(
  target: CalculationTarget,
  status: TeamCalculationStatus,
  message: string,
  dynamicBounds: DynamicUpperBounds = {}
): TeamCalculationEntityDTO {
  return {
    entityIndex: target.entityIndex,
    shikigamiId: target.shikigamiId,
    shikigamiName: target.shikigamiName ?? `式神 #${target.shikigamiId}`,
    metricId: target.metricId,
    metricName: metricName(target.metricId),
    status,
    message,
    score: null,
    panel: null,
    pieces: [],
    exact: null,
    candidateCount: 0,
    candidateCombinations: 0,
    evaluatedCombinations: 0,
    potentialYuhunIds: [],
    potentialYuhunDetails: [],
    potentialEvidence: [],
    constraints: constraintDescriptions(target, dynamicBounds),
    targetScoreRaw: target.targetScoreRaw
  };
}

interface TargetCalculationOutcome {
  readonly result: TeamCalculationEntityDTO;
  readonly selectedYuhunIds: readonly string[];
}

function withoutSelection(result: TeamCalculationEntityDTO): TargetCalculationOutcome {
  return { result, selectedYuhunIds: [] };
}

function cappedPanel(panel: Panel): Panel {
  return { ...panel, crit: Math.min(1, panel.crit) };
}

function maximumMainValue(candidate: YyxYuhun, reference: Yuhun): number {
  if (candidate.level >= 15) return candidate.mainValue;
  if (
    candidate.star === reference.star &&
    candidate.position === reference.position &&
    candidate.mainStat === reference.mainStat &&
    reference.level === 15
  ) return reference.mainValue;
  if (candidate.star !== 6) return candidate.mainValue;
  return SIX_STAR_MAIN_STAT_MAX[candidate.position]?.[candidate.mainStat] ?? candidate.mainValue;
}

function potentialCandidateAllowed(
  target: CalculationTarget,
  item: YyxYuhun,
  usedYuhunIds: ReadonlySet<string>,
  requiredSetsFillAllSlots: boolean,
  requiredNames: ReadonlySet<string>
): boolean {
  if (usedYuhunIds.has(item.id)) return false;
  if (target.sixStarOnly && item.star !== 6) return false;
  if (target.unequippedOnly && item.equipped) return false;
  if (target.excludedSuitNames.has(item.name)) return false;
  if (requiredSetsFillAllSlots && !requiredNames.has(item.name)) return false;
  if (item.position === 2 || item.position === 4 || item.position === 6) {
    const allowed = target.mainStats[item.position];
    if (allowed !== undefined && !allowed.includes(item.mainStat)) return false;
  }
  return true;
}

const TEAM_METRIC_WORK_FACTORS: Readonly<Record<TeamMetricId, number>> = {
  1: 2.4,
  2: 1.2,
  3: 1.2,
  4: 0.9,
  5: 1,
  6: 1,
  7: 0.8,
  8: 1,
  9: 1.5,
  10: 2,
  11: 1.8,
  12: 2.2
};

const WORK_ESTIMATE_MAX = 1e15;
const WORK_ESTIMATE_SUBSTAT_COUNT = Object.keys(SUB_STAT_MAX_ROLLS).length;

function requiredSetFilterForTarget(target: CalculationTarget): {
  readonly requiredNames: ReadonlySet<string>;
  readonly requiredSetsFillAllSlots: boolean;
} {
  const requiredNames = new Set(target.includedSetGroups.flatMap((group) => group.names));
  const groupsAreDisjoint = target.includedSetGroups.every((group) => group.intrinsicStat === undefined) && target.includedSetGroups.every((group, index) =>
    target.includedSetGroups.slice(index + 1).every((other) => group.names.every((name) => !other.names.includes(name)))
  );
  return {
    requiredNames,
    requiredSetsFillAllSlots: groupsAreDisjoint && target.includedSetGroups.reduce((total, group) => total + group.count, 0) >= 6
  };
}

function candidateFilterForTarget(
  target: CalculationTarget,
  items: readonly YyxYuhun[],
  usedYuhunIds: ReadonlySet<string>
): YyxYuhun[] {
  const { requiredNames, requiredSetsFillAllSlots } = requiredSetFilterForTarget(target);
  return items.filter((item) => {
    if (usedYuhunIds.has(item.id)) return false;
    if (target.sixStarOnly && item.star !== 6) return false;
    if (target.maxLevelOnly && item.level !== 15) return false;
    if (target.unequippedOnly && item.equipped) return false;
    if (target.excludedSuitNames.has(item.name)) return false;
    if (requiredSetsFillAllSlots && !requiredNames.has(item.name)) return false;
    if (item.position === 2 || item.position === 4 || item.position === 6) {
      const allowed = target.mainStats[item.position];
      if (allowed !== undefined && !allowed.includes(item.mainStat)) return false;
    }
    return true;
  });
}

function boundedProduct(values: readonly number[]): number {
  let result = 1;
  for (const value of values) {
    result *= value;
    if (result >= WORK_ESTIMATE_MAX) return WORK_ESTIMATE_MAX;
  }
  return result;
}

function boundedBinomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const smaller = Math.min(k, n - k);
  let result = 1;
  for (let index = 1; index <= smaller; index += 1) {
    result = result * (n - smaller + index) / index;
    if (result >= WORK_ESTIMATE_MAX) return WORK_ESTIMATE_MAX;
  }
  return result;
}

/**
 * Matches the cardinality of the deterministic upgrade-state search without
 * constructing its state objects. Low-level pieces can dominate runtime even
 * when the six-piece combination search itself is small.
 */
function estimatedUpgradeStateCount(item: Pick<YyxYuhun, "level" | "subStats">): number {
  const rolls = remainingUpgradeRolls(item.level);
  if (rolls === 0) return 1;
  const initialStatCount = Math.min(4, Object.keys(item.subStats).length);
  if (initialStatCount === 0) {
    return Array.from({ length: Math.min(4, rolls) }, (_, index) => {
      const addedStatCount = index + 1;
      return boundedBinomial(WORK_ESTIMATE_SUBSTAT_COUNT, addedStatCount)
        * boundedBinomial(rolls - 1, addedStatCount - 1);
    }).reduce((total, count) => Math.min(WORK_ESTIMATE_MAX, total + count), 0);
  }
  const maximumNewStats = Math.min(4 - initialStatCount, rolls);
  return Array.from({ length: maximumNewStats + 1 }, (_, addedStatCount) => (
    boundedBinomial(WORK_ESTIMATE_SUBSTAT_COUNT - initialStatCount, addedStatCount)
      * boundedBinomial(rolls + initialStatCount - 1, initialStatCount + addedStatCount - 1)
  )).reduce((total, count) => Math.min(WORK_ESTIMATE_MAX, total + count), 0);
}

function estimatePotentialEvaluationWork(
  target: CalculationTarget,
  items: readonly YyxYuhun[],
  usedYuhunIds: ReadonlySet<string>
): number {
  const { requiredNames, requiredSetsFillAllSlots } = requiredSetFilterForTarget(target);
  return items.reduce((total, item) => {
    if (item.level !== 0 || item.lock || !potentialCandidateAllowed(target, item, usedYuhunIds, requiredSetsFillAllSlots, requiredNames)) return total;
    // One compatibility comparison plus one pass per possible upgrade state.
    return Math.min(WORK_ESTIMATE_MAX, total + 1 + estimatedUpgradeStateCount(item));
  }, 0);
}

/** Estimate one request without running its combination search. */
export function estimateTeamCalculationWork(
  request: TeamCalculationRequest,
  items: readonly YyxYuhun[]
): TeamCalculationWorkEstimate {
  const activeTargets = request.manualTargets
    .filter((input) => input.yuhunConfigEnabled !== false)
    .map(targetFromManual)
    .filter((target) => target.unsupportedReasons.length === 0);
  let candidateCount = 0;
  let candidateCombinations = 0;
  let estimatedWork = 0;
  const usedYuhunIds = new Set(request.occupiedYuhunIds ?? []);
  for (const target of activeTargets) {
    const candidates = candidateFilterForTarget(target, items, usedYuhunIds);
    const byPosition = Array.from({ length: 6 }, (_, index) => candidates.filter((item) => item.position === index + 1));
    const combinations = boundedProduct(byPosition.map((position) => position.length));
    candidateCount += candidates.length;
    candidateCombinations = Math.min(WORK_ESTIMATE_MAX, candidateCombinations + combinations);
    const searchNodes = combinations <= TEAM_CALCULATION_SEARCH_DEFAULTS.maxCombinations
      ? combinations
      : TEAM_CALCULATION_SEARCH_DEFAULTS.beamWidth * byPosition.reduce((sum, position) => sum + position.length, 0);
    const potentialWork = estimatePotentialEvaluationWork(target, items, usedYuhunIds);
    estimatedWork += (candidates.length + searchNodes + potentialWork) * (TEAM_METRIC_WORK_FACTORS[target.metricId as TeamMetricId] ?? 1);
  }
  return {
    requestId: request.id,
    activeEntityCount: activeTargets.length,
    candidateCount,
    candidateCombinations,
    estimatedWork: Math.min(WORK_ESTIMATE_MAX, estimatedWork)
  };
}

function matchesRequiredSetGroups(
  yuhun: readonly Yuhun[],
  groups: readonly IncludedSetGroup[]
): boolean {
  const counts = new Map<string, number>();
  for (const item of yuhun) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  return groups.every((group) => (
    group.names.some((name) => (counts.get(name) ?? 0) >= group.count)
    || (group.intrinsicStat !== undefined && yuhun.filter((item) => item.intrinsicStats[group.intrinsicStat!] !== undefined).length >= group.count)
  ));
}

function addPotentialEvidence(
  target: Map<string, TeamCalculationPotentialEvidenceDTO>,
  evidence: TeamCalculationPotentialEvidenceDTO
): void {
  const key = `${evidence.yuhunId}|${evidence.strategy}|${evidence.position}`;
  const existing = target.get(key);
  if (existing === undefined || (evidence.upperScore ?? -Infinity) > (existing.upperScore ?? -Infinity)) {
    target.set(key, evidence);
  }
}

function calculatePotentialEvidence(
  target: CalculationTarget,
  items: readonly YyxYuhun[],
  hero: SnapshotHeroBase,
  baselinePanel: Panel,
  bestBuild: readonly Yuhun[],
  indicator: Indicator,
  effectiveConstraints: Partial<Record<PanelStatId, ValueConstraint>>,
  requiredSetsFillAllSlots: boolean,
  requiredNames: ReadonlySet<string>,
  usedYuhunIds: ReadonlySet<string>
): readonly TeamCalculationPotentialEvidenceDTO[] {
  const evidence = new Map<string, TeamCalculationPotentialEvidenceDTO>();
  const baseline = calculateIndicator(cappedPanel(baselinePanel), indicator);
  const baselineTolerance = Math.max(1, Math.abs(baseline)) * 1e-12;
  const references = bestBuild.filter((item) => item.level === 15);
  const referenceByPosition = new Map(references.map((item) => [item.position, item]));
  const stateCache = new Map<string, ReturnType<typeof enumerateMaximumUpgradeStates>>();

  for (const candidate of items) {
    if (candidate.level !== 0 || candidate.lock || !potentialCandidateAllowed(target, candidate, usedYuhunIds, requiredSetsFillAllSlots, requiredNames)) continue;
    const reference = referenceByPosition.get(candidate.position);
    if (reference === undefined) continue;

    // Fixed named requirements are not broadened into effect-equivalent suits.
    const fixedGroups = target.includedSetGroups.filter(group => group.names.length === 1 && group.intrinsicStat === undefined && group.names.includes(reference.name));
    if (fixedGroups.length && candidate.name !== reference.name) continue;
    if (!samePotentialContribution(candidate, reference)) continue;
    const equivalentPair = candidate.name !== reference.name;
    // Retain the reference set identity only for scoring the assumed future pair.
    // The evidence and displayed candidate always keep the real suit name.
    const comparisonNote = equivalentPair
      ? "按相同套装属性或固有属性贡献比较，假设后续可凑齐套装；不是立即换装结果。"
      : "同套装贡献比较；按最大成长计算潜力，不代表实际强化收益。";

    const stateKey = `${candidate.level}|${Object.entries(candidate.subStats).sort(([left], [right]) => left.localeCompare(right)).map(([stat, value]) => `${stat}:${value}`).join(",")}`;
    const states = stateCache.get(stateKey) ?? enumerateMaximumUpgradeStates(candidate);
    stateCache.set(stateKey, states);
    let bestUpperScore: number | null = null;
    for (const state of states) {
      const upgraded: Yuhun = {
        ...candidate,
        name: equivalentPair ? reference.name : candidate.name,
        level: 15,
        mainValue: maximumMainValue(candidate, reference),
        subStats: state.subStats
      };
      const replacement = bestBuild.map((item) => item.id === reference.id ? upgraded : item);
      if (!matchesRequiredSetGroups(replacement, target.includedSetGroups)) continue;
      const panel = cappedPanel(calculatePanel(hero.panel, replacement, target.bonusStats));
      if (!matchesConstraints(panel, effectiveConstraints)) continue;
      const score = calculateIndicator(panel, indicator);
      if (score > baseline + baselineTolerance && (bestUpperScore === null || score > bestUpperScore)) {
        bestUpperScore = score;
      }
    }
    if (bestUpperScore !== null) {
      const relevantStats = Object.keys(candidate.subStats).filter(stat => {
        const probe = calculatePanel(hero.panel, [{ ...candidate, mainValue: 0, subStats: { [stat]: SUB_STAT_MAX_ROLLS[stat as StatId] }, intrinsicStats: {} }], target.bonusStats);
        return calculateIndicator(cappedPanel(probe), indicator) > calculateIndicator(cappedPanel(calculatePanel(hero.panel, [], target.bonusStats)), indicator) + baselineTolerance;
      });
      addPotentialEvidence(evidence, {
        yuhunId: candidate.id,
        strategy: "upgrade-upper-bound",
        comparisonNote: `${comparisonNote} 候选现有评分相关副属性：${relevantStats.map(stat => STAT_LABELS[stat as StatId]).join("、") || "无直接增益属性"}（仅辅助说明，不还原初始属性）。`,
        position: candidate.position,
        referenceSuit: reference.name,
        referenceYuhunId: reference.id,
        referenceLevel: reference.level,
        statesEvaluated: states.length,
        upperScore: bestUpperScore,
        baselineScore: baseline,
        exactEmbryo: false
      });
    }
  }
  return [...evidence.values()];
}

function calculateTarget(
  target: CalculationTarget,
  items: readonly YyxYuhun[],
  heroBases: ReadonlyMap<number, SnapshotHeroBase>,
  dynamicBounds: DynamicUpperBounds,
  unresolvedHighestStats: ReadonlySet<PanelStatId>,
  usedYuhunIds: ReadonlySet<string>
): TargetCalculationOutcome {
  const startedAt = now();
  if (target.unsupportedReasons.some((reason) => reason.includes("配置开关处于关闭"))) {
    return withElapsed(withoutSelection(emptyResult(target, "disabled", target.unsupportedReasons.join("；"), dynamicBounds)), startedAt);
  }
  if (target.unsupportedReasons.length > 0) return withElapsed(withoutSelection(emptyResult(target, "unsupported", target.unsupportedReasons.join("；"), dynamicBounds)), startedAt);
  if (unresolvedHighestStats.size > 0) {
    const names = [...unresolvedHighestStats].map((stat) => STAT_LABELS[stat]).join("/");
    return withElapsed(withoutSelection(emptyResult(target, "no-match", `左侧最高属性 ${names} 未计算出达标结果，无法确定动态上限`, dynamicBounds)), startedAt);
  }
  const hero = heroBases.get(target.shikigamiId);
  if (hero === undefined) return withElapsed(withoutSelection(emptyResult(target, "unsupported", "快照中缺少该式神的基础面板", dynamicBounds)), startedAt);
  const indicator = INDICATORS[target.metricId]!;
  const effectiveConstraints: Partial<Record<PanelStatId, ValueConstraint>> = Object.fromEntries(
    Object.entries(target.constraints).map(([stat, range]) => [stat, { ...range }])
  );
  for (const [stat, bound] of Object.entries(dynamicBounds) as Array<[PanelStatId, DynamicUpperBound]>) {
    effectiveConstraints[stat] = { ...effectiveConstraints[stat], max: undefined, maxExclusive: bound.value };
  }
  const candidates = candidateFilterForTarget(target, items, usedYuhunIds);
  const candidateCount = candidates.length;
  const filterElapsedMs = Math.max(0, now() - startedAt);
  const searchStartedAt = now();
  const search = searchYuhunBuilds(hero.panel, candidates, {
    indicator,
    constraints: effectiveConstraints,
    bonusStats: target.bonusStats,
    requiredSetGroups: target.includedSetGroups,
    // Keep a small set of alternative optimal builds so inventory decisions can
    // recognize pieces that could improve a target even when they are not the
    // single deterministic winner.
    topN: target.highestStats.length > 0 ? 100 : 20,
    maxCombinations: TEAM_CALCULATION_SEARCH_DEFAULTS.maxCombinations,
    beamWidth: TEAM_CALCULATION_SEARCH_DEFAULTS.beamWidth,
    candidateLimitPerPosition: TEAM_CALCULATION_SEARCH_DEFAULTS.candidateLimitPerPosition
  });
  const searchElapsedMs = Math.max(0, now() - searchStartedAt);
  const leading = search.results[0];
  const scoreTolerance = leading === undefined ? 0 : Math.max(1, Math.abs(leading.score)) * 1e-12;
  const best = leading === undefined ? undefined : search.results
    .filter((result) => Math.abs(result.score - leading.score) <= scoreTolerance)
    .sort((left, right) => {
      for (const stat of target.highestStats) {
        const difference = right.panel[stat] - left.panel[stat];
        if (difference !== 0) return difference;
      }
      return 0;
    })[0];
  if (best === undefined) {
    const result = emptyResult(target, "no-match", "当前库存没有满足全部约束的六件套；动态上限不会自动放宽", dynamicBounds);
    return withElapsed(withoutSelection({ ...result, exact: search.exact, candidateCount, candidateCombinations: search.candidateCombinations, evaluatedCombinations: search.evaluatedCombinations, potentialYuhunIds: [], stageTimings: [
      { id: "candidate-filter", elapsedMs: filterElapsedMs },
      { id: "combination-search", elapsedMs: searchElapsedMs }
    ] }), startedAt);
  }
  const potentialEvidenceMap = new Map<string, TeamCalculationPotentialEvidenceDTO>();
  for (const result of search.results) {
    for (const item of result.yuhun) {
      addPotentialEvidence(potentialEvidenceMap, {
        yuhunId: item.id,
        strategy: "candidate-build",
        position: item.position,
        referenceSuit: null,
        referenceLevel: null,
        referenceYuhunId: null,
        statesEvaluated: 0,
        upperScore: result.score,
        baselineScore: best.score,
        exactEmbryo: false
      });
    }
  }
  const potentialStartedAt = now();
  const { requiredNames, requiredSetsFillAllSlots } = requiredSetFilterForTarget(target);
  for (const evidence of calculatePotentialEvidence(
    target,
    items,
    hero,
    best.panel,
    best.yuhun,
    indicator,
    effectiveConstraints,
    requiredSetsFillAllSlots,
    requiredNames,
    usedYuhunIds
  )) addPotentialEvidence(potentialEvidenceMap, evidence);
  const potentialElapsedMs = Math.max(0, now() - potentialStartedAt);
  const potentialEvidence = [...potentialEvidenceMap.values()];
  const potentialYuhunIds = [...new Set(potentialEvidence.map((entry) => entry.yuhunId))];
  const itemDTO = (item: YyxYuhun): TeamCalculationYuhunDTO => ({
    yuhunId: item.id,
    position: item.position,
    suit: item.name,
    mainStat: item.mainStat,
    mainStatLabel: STAT_LABELS[item.mainStat],
    mainValue: item.mainValue,
    level: item.level,
    star: item.star,
    subStats: Object.entries(item.subStats).map(([stat, value]) => ({ stat: stat as StatId, value: value as number })),
    intrinsicStats: Object.entries(item.intrinsicStats).map(([stat, value]) => ({ stat: stat as StatId, value: value as number }))
  });
  return withElapsed({
    result: {
      entityIndex: target.entityIndex,
      shikigamiId: target.shikigamiId,
      shikigamiName: target.shikigamiName ?? hero.name,
      metricId: target.metricId,
      metricName: metricName(target.metricId),
      status: "success",
      message: search.exact ? "已完成精确组合搜索并排除前序占用" : "已排除前序占用并使用有界候选剪枝；结果为近似最优",
      score: best.score,
      panel: best.panel,
      pieces: best.yuhun.map((item) => ({
        yuhunId: item.id,
        position: item.position,
        suit: item.name,
        mainStat: item.mainStat,
        mainStatLabel: STAT_LABELS[item.mainStat],
        mainValue: item.mainValue,
        level: item.level,
        star: item.star,
        subStats: Object.entries(item.subStats).map(([stat, value]) => ({ stat: stat as StatId, value: value as number })),
        intrinsicStats: Object.entries(item.intrinsicStats).map(([stat, value]) => ({ stat: stat as StatId, value: value as number }))
      })),
      exact: search.exact,
      candidateCount,
      candidateCombinations: search.candidateCombinations,
      evaluatedCombinations: search.evaluatedCombinations,
      stageTimings: [
        { id: "candidate-filter", elapsedMs: filterElapsedMs },
        { id: "combination-search", elapsedMs: searchElapsedMs },
        { id: "potential-evaluation", elapsedMs: potentialElapsedMs }
      ],
      potentialYuhunIds,
      potentialYuhunDetails: potentialYuhunIds.map((id) => items.find((item) => item.id === id)).filter((item): item is YyxYuhun => item !== undefined).map(itemDTO),
      potentialEvidence,
      constraints: constraintDescriptions(target, dynamicBounds),
      targetScoreRaw: target.targetScoreRaw
    },
    selectedYuhunIds: best.yuhun.map((item) => item.id)
  }, startedAt);
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function withElapsed(outcome: TargetCalculationOutcome, startedAt: number): TargetCalculationOutcome {
  return { ...outcome, result: { ...outcome.result, elapsedMs: Math.max(0, now() - startedAt) } };
}

export function calculateTeamTargets(
  request: TeamCalculationRequest,
  items: readonly YyxYuhun[],
  heroBases: ReadonlyMap<number, SnapshotHeroBase>,
  onProgress?: (progress: TeamCalculationProgress) => void
): TeamCalculationReportDTO {
  // A manually disabled member remains visible in the editor, but is not a
  // calculation target at all. This keeps the request/report focused on the
  // members that actually need yuhun allocation.
  const targets = request.manualTargets
    .filter((input) => input.yuhunConfigEnabled !== false)
    .map(targetFromManual);
  const dynamicBounds: DynamicUpperBounds = {};
  const unresolvedHighestStats = new Set<PanelStatId>();
  const usedYuhunIds = new Set(request.occupiedYuhunIds ?? []);
  const reservedYuhunIds = new Set<string>();
  const entities: TeamCalculationEntityDTO[] = [];
  const startedAt = now();
  for (const target of targets) {
    onProgress?.({
      phase: "team-calculation",
      targetId: request.id,
      targetLabel: request.label,
      completed: entities.length,
      total: targets.length,
      current: target.shikigamiName ?? "未知式神",
      currentShikigamiId: target.shikigamiId,
      detail: "正在筛选 +0 胚子并比较潜力上界"
    });
    const outcome = calculateTarget(target, items, heroBases, dynamicBounds, unresolvedHighestStats, usedYuhunIds);
    const result = outcome.result;
    entities.push(result);
    for (const id of outcome.selectedYuhunIds) {
      usedYuhunIds.add(id);
      reservedYuhunIds.add(id);
    }
    onProgress?.({
      phase: "team-calculation",
      targetId: request.id,
      targetLabel: request.label,
      completed: entities.length,
      total: targets.length,
      current: result.shikigamiName,
      ...(result.shikigamiId === null ? {} : { currentShikigamiId: result.shikigamiId }),
      detail: result.status === "success"
        ? "已完成"
        : result.status === "no-match" ? "没有满足全部约束的组合"
          : result.status === "disabled" ? "配置已关闭"
            : "当前配置暂不支持"
    });
    if (target.highestStats.length === 0 || result.status === "disabled") continue;
    if (result.status !== "success" || result.panel === null) {
      for (const stat of target.highestStats) unresolvedHighestStats.add(stat);
      continue;
    }
    for (const stat of target.highestStats) {
      dynamicBounds[stat] = {
        value: result.panel[stat],
        sourceEntityIndex: target.entityIndex,
        sourceName: result.shikigamiName
      };
    }
  }
  return {
    id: request.id,
    label: request.label,
    scope: "ordered-dynamic-bounds",
    entities,
    successfulCount: entities.filter((entity) => entity.status === "success").length,
    unsupportedCount: entities.filter((entity) => entity.status === "unsupported").length,
    reservedYuhunIds: [...reservedYuhunIds],
    elapsedMs: Math.max(0, now() - startedAt)
  };
}

export function calculateTeamTargetBatch(
  requests: readonly TeamCalculationRequest[],
  items: readonly YyxYuhun[],
  heroBases: ReadonlyMap<number, SnapshotHeroBase>,
  onProgress?: (progress: TeamCalculationProgress) => void,
  onReport?: (report: TeamCalculationReportDTO) => void
): TeamCalculationReportDTO[] {
  const occupiedByScene = new Map<string, Set<string>>();
  return requests.map((request, targetIndex) => {
    const occupied = request.sceneId !== undefined && request.sceneMutualExclusion === true
      ? new Set([
        ...(request.occupiedYuhunIds ?? []),
        ...(occupiedByScene.get(request.sceneId) ?? [])
      ])
      : new Set(request.occupiedYuhunIds ?? []);
    const report = calculateTeamTargets({
      ...request,
      occupiedYuhunIds: [...occupied]
    }, items, heroBases, (progress) => {
      onProgress?.({
        ...progress,
        targetIndex,
        targetTotal: requests.length
      });
    });
    if (request.sceneId !== undefined && request.sceneMutualExclusion === true) {
      const sceneOccupied = occupiedByScene.get(request.sceneId) ?? new Set<string>();
      for (const id of report.reservedYuhunIds ?? []) sceneOccupied.add(id);
      occupiedByScene.set(request.sceneId, sceneOccupied);
    }
    onReport?.(report);
    return report;
  });
}

export type TeamCalculationInventory = readonly Yuhun[];
