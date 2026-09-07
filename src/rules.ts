import {
  categoryUpperBound,
  enumerateSpeedCategories,
  type InitialSubStatCount,
  type SpeedCategory
} from "./categories.js";
import {
  FREQUENCY_BIAS_NOTICE,
  categoryStrictExceedProbability,
  decideSpeedCategories,
  speedDecisionCategoryKey,
  type DecideSpeedCategoriesInput,
  type SpeedCategoryDecision,
  type SpeedDecisionReport,
  type ThresholdComparison
} from "./decision.js";
import { matchFilterShare, type FilterMatchReport } from "./matcher.js";
import {
  INTRINSIC_STATS,
  LEVEL_RANGES,
  MAIN_STATS,
  SIX_STAR_SPEED_MAIN_STAT_MAX,
  STAT_LABELS,
  SUB_STATS,
  SUB_STAT_COUNTS,
  YUHUN_SUIT_IDS_BY_NAME,
  YUHUN_TYPES,
  canonicalYuhunName
} from "./mappings.js";
import type {
  FilterCriteria,
  FilterCriteriaDraft,
  IntrinsicStatId,
  LevelRange,
  StatId,
  SubStatCount,
  SubStatFilter,
  YuhunFilterDraft,
  YuhunFilterDraftGroup,
  YuhunFilterShare
} from "./types.js";
import type { YyxYuhun } from "./yyx.js";

export const MAX_FILTER_GROUPS = 60;
export const MAX_FILTER_GROUP_NAME_CODE_POINTS = 10;
export const MAX_FILTER_GROUP_NAME_UTF8_BYTES = 40;

export type RuleGenerationErrorCode =
  | "INVALID_HEADER"
  | "INVALID_POLICY"
  | "INVALID_DECISION_REPORT"
  | "GROUP_LIMIT_EXCEEDED"
  | "INVALID_GROUP_NAME"
  | "ROUNDTRIP_MISMATCH"
  | "INVALID_FILTER_CODE"
  | "DUPLICATE_YUHUN_ID";

export class RuleGenerationError extends Error {
  readonly code: RuleGenerationErrorCode;

  constructor(code: RuleGenerationErrorCode, message: string) {
    super(message);
    this.name = "RuleGenerationError";
    this.code = code;
  }
}

/** User-confirmed, configurable fallback policy for axes not personalized in v1. */
export interface StaticRetentionPolicy {
  readonly id: string;
  readonly confirmed: boolean;
  readonly protectedSuitIds: readonly number[];
  readonly retainInitialCountsBelowFour: boolean;
  readonly retainedMainStats: readonly StatId[];
  readonly retainedIntrinsicStats: readonly IntrinsicStatId[];
  /** OR between entries, AND between stats in one entry; applies to four-line, no-speed items. */
  readonly fourLineSubStatCombinations: readonly (readonly StatId[])[];
}

const DEFAULT_MAIN_STATS = [
  "attackPercent",
  "defensePercent",
  "hpPercent",
  "effectHit",
  "effectResist",
  "crit",
  "critDamage"
] as const satisfies readonly StatId[];

const DEFAULT_INTRINSIC_STATS = INTRINSIC_STATS.map(([, stat]) => stat);

export const DEFAULT_STATIC_RETENTION_POLICY: StaticRetentionPolicy = Object.freeze({
  id: "default-v1",
  confirmed: true,
  protectedSuitIds: Object.freeze([]),
  retainInitialCountsBelowFour: true,
  retainedMainStats: Object.freeze([...DEFAULT_MAIN_STATS]),
  retainedIntrinsicStats: Object.freeze([...DEFAULT_INTRINSIC_STATS]),
  fourLineSubStatCombinations: Object.freeze([])
});

export type RescueRuleKind =
  | "decision"
  | "static-initial-count"
  | "static-main-stat"
  | "static-intrinsic-stat"
  | "static-sub-stat-combination";

export interface RuleGroupManifest {
  readonly name: string;
  readonly kind: "discard-domain" | RescueRuleKind;
  readonly description: string;
}

export interface DualFilterManifest {
  readonly policy: StaticRetentionPolicy;
  readonly discardSuitIds: readonly number[];
  readonly protectedSuitIds: readonly number[];
  readonly discardGroupCount: number;
  readonly rescueGroupCount: number;
  readonly decisionRescueGroupCount: number;
  readonly staticRescueGroupCount: number;
  readonly decisionCellCount: number;
  readonly discardDomainDecisionCellCount: number;
  readonly requiredDecisionRetainCellCount: number;
  readonly auditedDecisionRetainCellCount: number;
  readonly groups: readonly RuleGroupManifest[];
}

export interface DualFilterDrafts {
  readonly decision: SpeedDecisionReport;
  readonly discardDraft: YuhunFilterDraft | null;
  readonly rescueDraft: YuhunFilterDraft | null;
  readonly manifest: DualFilterManifest;
}

export interface BuildDualFilterDraftsInput {
  readonly headerHex: string;
  readonly decisionInput: DecideSpeedCategoriesInput;
  readonly staticPolicy?: StaticRetentionPolicy;
}

export interface PreviewDualFilterSharesInput {
  readonly discardShare: YuhunFilterShare | null;
  readonly rescueShare: YuhunFilterShare | null;
  readonly items: readonly YyxYuhun[];
}

/**
 * Build the semantic representation used by the public calculation and
 * preview code. The private binary/base64 codec runs only in onmyoji-api.
 */
export function filterShareFromDraft(draft: YuhunFilterDraft): YuhunFilterShare {
  return {
    format: "onmyoji-yuhun-filter",
    schemaVersion: 1,
    headerHex: draft.headerHex.toLowerCase(),
    planKind: draft.planKind,
    planKindValue: draft.planKind === "discard" ? 0 : 1,
    groups: draft.groups.map((group) => ({
      name: group.name,
      raw: { typeMaskHex: "", optionMaskHex: "" },
      criteria: canonicalCriteria(group.criteria)
    })),
    warnings: []
  };
}

export interface DualFilterPreview {
  readonly normalPoolCount: number;
  readonly initialGarbagePoolCount: number;
  readonly postDiscardPoolCount: number;
  readonly discardMatch: FilterMatchReport | null;
  /** E matched against the combined old-garbage + newly discarded domain. */
  readonly rescueMatch: FilterMatchReport | null;
  /** E matched only against D's new output, for the default clear-old-garbage workflow. */
  readonly rescueFromNewDiscardMatch: FilterMatchReport | null;
  /** E matched only against pre-existing garbage, reported as an operational warning. */
  readonly incidentalRestoreMatch: FilterMatchReport | null;
  readonly newDiscardIds: readonly string[];
  readonly rescuedFromNewDiscardIds: readonly string[];
  readonly incidentalRestoreIds: readonly string[];
  readonly finalNewDiscardIds: readonly string[];
}

interface NormalizedPolicy extends StaticRetentionPolicy {
  readonly confirmed: true;
}

interface RescueGroupSpec {
  readonly kind: RescueRuleKind;
  readonly suffix: string;
  readonly description: string;
  readonly criteria: FilterCriteriaDraft;
}

const POLICY_KEYS = new Set([
  "id",
  "confirmed",
  "protectedSuitIds",
  "retainInitialCountsBelowFour",
  "retainedMainStats",
  "retainedIntrinsicStats",
  "fourLineSubStatCombinations"
]);
const SUITS = YUHUN_TYPES.map((name) => ({
  name,
  suitId: YUHUN_SUIT_IDS_BY_NAME[name]
}));
const SUIT_NAMES_BY_ID = new Map<number, string>();
for (const suit of SUITS) {
  if (SUIT_NAMES_BY_ID.has(suit.suitId)) {
    throw new Error(`Duplicate yuhun suit ID ${suit.suitId} in the shared mapping`);
  }
  SUIT_NAMES_BY_ID.set(suit.suitId, suit.name);
}
const KNOWN_SUIT_IDS: readonly number[] = SUITS.map((suit) => suit.suitId);
const KNOWN_SUIT_ID_SET = new Set<number>(KNOWN_SUIT_IDS);
const MAIN_STAT_ORDER = new Map(MAIN_STATS.map(([, stat], index) => [stat, index]));
const SUB_STAT_ORDER = new Map(SUB_STATS.map(([, , stat], index) => [stat, index]));
const INTRINSIC_STAT_ORDER = new Map(INTRINSIC_STATS.map(([, stat], index) => [stat, index]));
const COUNT_ORDER = new Map(SUB_STAT_COUNTS.map(([, count], index) => [count, index]));
const LEVEL_ORDER = new Map(LEVEL_RANGES.map(([, range], index) => [range, index]));
const KNOWN_STAT_IDS = new Set<StatId>(SUB_STATS.map(([, , stat]) => stat));
const KNOWN_INTRINSIC_STAT_IDS = new Set<IntrinsicStatId>(
  INTRINSIC_STATS.map(([, stat]) => stat)
);
const NON_SPEED_MAIN_STATS = MAIN_STATS
  .map(([, stat]) => stat)
  .filter((stat) => stat !== "speed");
const INITIAL_COUNT_FILTERS: Readonly<Record<InitialSubStatCount, SubStatCount>> = {
  1: "lessThan2",
  2: "2",
  3: "3",
  4: "4"
};

function fail(code: RuleGenerationErrorCode, message: string): never {
  throw new RuleGenerationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return fail("INVALID_POLICY", `${path} must be an array`);
  return value;
}

function uniqueSortedStats(
  value: unknown,
  path: string,
  allowed: ReadonlySet<StatId>,
  order: ReadonlyMap<StatId, number>
): StatId[] {
  const seen = new Set<StatId>();
  const result: StatId[] = [];
  for (const [index, entry] of requireArray(value, path).entries()) {
    if (typeof entry !== "string" || !allowed.has(entry as StatId)) {
      return fail("INVALID_POLICY", `${path}[${index}] is not a supported stat`);
    }
    const stat = entry as StatId;
    if (seen.has(stat)) return fail("INVALID_POLICY", `${path} contains duplicate stat ${stat}`);
    seen.add(stat);
    result.push(stat);
  }
  result.sort((left, right) => order.get(left)! - order.get(right)!);
  return result;
}

function normalizePolicy(value: StaticRetentionPolicy): NormalizedPolicy {
  if (!isRecord(value)) return fail("INVALID_POLICY", "staticPolicy must be an object");
  for (const key of Object.keys(value)) {
    if (!POLICY_KEYS.has(key)) return fail("INVALID_POLICY", `staticPolicy.${key} is not supported`);
  }
  for (const key of POLICY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return fail("INVALID_POLICY", `staticPolicy is missing ${key}`);
    }
  }
  if (typeof value.id !== "string" || value.id.length === 0 || value.id.trim() !== value.id) {
    return fail("INVALID_POLICY", "staticPolicy.id must be a non-empty trimmed string");
  }
  if (value.confirmed !== true) {
    return fail("INVALID_POLICY", "staticPolicy must be explicitly confirmed before code generation");
  }
  if (typeof value.retainInitialCountsBelowFour !== "boolean") {
    return fail("INVALID_POLICY", "staticPolicy.retainInitialCountsBelowFour must be boolean");
  }

  const protectedSuitIds: number[] = [];
  const seenSuitIds = new Set<number>();
  for (const [index, entry] of requireArray(
    value.protectedSuitIds,
    "staticPolicy.protectedSuitIds"
  ).entries()) {
    if (!Number.isInteger(entry) || !KNOWN_SUIT_ID_SET.has(entry as number)) {
      return fail(
        "INVALID_POLICY",
        `staticPolicy.protectedSuitIds[${index}] is not a known yuhun suit ID`
      );
    }
    const suitId = entry as number;
    if (seenSuitIds.has(suitId)) {
      return fail("INVALID_POLICY", `staticPolicy.protectedSuitIds contains duplicate ${suitId}`);
    }
    seenSuitIds.add(suitId);
    protectedSuitIds.push(suitId);
  }
  protectedSuitIds.sort((left, right) =>
    KNOWN_SUIT_IDS.indexOf(left) - KNOWN_SUIT_IDS.indexOf(right)
  );

  const retainedMainStats = uniqueSortedStats(
    value.retainedMainStats,
    "staticPolicy.retainedMainStats",
    new Set(MAIN_STATS.map(([, stat]) => stat)),
    MAIN_STAT_ORDER
  );
  if (retainedMainStats.includes("speed")) {
    return fail(
      "INVALID_POLICY",
      "staticPolicy.retainedMainStats must not contain speed; speed main is excluded from D"
    );
  }
  const retainedIntrinsicStats = uniqueSortedStats(
    value.retainedIntrinsicStats,
    "staticPolicy.retainedIntrinsicStats",
    KNOWN_INTRINSIC_STAT_IDS,
    INTRINSIC_STAT_ORDER
  ) as IntrinsicStatId[];

  const fourLineSubStatCombinations: StatId[][] = [];
  const seenCombinations = new Set<string>();
  for (const [index, rawCombination] of requireArray(
    value.fourLineSubStatCombinations,
    "staticPolicy.fourLineSubStatCombinations"
  ).entries()) {
    const combination = uniqueSortedStats(
      rawCombination,
      `staticPolicy.fourLineSubStatCombinations[${index}]`,
      KNOWN_STAT_IDS,
      SUB_STAT_ORDER
    );
    if (combination.length === 0 || combination.length > 4) {
      return fail(
        "INVALID_POLICY",
        `staticPolicy.fourLineSubStatCombinations[${index}] must contain 1 to 4 stats`
      );
    }
    if (combination.includes("speed")) {
      return fail(
        "INVALID_POLICY",
        `staticPolicy.fourLineSubStatCombinations[${index}] cannot contain speed`
      );
    }
    const key = combination.join(",");
    if (seenCombinations.has(key)) {
      return fail("INVALID_POLICY", `staticPolicy contains duplicate sub-stat combination ${key}`);
    }
    seenCombinations.add(key);
    fourLineSubStatCombinations.push(combination);
  }
  fourLineSubStatCombinations.sort((left, right) => left.join(",").localeCompare(right.join(",")));

  return {
    id: value.id,
    confirmed: true,
    protectedSuitIds,
    retainInitialCountsBelowFour: value.retainInitialCountsBelowFour,
    retainedMainStats,
    retainedIntrinsicStats,
    fourLineSubStatCombinations
  };
}

function normalizeHeader(headerHex: string): string {
  if (typeof headerHex !== "string" || !/^(?:[0-9a-fA-F]{2}){16}$/.test(headerHex)) {
    return fail("INVALID_HEADER", "headerHex must contain exactly 16 bytes of hexadecimal data");
  }
  return headerHex.toLowerCase();
}

const DECISION_NUMBER_TOLERANCE = 1e-10;
const DECISION_BUDGET_EPSILON = 1e-12;

function decisionFail(path: string, message: string): never {
  return fail("INVALID_DECISION_REPORT", `${path} ${message}`);
}

function isCloseNumber(value: unknown, expected: number): value is number {
  return typeof value === "number" && Number.isFinite(value) &&
    Math.abs(value - expected) <= DECISION_NUMBER_TOLERANCE * Math.max(1, Math.abs(expected));
}

function requireNullableCloseNumber(
  value: unknown,
  expected: number | null,
  path: string
): void {
  if (expected === null ? value !== null : !isCloseNumber(value, expected)) {
    decisionFail(path, `must equal ${String(expected)}`);
  }
}

function validateDecisionComparisons(
  value: unknown,
  category: SpeedCategory,
  subStatUpperBound: number,
  path: string
): ThresholdComparison[] {
  if (!Array.isArray(value)) decisionFail(path, "must be an array");
  const seen = new Set<string>();
  return value.map((raw, index): ThresholdComparison => {
    const comparisonPath = `${path}[${index}]`;
    if (!isRecord(raw)) decisionFail(comparisonPath, "must be an object");
    if (typeof raw.templateId !== "string" || raw.templateId.length === 0 ||
        raw.templateId.trim() !== raw.templateId) {
      decisionFail(`${comparisonPath}.templateId`, "must be a non-empty trimmed string");
    }
    if (raw.templateRiskTier !== "tier0" && raw.templateRiskTier !== "tier1") {
      decisionFail(`${comparisonPath}.templateRiskTier`, "is invalid");
    }
    if (typeof raw.role !== "string" || raw.role.length === 0) {
      decisionFail(`${comparisonPath}.role`, "must be a non-empty string");
    }
    const identity = `${raw.templateId}\u0000${raw.role}`;
    if (seen.has(identity)) decisionFail(comparisonPath, "duplicates a template/role comparison");
    seen.add(identity);
    if (!isCloseNumber(raw.subStatUpperBound, subStatUpperBound)) {
      decisionFail(`${comparisonPath}.subStatUpperBound`, "is inconsistent with the category");
    }

    let expectedOutcome: ThresholdComparison["outcome"];
    let expectedProbability: number | null;
    if (raw.threshold === null) {
      expectedOutcome = "missing-witness";
      expectedProbability = null;
    } else {
      if (typeof raw.threshold !== "number" || !Number.isFinite(raw.threshold) || raw.threshold < 0) {
        decisionFail(`${comparisonPath}.threshold`, "must be null or a finite non-negative number");
      }
      expectedOutcome = subStatUpperBound <= raw.threshold ? "dominated" : "can-exceed";
      expectedProbability = categoryStrictExceedProbability(category, raw.threshold);
    }
    if (raw.outcome !== expectedOutcome) {
      decisionFail(`${comparisonPath}.outcome`, `must be ${expectedOutcome}`);
    }
    requireNullableCloseNumber(
      raw.strictExceedProbability,
      expectedProbability,
      `${comparisonPath}.strictExceedProbability`
    );
    return raw as unknown as ThresholdComparison;
  });
}

function validateMinimumThreshold(
  entry: Record<string, unknown>,
  comparisons: readonly ThresholdComparison[],
  path: string
): number | null {
  const numeric = comparisons.filter(
    (comparison): comparison is ThresholdComparison & { threshold: number } =>
      comparison.threshold !== null
  );
  const expectedMinimum = numeric.length === 0
    ? null
    : Math.min(...numeric.map((comparison) => comparison.threshold));
  requireNullableCloseNumber(entry.minimumThreshold, expectedMinimum, `${path}.minimumThreshold`);
  if (!Array.isArray(entry.minimumThresholdSources)) {
    decisionFail(`${path}.minimumThresholdSources`, "must be an array");
  }
  const expectedSources = expectedMinimum === null
    ? []
    : numeric
      .filter((comparison) => comparison.threshold === expectedMinimum)
      .map((comparison) => `${comparison.templateId}\u0000${comparison.role}`)
      .sort();
  const actualSources = entry.minimumThresholdSources.map((raw, index) => {
    const sourcePath = `${path}.minimumThresholdSources[${index}]`;
    if (!isRecord(raw) || typeof raw.templateId !== "string" || typeof raw.role !== "string") {
      return decisionFail(sourcePath, "must contain string templateId and role fields");
    }
    return `${raw.templateId}\u0000${raw.role}`;
  }).sort();
  if (actualSources.length !== expectedSources.length ||
      actualSources.some((source, index) => source !== expectedSources[index])) {
    decisionFail(`${path}.minimumThresholdSources`, "is inconsistent with minimumThreshold");
  }
  return expectedMinimum;
}

function validateDecisionState(
  entry: Record<string, unknown>,
  expected: {
    disposition: "discard" | "retain";
    riskTier: "tier0" | "tier1" | null;
    reason: SpeedCategoryDecision["reason"];
    exceedProbability: number | null;
    riskPerTenThousand: number | null;
  },
  path: string
): void {
  if (entry.disposition !== expected.disposition) {
    decisionFail(`${path}.disposition`, `must be ${expected.disposition} for ${expected.reason}`);
  }
  if (entry.riskTier !== expected.riskTier) {
    decisionFail(`${path}.riskTier`, `must equal ${String(expected.riskTier)} for ${expected.reason}`);
  }
  if (entry.reason !== expected.reason) {
    decisionFail(`${path}.reason`, `must be ${expected.reason}`);
  }
  requireNullableCloseNumber(
    entry.exceedProbability,
    expected.exceedProbability,
    `${path}.exceedProbability`
  );
  requireNullableCloseNumber(
    entry.riskPerTenThousand,
    expected.riskPerTenThousand,
    `${path}.riskPerTenThousand`
  );
}

function validateDecisionReport(report: SpeedDecisionReport): SpeedCategoryDecision[] {
  if (!isRecord(report) || !Array.isArray(report.categories)) {
    return fail("INVALID_DECISION_REPORT", "decision must contain a categories array");
  }
  if (!Number.isSafeInteger(report.sampleSize) || report.sampleSize < 0) {
    decisionFail("decision.sampleSize", "must be a non-negative safe integer");
  }
  if (report.biasNotice !== FREQUENCY_BIAS_NOTICE) {
    decisionFail("decision.biasNotice", `must be ${FREQUENCY_BIAS_NOTICE}`);
  }
  if (typeof report.budgetPerTenThousand !== "number" ||
      !Number.isFinite(report.budgetPerTenThousand) || report.budgetPerTenThousand < 0) {
    decisionFail("decision.budgetPerTenThousand", "must be a finite non-negative number");
  }
  const expectedKeys = new Set<string>();
  for (const suitId of KNOWN_SUIT_IDS) {
    for (const category of enumerateSpeedCategories()) {
      expectedKeys.add(speedDecisionCategoryKey({ suitId, category }));
    }
  }
  const seen = new Set<string>();
  const decisions: SpeedCategoryDecision[] = [];
  let countSum = 0;
  let observedDiscardCount = 0;
  let expectedMissesPerTenThousand = 0;
  let tier0DiscardedCategoryCount = 0;
  let tier1DiscardedCategoryCount = 0;
  for (const [index, entry] of report.categories.entries()) {
    const path = `decision.categories[${index}]`;
    if (!isRecord(entry)) {
      return decisionFail(path, "must be an object");
    }
    if (!Number.isInteger(entry.suitId) || !KNOWN_SUIT_ID_SET.has(entry.suitId as number)) {
      return decisionFail(`${path}.suitId`, "is not a known yuhun suit ID");
    }
    if (!isRecord(entry.category)) {
      return decisionFail(`${path}.category`, "is invalid");
    }
    const category = entry.category as unknown as SpeedCategory;
    try {
      categoryUpperBound(category);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return decisionFail(`${path}.category`, `is invalid: ${message}`);
    }
    const expectedKey = speedDecisionCategoryKey({ suitId: entry.suitId as number, category });
    if (entry.key !== expectedKey || !expectedKeys.has(expectedKey)) {
      return decisionFail(`${path}.key`, "is inconsistent");
    }
    if (seen.has(expectedKey)) {
      return decisionFail(path, `duplicates category ${expectedKey}`);
    }
    if (!Number.isSafeInteger(entry.count) || (entry.count as number) < 0) {
      return decisionFail(`${path}.count`, "must be a non-negative safe integer");
    }
    const count = entry.count as number;
    const expectedFrequency = report.sampleSize === 0 ? 0 : count / report.sampleSize;
    if (!isCloseNumber(entry.frequency, expectedFrequency)) {
      return decisionFail(`${path}.frequency`, "must equal count / sampleSize");
    }
    if (!isCloseNumber(entry.frequencyPerTenThousand, expectedFrequency * 10_000)) {
      return decisionFail(`${path}.frequencyPerTenThousand`, "is inconsistent with frequency");
    }

    const fullUpperBound = categoryUpperBound(category);
    const subStatUpperBound = category.mainStatIsSpeed
      ? fullUpperBound - SIX_STAR_SPEED_MAIN_STAT_MAX
      : fullUpperBound;
    if (!isCloseNumber(entry.subStatUpperBound, subStatUpperBound)) {
      return decisionFail(`${path}.subStatUpperBound`, "is inconsistent with the category");
    }
    const comparisons = validateDecisionComparisons(
      entry.comparisons,
      category,
      subStatUpperBound,
      `${path}.comparisons`
    );
    const minimumThreshold = validateMinimumThreshold(entry, comparisons, path);

    if (category.mainStatIsSpeed) {
      if (comparisons.length !== 0 || minimumThreshold !== null ||
          (entry.minimumThresholdSources as readonly unknown[]).length !== 0) {
        return decisionFail(path, "must not contain threshold evidence for a speed main stat");
      }
      validateDecisionState(entry, {
        disposition: "retain",
        riskTier: null,
        reason: "speed-main-protected",
        exceedProbability: null,
        riskPerTenThousand: null
      }, path);
    } else if (comparisons.some((comparison) => comparison.outcome === "missing-witness")) {
      validateDecisionState(entry, {
        disposition: "retain",
        riskTier: null,
        reason: "missing-witness",
        exceedProbability: null,
        riskPerTenThousand: null
      }, path);
    } else if (comparisons.every((comparison) => comparison.outcome === "dominated")) {
      validateDecisionState(entry, {
        disposition: "discard",
        riskTier: "tier0",
        reason: "tier0-dominated",
        exceedProbability: 0,
        riskPerTenThousand: 0
      }, path);
    } else {
      if (minimumThreshold === null) {
        return decisionFail(path, "has a non-dominated comparison without a numeric threshold");
      }
      const exceedProbability = categoryStrictExceedProbability(category, minimumThreshold);
      if (comparisons.some((comparison) =>
        comparison.templateRiskTier === "tier0" && comparison.outcome !== "dominated"
      )) {
        validateDecisionState(entry, {
          disposition: "retain",
          riskTier: null,
          reason: "tier0-template-not-dominated",
          exceedProbability,
          riskPerTenThousand: null
        }, path);
      } else {
        const riskPerTenThousand = expectedFrequency * 10_000 * exceedProbability;
        if (count === 0) {
          validateDecisionState(entry, {
            disposition: "retain",
            riskTier: null,
            reason: "unobserved-frequency",
            exceedProbability,
            riskPerTenThousand
          }, path);
        } else if (entry.reason === "tier1-budget-selected") {
          validateDecisionState(entry, {
            disposition: "discard",
            riskTier: "tier1",
            reason: "tier1-budget-selected",
            exceedProbability,
            riskPerTenThousand
          }, path);
        } else {
          validateDecisionState(entry, {
            disposition: "retain",
            riskTier: null,
            reason: "tier1-budget-excluded",
            exceedProbability,
            riskPerTenThousand
          }, path);
        }
      }
    }

    seen.add(expectedKey);
    const decision = entry as unknown as SpeedCategoryDecision;
    decisions.push(decision);
    countSum += count;
    if (decision.disposition === "discard") observedDiscardCount += count;
    if (decision.riskTier === "tier0") tier0DiscardedCategoryCount += 1;
    if (decision.riskTier === "tier1") {
      tier1DiscardedCategoryCount += 1;
      expectedMissesPerTenThousand += decision.riskPerTenThousand!;
    }
  }
  if (seen.size !== expectedKeys.size) {
    const missing = [...expectedKeys].find((key) => !seen.has(key));
    return fail(
      "INVALID_DECISION_REPORT",
      `decision must contain the complete ${expectedKeys.size}-cell universe; missing ${missing ?? "cell"}`
    );
  }
  if (countSum !== report.sampleSize) {
    return decisionFail("decision.categories", "counts must sum to sampleSize");
  }
  if (expectedMissesPerTenThousand > report.budgetPerTenThousand + DECISION_BUDGET_EPSILON) {
    return decisionFail("decision.expectedMissesPerTenThousand", "exceeds the risk budget");
  }
  if (!isCloseNumber(report.expectedMissesPerTenThousand, expectedMissesPerTenThousand)) {
    return decisionFail("decision.expectedMissesPerTenThousand", "is inconsistent with categories");
  }
  if (report.observedDiscardCount !== observedDiscardCount) {
    return decisionFail("decision.observedDiscardCount", "is inconsistent with categories");
  }
  const expectedCoverage = report.sampleSize === 0
    ? null
    : observedDiscardCount / report.sampleSize;
  requireNullableCloseNumber(
    report.observedDiscardCoverage,
    expectedCoverage,
    "decision.observedDiscardCoverage"
  );
  if (report.tier0DiscardedCategoryCount !== tier0DiscardedCategoryCount) {
    return decisionFail("decision.tier0DiscardedCategoryCount", "is inconsistent with categories");
  }
  if (report.tier1DiscardedCategoryCount !== tier1DiscardedCategoryCount) {
    return decisionFail("decision.tier1DiscardedCategoryCount", "is inconsistent with categories");
  }
  decisions.sort((left, right) => left.key.localeCompare(right.key));
  return decisions;
}

function sortByOrder<T>(values: readonly T[], order: ReadonlyMap<T, number>): T[] {
  return [...new Set(values)].sort((left, right) => order.get(left)! - order.get(right)!);
}

function sortSubStatFilters(values: readonly SubStatFilter[]): SubStatFilter[] {
  const bitByKey = new Map<string, number>();
  for (const [includeBit, excludeBit, stat] of SUB_STATS) {
    bitByKey.set(`${stat}:include`, includeBit);
    bitByKey.set(`${stat}:exclude`, excludeBit);
  }
  return [...values].sort((left, right) =>
    bitByKey.get(`${left.stat}:${left.requirement}`)! -
    bitByKey.get(`${right.stat}:${right.requirement}`)!
  );
}

function suitNames(suitIds: ReadonlySet<number> | readonly number[]): string[] {
  const selected = suitIds instanceof Set ? suitIds : new Set(suitIds);
  return SUITS.filter((suit) => selected.has(suit.suitId)).map((suit) => suit.name);
}

function baseDiscardCriteria(discardSuitIds: readonly number[]): FilterCriteriaDraft {
  return {
    types: suitNames(discardSuitIds),
    stars: [6],
    mainStats: [...NON_SPEED_MAIN_STATS],
    levelRanges: ["0-2"]
  };
}

function validateGroupName(name: string): void {
  const codePoints = Array.from(name).length;
  const utf8Bytes = new TextEncoder().encode(name).length;
  if (codePoints === 0 || codePoints > MAX_FILTER_GROUP_NAME_CODE_POINTS ||
      utf8Bytes > MAX_FILTER_GROUP_NAME_UTF8_BYTES) {
    fail(
      "INVALID_GROUP_NAME",
      `Filter group name ${JSON.stringify(name)} exceeds the ${MAX_FILTER_GROUP_NAME_CODE_POINTS}-` +
      `character or ${MAX_FILTER_GROUP_NAME_UTF8_BYTES}-byte limit`
    );
  }
}

function numberedName(prefix: "D" | "E", index: number, suffix: string): string {
  const name = `${prefix}${String(index).padStart(2, "0")}|${suffix}`;
  validateGroupName(name);
  return name;
}

function makeDecisionGroupSpecs(
  decisions: readonly SpeedCategoryDecision[],
  discardSuitIds: readonly number[],
  policy: NormalizedPolicy
): { specs: RescueGroupSpec[]; requiredRetainKeys: string[] } {
  const discardSuitIdSet = new Set(discardSuitIds);
  const buckets = new Map<string, {
    position: number;
    initialCount: InitialSubStatCount;
    initialSpeedPresent: boolean;
    suitIds: Set<number>;
  }>();
  const requiredRetainKeys: string[] = [];
  for (const decision of decisions) {
    if (!discardSuitIdSet.has(decision.suitId) || decision.category.mainStatIsSpeed ||
        decision.disposition !== "retain") continue;
    requiredRetainKeys.push(decision.key);
    if (policy.retainInitialCountsBelowFour && decision.category.initialCount < 4) continue;
    const bucketKey = [
      decision.category.position,
      decision.category.initialCount,
      decision.category.initialSpeedPresent ? 1 : 0
    ].join(":");
    const bucket = buckets.get(bucketKey) ?? {
      position: decision.category.position,
      initialCount: decision.category.initialCount,
      initialSpeedPresent: decision.category.initialSpeedPresent,
      suitIds: new Set<number>()
    };
    bucket.suitIds.add(decision.suitId);
    buckets.set(bucketKey, bucket);
  }

  const orderedBuckets = [...buckets.values()].sort((left, right) =>
    left.position - right.position ||
    left.initialCount - right.initialCount ||
    Number(left.initialSpeedPresent) - Number(right.initialSpeedPresent)
  );
  return {
    requiredRetainKeys,
    specs: orderedBuckets.map((bucket): RescueGroupSpec => ({
      kind: "decision",
      suffix: `${bucket.position}位${bucket.initialCount}${bucket.initialSpeedPresent ? "含" : "无"}速`,
      description:
        `速度决策保留：${bucket.position}位、初始${bucket.initialCount}条、` +
        `${bucket.initialSpeedPresent ? "含速度" : "无速度"}`,
      criteria: {
        types: suitNames(bucket.suitIds),
        positions: [bucket.position],
        stars: [6],
        mainStats: [...NON_SPEED_MAIN_STATS],
        subStats: [{
          stat: "speed",
          requirement: bucket.initialSpeedPresent ? "include" : "exclude"
        }],
        subStatCounts: [INITIAL_COUNT_FILTERS[bucket.initialCount]],
        levelRanges: ["0-2"]
      }
    }))
  };
}

function makeStaticGroupSpecs(
  discardSuitIds: readonly number[],
  policy: NormalizedPolicy
): RescueGroupSpec[] {
  const base = baseDiscardCriteria(discardSuitIds);
  const specs: RescueGroupSpec[] = [];
  if (policy.retainInitialCountsBelowFour) {
    specs.push({
      kind: "static-initial-count",
      suffix: "不足4条",
      description: "静态兜底：初始副属性不足4条全部保留",
      criteria: {
        ...base,
        subStatCounts: ["lessThan2", "2", "3"]
      }
    });
  }
  if (policy.retainedMainStats.length > 0) {
    specs.push({
      kind: "static-main-stat",
      suffix: "关键主属",
      description: `静态兜底主属性：${policy.retainedMainStats.map((stat) => STAT_LABELS[stat]).join("、")}`,
      criteria: {
        types: [...base.types!],
        stars: [6],
        mainStats: [...policy.retainedMainStats],
        levelRanges: ["0-2"]
      }
    });
  }
  if (policy.retainedIntrinsicStats.length > 0) {
    specs.push({
      kind: "static-intrinsic-stat",
      suffix: "固有属性",
      description:
        `静态兜底固有属性：${policy.retainedIntrinsicStats.map((stat) => STAT_LABELS[stat]).join("、")}`,
      criteria: {
        ...base,
        intrinsicStats: [...policy.retainedIntrinsicStats]
      }
    });
  }
  for (const [index, combination] of policy.fourLineSubStatCombinations.entries()) {
    specs.push({
      kind: "static-sub-stat-combination",
      suffix: `组合${String(index + 1).padStart(2, "0")}`,
      description:
        `静态兜底四条无速度组合：${combination.map((stat) => STAT_LABELS[stat]).join("+")}`,
      criteria: {
        ...base,
        subStats: sortSubStatFilters([
          ...combination.map((stat): SubStatFilter => ({ stat, requirement: "include" })),
          { stat: "speed", requirement: "exclude" }
        ]),
        subStatCounts: ["4"]
      }
    });
  }
  return specs;
}

function representativeSubStats(category: SpeedCategory): Partial<Record<StatId, number>> {
  const others = SUB_STATS.map(([, , stat]) => stat).filter((stat) => stat !== "speed");
  const stats = category.initialSpeedPresent
    ? ["speed" as const, ...others.slice(0, category.initialCount - 1)]
    : others.slice(0, category.initialCount);
  return Object.fromEntries(stats.map((stat) => [stat, stat === "speed" ? 2.7 : 1]));
}

function representativeMainStat(category: SpeedCategory): StatId {
  if (category.mainStatIsSpeed) return "speed";
  switch (category.position) {
    case 1: return "attack";
    case 2: return "attackPercent";
    case 3: return "defense";
    case 4: return "hpPercent";
    case 5: return "hp";
    case 6: return "crit";
  }
}

function representativeItems(decisions: readonly SpeedCategoryDecision[]): YyxYuhun[] {
  return decisions.map((decision, index) => {
    const initialSubStats = representativeSubStats(decision.category);
    const mainStat = representativeMainStat(decision.category);
    return {
      id: decision.key,
      name: SUIT_NAMES_BY_ID.get(decision.suitId)!,
      position: decision.category.position,
      level: 0,
      star: 6,
      mainStat,
      mainValue: mainStat === "speed" ? 57 : 1,
      subStats: { ...initialSubStats },
      intrinsicStats: {},
      lock: false,
      garbage: false,
      born: index,
      suitId: decision.suitId,
      initialSubStats
    };
  });
}

function auditDraftCoverage(
  discardDraft: YuhunFilterDraft,
  rescueDraft: YuhunFilterDraft | null,
  decisions: readonly SpeedCategoryDecision[],
  discardSuitIds: readonly number[]
): { discardDomainCellCount: number; auditedRetainCellCount: number } {
  try {
    const representatives = representativeItems(decisions);
    const discardShare = filterShareFromDraft(discardDraft);
    const discardMatch = matchFilterShare(discardShare, representatives);
    const rescueIds = rescueDraft === null
      ? new Set<string>()
      : new Set(matchFilterShare(
        filterShareFromDraft(rescueDraft),
        representatives
      ).unionIds);
    const discardIds = new Set(discardMatch.unionIds);
    const expectedDiscardIds = new Set(decisions
      .filter((decision) =>
        discardSuitIds.includes(decision.suitId) && !decision.category.mainStatIsSpeed
      )
      .map((decision) => decision.key));
    if (discardIds.size !== expectedDiscardIds.size ||
        [...expectedDiscardIds].some((id) => !discardIds.has(id))) {
      return fail("ROUNDTRIP_MISMATCH", "Discard draft does not match its complete decision domain");
    }
    let auditedRetainCellCount = 0;
    for (const decision of decisions) {
      if (!discardIds.has(decision.key) || decision.disposition !== "retain") continue;
      if (!rescueIds.has(decision.key)) {
        return fail(
          "ROUNDTRIP_MISMATCH",
          `Rescue draft does not cover retained decision cell ${decision.key}`
        );
      }
      auditedRetainCellCount += 1;
    }
    return {
      discardDomainCellCount: discardIds.size,
      auditedRetainCellCount
    };
  } catch (error) {
    if (error instanceof RuleGenerationError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return fail("ROUNDTRIP_MISMATCH", `Complete decision-domain audit failed: ${message}`);
  }
}

function makeDecisionReport(input: DecideSpeedCategoriesInput): SpeedDecisionReport {
  try {
    return decideSpeedCategories(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("INVALID_DECISION_REPORT", `Could not derive the speed decision report: ${message}`);
  }
}

/** Derive a trusted speed decision report, then build deterministic D/E drafts. */
export function buildDualFilterDrafts(input: BuildDualFilterDraftsInput): DualFilterDrafts {
  if (!isRecord(input)) return fail("INVALID_DECISION_REPORT", "rule input must be an object");
  const headerHex = normalizeHeader(input.headerHex);
  const policy = normalizePolicy(input.staticPolicy ?? DEFAULT_STATIC_RETENTION_POLICY);
  const decision = makeDecisionReport(input.decisionInput);
  const decisions = validateDecisionReport(decision);
  const protectedSuitIdSet = new Set(policy.protectedSuitIds);
  const discardSuitIds = KNOWN_SUIT_IDS.filter((suitId) => !protectedSuitIdSet.has(suitId));
  if (discardSuitIds.length === 0) {
    return {
      decision,
      discardDraft: null,
      rescueDraft: null,
      manifest: {
        policy,
        discardSuitIds: [],
        protectedSuitIds: [...policy.protectedSuitIds],
        discardGroupCount: 0,
        rescueGroupCount: 0,
        decisionRescueGroupCount: 0,
        staticRescueGroupCount: 0,
        decisionCellCount: decisions.length,
        discardDomainDecisionCellCount: 0,
        requiredDecisionRetainCellCount: 0,
        auditedDecisionRetainCellCount: 0,
        groups: []
      }
    };
  }

  const discardName = numberedName("D", 1, "6星0-2");
  const discardGroup: YuhunFilterDraftGroup = {
    name: discardName,
    criteria: baseDiscardCriteria(discardSuitIds)
  };
  const discardDraft: YuhunFilterDraft = {
    headerHex,
    planKind: "discard",
    groups: [discardGroup]
  };

  const decisionGroups = makeDecisionGroupSpecs(decisions, discardSuitIds, policy);
  const staticGroups = makeStaticGroupSpecs(discardSuitIds, policy);
  const rescueSpecs = [...decisionGroups.specs, ...staticGroups];
  if (rescueSpecs.length > MAX_FILTER_GROUPS) {
    return fail(
      "GROUP_LIMIT_EXCEEDED",
      `Rescue code requires ${rescueSpecs.length} groups, exceeding the ${MAX_FILTER_GROUPS}-group limit`
    );
  }
  const rescueGroups = rescueSpecs.map((spec, index): YuhunFilterDraftGroup => ({
    name: numberedName("E", index + 1, spec.suffix),
    criteria: spec.criteria
  }));
  const rescueDraft: YuhunFilterDraft | null = rescueGroups.length === 0
    ? null
    : { headerHex, planKind: "enhance", groups: rescueGroups };

  const audit = auditDraftCoverage(discardDraft, rescueDraft, decisions, discardSuitIds);
  if (audit.auditedRetainCellCount !== decisionGroups.requiredRetainKeys.length) {
    return fail(
      "ROUNDTRIP_MISMATCH",
      "Complete decision-domain audit did not cover every required retain cell"
    );
  }
  const groups: RuleGroupManifest[] = [{
    name: discardName,
    kind: "discard-domain",
    description: "六星、0-2级、非速度主属性、非整类保护套装"
  }];
  for (const [index, spec] of rescueSpecs.entries()) {
    groups.push({
      name: rescueGroups[index]!.name,
      kind: spec.kind,
      description: spec.description
    });
  }
  return {
    decision,
    discardDraft,
    rescueDraft,
    manifest: {
      policy,
      discardSuitIds,
      protectedSuitIds: [...policy.protectedSuitIds],
      discardGroupCount: 1,
      rescueGroupCount: rescueGroups.length,
      decisionRescueGroupCount: decisionGroups.specs.length,
      staticRescueGroupCount: staticGroups.length,
      decisionCellCount: decisions.length,
      discardDomainDecisionCellCount: audit.discardDomainCellCount,
      requiredDecisionRetainCellCount: decisionGroups.requiredRetainKeys.length,
      auditedDecisionRetainCellCount: audit.auditedRetainCellCount,
      groups
    }
  };
}

function canonicalCriteria(criteria: FilterCriteriaDraft | undefined): FilterCriteria {
  const input = criteria ?? {};
  return {
    types: YUHUN_TYPES.filter((type) => (input.types ?? []).some((value) => canonicalYuhunName(value) === type)),
    positions: [...new Set(input.positions ?? [])].sort((left, right) => left - right),
    stars: [...new Set(input.stars ?? [])].sort((left, right) => left - right),
    mainStats: sortByOrder(input.mainStats ?? [], MAIN_STAT_ORDER),
    subStats: sortSubStatFilters(input.subStats ?? []),
    subStatCounts: sortByOrder(input.subStatCounts ?? [], COUNT_ORDER),
    levelRanges: sortByOrder(input.levelRanges ?? [], LEVEL_ORDER),
    intrinsicStats: sortByOrder(input.intrinsicStats ?? [], INTRINSIC_STAT_ORDER),
    unknownTypeBits: [...new Set(input.unknownTypeBits ?? [])].sort((left, right) => left - right),
    unknownOptionBits: [...new Set(input.unknownOptionBits ?? [])].sort((left, right) => left - right)
  };
}

function validatePreviewShare(
  share: YuhunFilterShare | null,
  expectedPlanKind: "discard" | "enhance"
): void {
  if (share === null) return;
  if (share.planKind !== expectedPlanKind || share.warnings.length !== 0) {
    fail(
      "INVALID_FILTER_CODE",
      `Expected a warning-free ${expectedPlanKind} filter share`
    );
  }
}

function validateUniqueItemIds(items: readonly YyxYuhun[]): void {
  if (!Array.isArray(items)) fail("DUPLICATE_YUHUN_ID", "items must be an array");
  const seen = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (seen.has(item.id)) {
      fail("DUPLICATE_YUHUN_ID", `items contains duplicate ID at index ${index}: ${item.id}`);
    }
    seen.add(item.id);
  }
}

/** Preview D followed by E while keeping the normal and pre-existing garbage pools distinct. */
export function previewDualFilterShares(input: PreviewDualFilterSharesInput): DualFilterPreview {
  validateUniqueItemIds(input.items);
  validatePreviewShare(input.discardShare, "discard");
  validatePreviewShare(input.rescueShare, "enhance");
  const normalPool = input.items.filter((item) => !item.garbage);
  const initialGarbagePool = input.items.filter((item) => item.garbage);
  const discardMatch = input.discardShare === null
    ? null
    : matchFilterShare(input.discardShare, normalPool);
  const newDiscardIds = discardMatch?.unionIds ?? [];
  const newDiscardIdSet = new Set(newDiscardIds);
  const newDiscardPool = normalPool.filter((item) => newDiscardIdSet.has(item.id));
  const postDiscardPool = input.items.filter((item) =>
    item.garbage || newDiscardIdSet.has(item.id)
  );
  const rescueMatch = input.rescueShare === null
    ? null
    : matchFilterShare(input.rescueShare, postDiscardPool);
  const rescueFromNewDiscardMatch = input.rescueShare === null
    ? null
    : matchFilterShare(input.rescueShare, newDiscardPool);
  const incidentalRestoreMatch = input.rescueShare === null
    ? null
    : matchFilterShare(input.rescueShare, initialGarbagePool);
  const rescuedFromNewDiscardIds = rescueFromNewDiscardMatch?.unionIds ?? [];
  const incidentalRestoreIds = incidentalRestoreMatch?.unionIds ?? [];
  const rescuedFromNewDiscardIdSet = new Set(rescuedFromNewDiscardIds);
  return {
    normalPoolCount: normalPool.length,
    initialGarbagePoolCount: initialGarbagePool.length,
    postDiscardPoolCount: postDiscardPool.length,
    discardMatch,
    rescueMatch,
    rescueFromNewDiscardMatch,
    incidentalRestoreMatch,
    newDiscardIds: [...newDiscardIds],
    rescuedFromNewDiscardIds: [...rescuedFromNewDiscardIds],
    incidentalRestoreIds: [...incidentalRestoreIds],
    finalNewDiscardIds: newDiscardIds.filter((id) => !rescuedFromNewDiscardIdSet.has(id))
  };
}
