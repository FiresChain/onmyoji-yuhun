import { categoryUpperBound, type SpeedCategory } from "./categories.js";
import {
  FREQUENCY_BIAS_NOTICE,
  categoryStrictExceedProbability,
  decideSpeedCategories,
  estimateSpeedCategoryFrequencies,
  speedDecisionCategoryKey,
  type DecideSpeedCategoriesInput,
  type SpeedCategoryDecision,
  type SpeedDecisionReport
} from "./decision.js";
import {
  INTRINSIC_STATS,
  MAIN_STATS,
  SUB_STATS,
  SUB_STAT_MAX_ROLLS,
  YUHUN_POSITIONS,
  YUHUN_SUIT_IDS_BY_NAME
} from "./mappings.js";
import {
  enumerateTargetRolls,
  enumerateTargetRollStates,
  type TargetRollOutcome,
  type TargetRollState
} from "./potential.js";
import {
  buildDualFilterDrafts,
  filterShareFromDraft,
  previewDualFilterShares,
  type BuildDualFilterDraftsInput,
  type DualFilterDrafts
} from "./rules.js";
import type { StatId } from "./types.js";
import type { YyxYuhun } from "./yyx.js";

export const DEFAULT_SIMULATION_SAMPLE_SIZE = 100_000;
export const DEFAULT_SIMULATION_SEED = 1;

export type SpeedValidationErrorCode =
  | "INVALID_INPUT"
  | "INVALID_SOURCE"
  | "SOURCE_FREQUENCY_MISMATCH"
  | "TIER0_PROOF_FAILED"
  | "MISSING_THRESHOLD"
  | "PLAN_NOT_DECISION_SUBSET"
  | "BUDGET_EXCEEDED"
  | "TIER0_MISS"
  | "CALIBRATION_FAILED";

export class SpeedValidationError extends Error {
  readonly code: SpeedValidationErrorCode;

  constructor(code: SpeedValidationErrorCode, message: string) {
    super(message);
    this.name = "SpeedValidationError";
    this.code = code;
  }
}

export interface Tier0CellProof {
  readonly key: string;
  readonly stateCount: number;
  readonly thresholdCount: number;
  /** Number of explicit `(compressed state, numeric threshold)` comparisons. */
  readonly comparisonCount: number;
  readonly maximumStateSpeed: number;
  readonly minimumThreshold: number | null;
}

export interface Tier0ProofReport {
  readonly cellCount: number;
  readonly stateCount: number;
  /** Number of numeric threshold witnesses across all Tier 0 cells. */
  readonly thresholdCount: number;
  readonly comparisonCount: number;
  readonly cells: readonly Tier0CellProof[];
}

export type CalibrationMethod = "normal-four-sigma" | "exact-binomial-four-sigma";

export interface FourSigmaCalibration {
  readonly method: CalibrationMethod;
  readonly expectedCount: number;
  readonly standardDeviation: number;
  readonly absoluteError: number;
  /** The normal-approximation radius, retained for diagnostics in exact mode. */
  readonly maximumError: number;
  readonly minimumAcceptedCount: number;
  readonly maximumAcceptedCount: number;
}

export interface SpeedSimulationStrategyReport {
  readonly discardCount: number;
  readonly discardCoverage: number;
  readonly missCount: number;
  readonly missesPerTenThousandDrops: number;
  readonly exactDiscardCoverage: number;
  readonly exactExpectedMissesPerTenThousandDrops: number;
  readonly calibration: {
    readonly discard: FourSigmaCalibration;
    readonly miss: FourSigmaCalibration;
  };
}

export interface SimulateSpeedValidationInput {
  readonly planInput: BuildDualFilterDraftsInput;
  readonly sourceItems: readonly YyxYuhun[];
  readonly sampleSize?: number;
  readonly seed?: number;
  /** Optional browser-worker progress hook. Called after every 5,000 samples. */
  readonly onProgress?: (completed: number, total: number) => void;
}

export interface SpeedValidationReport {
  readonly sampleSize: number;
  readonly seed: number;
  readonly sourceSampleSize: number;
  readonly frequencyBiasNotice: typeof FREQUENCY_BIAS_NOTICE;
  readonly tier0Proof: Tier0ProofReport;
  readonly planSourceDiscardCount: number;
  readonly planSourceDiscardCoverage: number;
  readonly tier0DiscardCount: number;
  readonly tier0MissCount: number;
  readonly planDiscardIsDecisionDiscardSubset: true;
  readonly exactBudgetSatisfied: true;
  readonly personalized: SpeedSimulationStrategyReport;
  readonly generic: SpeedSimulationStrategyReport;
  readonly realizedPlan: SpeedSimulationStrategyReport;
}

interface PopulationMember {
  readonly item: YyxYuhun;
  readonly decision: SpeedCategoryDecision;
  readonly personalizedDiscard: boolean;
  readonly genericDiscard: boolean;
  readonly realizedPlanDiscard: boolean;
  readonly exactExceedProbability: number | null;
}

interface StrategySelection {
  readonly personalized: boolean;
  readonly generic: boolean;
  readonly realizedPlan: boolean;
}

type StrategyName = keyof StrategySelection;

interface MutableStrategyCounts {
  discardCount: number;
  missCount: number;
}

interface ExactStrategyProfile {
  readonly discardCoverage: number;
  readonly riskPerTenThousand: number;
}

const FOUR_SIGMA = 4;
const MIN_NORMAL_EXPECTED_COUNT = 5;
// One tail outside the central +/-4 standard-normal interval.
const FOUR_SIGMA_ONE_SIDED_TAIL = 0.000_031_671_241_833_119_98;
const UINT32_MAX = 0xffff_ffff;
const PROBABILITY_DENOMINATOR = 0x1_0000_0000;
const PROBABILITY_TOLERANCE = 1e-12;
const BUDGET_TOLERANCE = 1e-12;
const NUMERIC_TOLERANCE = 1e-9;
const GENERIC_SPEED_POSITIONS = new Set<number>([1, 3, 4, 5, 6]);
const KNOWN_MAIN_STATS = new Set<StatId>(MAIN_STATS.map(([, stat]) => stat));
const KNOWN_SUB_STATS = new Set<StatId>(SUB_STATS.map(([, , stat]) => stat));
const KNOWN_INTRINSIC_STATS = new Set<StatId>(INTRINSIC_STATS.map(([, stat]) => stat));
const SUIT_NAMES_BY_ID = new Map<number, string>();
for (const [name, suitId] of Object.entries(YUHUN_SUIT_IDS_BY_NAME)) {
  if (SUIT_NAMES_BY_ID.has(suitId)) throw new Error(`Duplicate yuhun suit ID ${suitId}`);
  SUIT_NAMES_BY_ID.set(suitId, name);
}

function fail(code: SpeedValidationErrorCode, message: string): never {
  throw new SpeedValidationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClose(left: number, right: number, tolerance = NUMERIC_TOLERANCE): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function targetShapeKey(category: SpeedCategory): string {
  return `${category.initialCount}:${category.initialSpeedPresent ? 1 : 0}`;
}

function targetStatesFor(
  category: SpeedCategory,
  cache: Map<string, readonly TargetRollState[]>
): readonly TargetRollState[] {
  const key = targetShapeKey(category);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const states = enumerateTargetRollStates({
    targetPresent: category.initialSpeedPresent,
    initialCount: category.initialCount
  });
  cache.set(key, states);
  return states;
}

function validateProofStateProbabilityMass(
  states: readonly { probability: number }[],
  key: string
): void {
  if (states.length === 0) {
    fail("TIER0_PROOF_FAILED", `Tier 0 cell ${key} has no reachable compressed states`);
  }
  let probabilityMass = 0;
  for (const [index, state] of states.entries()) {
    if (!Number.isFinite(state.probability) || state.probability <= 0) {
      fail(
        "TIER0_PROOF_FAILED",
        `Tier 0 cell ${key} state ${index} has invalid probability ${String(state.probability)}`
      );
    }
    probabilityMass += state.probability;
  }
  if (Math.abs(probabilityMass - 1) > PROBABILITY_TOLERANCE) {
    fail(
      "TIER0_PROOF_FAILED",
      `Tier 0 cell ${key} compressed-state probability mass is ${probabilityMass}, not 1`
    );
  }
}

function proveTrustedTier0(
  decision: SpeedDecisionReport,
  stateCache: Map<string, readonly TargetRollState[]> = new Map()
): Tier0ProofReport {
  const tier0Cells = decision.categories.filter((cell) =>
    cell.disposition === "discard" && cell.riskTier === "tier0"
  );
  const cells: Tier0CellProof[] = [];
  let stateCount = 0;
  let thresholdCount = 0;
  let comparisonCount = 0;

  for (const cell of tier0Cells) {
    if (cell.category.mainStatIsSpeed) {
      fail("TIER0_PROOF_FAILED", `Tier 0 cell ${cell.key} has a protected speed main stat`);
    }
    const thresholds = cell.comparisons.map((comparison, index) => {
      if (comparison.outcome !== "dominated") {
        return fail(
          "TIER0_PROOF_FAILED",
          `Tier 0 cell ${cell.key} comparison ${index} is not dominated`
        );
      }
      if (comparison.threshold === null) {
        return fail(
          "TIER0_PROOF_FAILED",
          `Tier 0 cell ${cell.key} comparison ${index} has a null threshold`
        );
      }
      if (!Number.isFinite(comparison.threshold) || comparison.threshold < 0) {
        return fail(
          "TIER0_PROOF_FAILED",
          `Tier 0 cell ${cell.key} comparison ${index} has an invalid threshold`
        );
      }
      return comparison.threshold;
    });
    const states = targetStatesFor(cell.category, stateCache);
    validateProofStateProbabilityMass(states, cell.key);

    let maximumStateSpeed = 0;
    for (const [stateIndex, state] of states.entries()) {
      const stateSpeedUpperBound = state.targetRolls * SUB_STAT_MAX_ROLLS.speed;
      maximumStateSpeed = Math.max(maximumStateSpeed, stateSpeedUpperBound);
      for (const [thresholdIndex, threshold] of thresholds.entries()) {
        if (stateSpeedUpperBound > threshold) {
          fail(
            "TIER0_PROOF_FAILED",
            `Tier 0 cell ${cell.key} state ${stateIndex} speed upper bound ` +
              `${stateSpeedUpperBound} exceeds threshold ${thresholdIndex} (${threshold})`
          );
        }
      }
    }
    if (!isClose(maximumStateSpeed, cell.subStatUpperBound)) {
      fail(
        "TIER0_PROOF_FAILED",
        `Tier 0 cell ${cell.key} enumerated upper bound ${maximumStateSpeed} does not match ` +
          `decision upper bound ${cell.subStatUpperBound}`
      );
    }

    const cellComparisonCount = states.length * thresholds.length;
    stateCount += states.length;
    thresholdCount += thresholds.length;
    comparisonCount += cellComparisonCount;
    cells.push({
      key: cell.key,
      stateCount: states.length,
      thresholdCount: thresholds.length,
      comparisonCount: cellComparisonCount,
      maximumStateSpeed,
      minimumThreshold: thresholds.length === 0 ? null : Math.min(...thresholds)
    });
  }

  return {
    cellCount: cells.length,
    stateCount,
    thresholdCount,
    comparisonCount,
    cells
  };
}

/** Recompute the decision report, then exhaustively prove every Tier 0 discard cell. */
export function proveTier0(decisionInput: DecideSpeedCategoriesInput): Tier0ProofReport {
  let decision: SpeedDecisionReport;
  try {
    decision = decideSpeedCategories(decisionInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("INVALID_INPUT", `Could not derive a trusted speed decision: ${message}`);
  }
  return proveTrustedTier0(decision);
}

function requireFiniteStatRecord(
  value: unknown,
  path: string,
  allowedStats: ReadonlySet<StatId>,
  maximumCount: number
): Partial<Record<StatId, number>> {
  if (!isRecord(value)) return fail("INVALID_SOURCE", `${path} must be an object`);
  const entries = Object.entries(value);
  if (entries.length > maximumCount) {
    return fail("INVALID_SOURCE", `${path} must contain at most ${maximumCount} stats`);
  }
  const result: Partial<Record<StatId, number>> = {};
  for (const [stat, rawValue] of entries) {
    if (!allowedStats.has(stat as StatId)) {
      return fail("INVALID_SOURCE", `${path} contains unsupported stat ${stat}`);
    }
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue < 0) {
      return fail("INVALID_SOURCE", `${path}.${stat} must be a finite non-negative number`);
    }
    result[stat as StatId] = rawValue;
  }
  return result;
}

function sameStatRecord(
  left: Partial<Record<StatId, number>>,
  right: Partial<Record<StatId, number>>
): boolean {
  const leftEntries = Object.entries(left) as Array<[StatId, number]>;
  const rightEntries = Object.entries(right) as Array<[StatId, number]>;
  return leftEntries.length === rightEntries.length &&
    leftEntries.every(([stat, value]) => right[stat] === value);
}

function validateSourceItems(value: unknown): YyxYuhun[] {
  if (!Array.isArray(value)) return fail("INVALID_INPUT", "sourceItems must be an array");
  const seenIds = new Set<string>();
  const eligible: YyxYuhun[] = [];

  for (const [index, rawItem] of value.entries()) {
    const path = `sourceItems[${index}]`;
    if (!isRecord(rawItem)) return fail("INVALID_SOURCE", `${path} must be an object`);
    if (typeof rawItem.id !== "string" || rawItem.id.length === 0) {
      return fail("INVALID_SOURCE", `${path}.id must be a non-empty string`);
    }
    if (seenIds.has(rawItem.id)) {
      return fail("INVALID_SOURCE", `${path}.id duplicates ${rawItem.id}`);
    }
    seenIds.add(rawItem.id);
    if (!Number.isInteger(rawItem.star) || (rawItem.star as number) < 1 ||
        (rawItem.star as number) > 6) {
      return fail("INVALID_SOURCE", `${path}.star must be an integer from 1 to 6`);
    }
    if (!Number.isInteger(rawItem.level) || (rawItem.level as number) < 0 ||
        (rawItem.level as number) > 15) {
      return fail("INVALID_SOURCE", `${path}.level must be an integer from 0 to 15`);
    }
    if (typeof rawItem.lock !== "boolean" || typeof rawItem.garbage !== "boolean") {
      return fail("INVALID_SOURCE", `${path}.lock and .garbage must be boolean`);
    }
    if (rawItem.star !== 6 || rawItem.level !== 0) continue;

    if (!Number.isInteger(rawItem.suitId) || !SUIT_NAMES_BY_ID.has(rawItem.suitId as number)) {
      return fail("INVALID_SOURCE", `${path}.suitId is not a known yuhun suit ID`);
    }
    if (rawItem.name !== SUIT_NAMES_BY_ID.get(rawItem.suitId as number)) {
      return fail("INVALID_SOURCE", `${path}.name does not match suitId`);
    }
    if (!Number.isInteger(rawItem.position) ||
        !YUHUN_POSITIONS.includes(rawItem.position as (typeof YUHUN_POSITIONS)[number])) {
      return fail("INVALID_SOURCE", `${path}.position must be an integer from 1 to 6`);
    }
    if (typeof rawItem.mainStat !== "string" || !KNOWN_MAIN_STATS.has(rawItem.mainStat as StatId)) {
      return fail("INVALID_SOURCE", `${path}.mainStat is not supported`);
    }
    if (typeof rawItem.mainValue !== "number" || !Number.isFinite(rawItem.mainValue) ||
        rawItem.mainValue < 0) {
      return fail("INVALID_SOURCE", `${path}.mainValue must be a finite non-negative number`);
    }
    const subStats = requireFiniteStatRecord(rawItem.subStats, `${path}.subStats`, KNOWN_SUB_STATS, 4);
    const initialSubStats = requireFiniteStatRecord(
      rawItem.initialSubStats,
      `${path}.initialSubStats`,
      KNOWN_SUB_STATS,
      4
    );
    if (Object.keys(initialSubStats).length < 1) {
      return fail("INVALID_SOURCE", `${path}.initialSubStats must contain at least one stat`);
    }
    if (!sameStatRecord(subStats, initialSubStats)) {
      return fail(
        "INVALID_SOURCE",
        `${path}.subStats must exactly match initialSubStats for a level-0 item`
      );
    }
    requireFiniteStatRecord(
      rawItem.intrinsicStats,
      `${path}.intrinsicStats`,
      KNOWN_INTRINSIC_STATS,
      1
    );
    if (!Number.isSafeInteger(rawItem.born) || (rawItem.born as number) < 0) {
      return fail("INVALID_SOURCE", `${path}.born must be a non-negative safe integer`);
    }

    const item = rawItem as unknown as YyxYuhun;
    sourceCell(item);
    eligible.push(item);
  }
  if (eligible.length === 0) {
    return fail("INVALID_SOURCE", "sourceItems contains no six-star level-0 yuhun");
  }
  return eligible;
}

function sourceCell(item: YyxYuhun): {
  readonly suitId: number;
  readonly category: SpeedCategory;
} {
  if (item.initialSubStats === null) {
    return fail("INVALID_SOURCE", `Source item ${item.id} is missing initialSubStats`);
  }
  const initialCount = Object.keys(item.initialSubStats).length;
  const category: SpeedCategory = {
    position: item.position as SpeedCategory["position"],
    mainStatIsSpeed: item.mainStat === "speed",
    initialCount: initialCount as SpeedCategory["initialCount"],
    initialSpeedPresent: Object.prototype.hasOwnProperty.call(item.initialSubStats, "speed")
  };
  try {
    categoryUpperBound(category);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("INVALID_SOURCE", `Source item ${item.id} has an invalid speed category: ${message}`);
  }
  return { suitId: item.suitId, category };
}

function assertSourceFrequencyMatchesPlan(
  sourceItems: readonly YyxYuhun[],
  decision: SpeedDecisionReport
): void {
  const sourceFrequencies = estimateSpeedCategoryFrequencies(sourceItems);
  if (sourceFrequencies.sampleSize !== decision.sampleSize) {
    fail(
      "SOURCE_FREQUENCY_MISMATCH",
      `Source frequency sample size ${sourceFrequencies.sampleSize} does not match ` +
        `plan decision sample size ${decision.sampleSize}`
    );
  }
  if (sourceFrequencies.categories.length !== decision.categories.length) {
    fail("SOURCE_FREQUENCY_MISMATCH", "Source and plan decision category universes differ");
  }
  const decisionsByKey = new Map(decision.categories.map((entry) => [entry.key, entry]));
  for (const source of sourceFrequencies.categories) {
    const planned = decisionsByKey.get(source.key);
    if (planned === undefined || planned.count !== source.count ||
        planned.frequency !== source.frequency ||
        planned.frequencyPerTenThousand !== source.frequencyPerTenThousand) {
      fail(
        "SOURCE_FREQUENCY_MISMATCH",
        `Source frequency for category ${source.key} does not exactly match the plan decision`
      );
    }
  }
}

function genericDiscards(category: SpeedCategory): boolean {
  const retained = category.mainStatIsSpeed || (
    GENERIC_SPEED_POSITIONS.has(category.position) &&
    category.initialCount === 4 &&
    category.initialSpeedPresent
  );
  return !retained;
}

function exactExceedProbability(decision: SpeedCategoryDecision): number | null {
  if (decision.comparisons.length === 0) return 0;
  if (decision.comparisons.some((comparison) =>
    comparison.threshold === null || comparison.outcome === "missing-witness"
  )) return null;
  if (decision.minimumThreshold === null) return null;
  return categoryStrictExceedProbability(decision.category, decision.minimumThreshold);
}

function buildPopulation(
  plan: DualFilterDrafts,
  sourceItems: readonly YyxYuhun[]
): { readonly members: readonly PopulationMember[]; readonly planDiscardCount: number } {
  const normalizedItems = sourceItems.map((item): YyxYuhun => ({
    ...item,
    subStats: { ...item.subStats },
    intrinsicStats: { ...item.intrinsicStats },
    initialSubStats: item.initialSubStats === null ? null : { ...item.initialSubStats },
    lock: false,
    garbage: false
  }));
  const preview = previewDualFilterShares({
    discardShare: plan.discardDraft === null ? null : filterShareFromDraft(plan.discardDraft),
    rescueShare: plan.rescueDraft === null ? null : filterShareFromDraft(plan.rescueDraft),
    items: normalizedItems
  });
  const realizedDiscardIds = new Set(preview.finalNewDiscardIds);
  const decisionsByKey = new Map(plan.decision.categories.map((decision) => [decision.key, decision]));
  const members = normalizedItems.map((item): PopulationMember => {
    const cell = sourceCell(item);
    const key = speedDecisionCategoryKey(cell);
    const decision = decisionsByKey.get(key);
    if (decision === undefined) {
      return fail("SOURCE_FREQUENCY_MISMATCH", `Plan decision is missing source category ${key}`);
    }
    const realizedPlanDiscard = realizedDiscardIds.has(item.id);
    if (realizedPlanDiscard && decision.disposition !== "discard") {
      return fail(
        "PLAN_NOT_DECISION_SUBSET",
        `Final D\\E plan discards source item ${item.id} from retained decision category ${key}`
      );
    }
    const selections: StrategySelection = {
      personalized: decision.disposition === "discard",
      generic: genericDiscards(decision.category),
      realizedPlan: realizedPlanDiscard
    };
    const probability = exactExceedProbability(decision);
    if (probability === null && Object.values(selections).some(Boolean)) {
      return fail(
        "MISSING_THRESHOLD",
        `Discarded source category ${key} has no numeric minimum threshold`
      );
    }
    return {
      item,
      decision,
      personalizedDiscard: selections.personalized,
      genericDiscard: selections.generic,
      realizedPlanDiscard: selections.realizedPlan,
      exactExceedProbability: probability
    };
  });
  return { members, planDiscardCount: realizedDiscardIds.size };
}

function strategySelection(member: PopulationMember, strategy: StrategyName): boolean {
  switch (strategy) {
    case "personalized": return member.personalizedDiscard;
    case "generic": return member.genericDiscard;
    case "realizedPlan": return member.realizedPlanDiscard;
  }
}

function exactStrategyProfile(
  members: readonly PopulationMember[],
  strategy: StrategyName
): ExactStrategyProfile {
  let discardCount = 0;
  let riskProbabilitySum = 0;
  for (const member of members) {
    if (!strategySelection(member, strategy)) continue;
    discardCount += 1;
    if (member.exactExceedProbability === null) {
      return fail(
        "MISSING_THRESHOLD",
        `${strategy} discards category ${member.decision.key} without a numeric threshold`
      );
    }
    riskProbabilitySum += member.exactExceedProbability;
  }
  return {
    discardCoverage: discardCount / members.length,
    riskPerTenThousand: riskProbabilitySum / members.length * 10_000
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / PROBABILITY_DENOMINATOR;
  };
}

function validateRollDistribution(
  outcomes: readonly TargetRollOutcome[],
  key: string
): void {
  if (outcomes.length === 0) {
    fail("INVALID_INPUT", `Target-roll distribution for ${key} is empty`);
  }
  let total = 0;
  for (const [index, outcome] of outcomes.entries()) {
    if (!Number.isInteger(outcome.rolls) || outcome.rolls < 0 || outcome.rolls > 6 ||
        !Number.isFinite(outcome.probability) || outcome.probability < 0) {
      fail("INVALID_INPUT", `Target-roll distribution for ${key} has invalid outcome ${index}`);
    }
    total += outcome.probability;
  }
  if (Math.abs(total - 1) > PROBABILITY_TOLERANCE) {
    fail("INVALID_INPUT", `Target-roll distribution for ${key} has probability mass ${total}`);
  }
}

function targetRollsFor(
  category: SpeedCategory,
  cache: Map<string, readonly TargetRollOutcome[]>
): readonly TargetRollOutcome[] {
  const key = targetShapeKey(category);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const outcomes = enumerateTargetRolls({
    targetPresent: category.initialSpeedPresent,
    initialCount: category.initialCount
  });
  validateRollDistribution(outcomes, key);
  cache.set(key, outcomes);
  return outcomes;
}

function sampleRollCount(outcomes: readonly TargetRollOutcome[], random: number): number {
  let cumulative = 0;
  for (const outcome of outcomes) {
    cumulative += outcome.probability;
    if (random < cumulative) return outcome.rolls;
  }
  return outcomes[outcomes.length - 1]!.rolls;
}

function exactSparseBinomialUpperBound(sampleSize: number, probability: number): number {
  if (probability === 0) return 0;

  let probabilityAtCount = Math.exp(sampleSize * Math.log1p(-probability));
  let cumulativeBeforeCount = 0;
  const odds = probability / (1 - probability);
  for (let count = 0; count <= sampleSize; count += 1) {
    const upperTailAtCount = Math.max(0, 1 - cumulativeBeforeCount);
    if (upperTailAtCount < FOUR_SIGMA_ONE_SIDED_TAIL) return Math.max(0, count - 1);
    cumulativeBeforeCount += probabilityAtCount;
    if (count === sampleSize) break;
    probabilityAtCount *= (sampleSize - count) / (count + 1) * odds;
  }
  return sampleSize;
}

function calibrationAcceptanceBounds(
  probability: number,
  sampleSize: number,
  expectedCount: number,
  maximumError: number
): {
  readonly method: CalibrationMethod;
  readonly minimum: number;
  readonly maximum: number;
} {
  if (expectedCount < MIN_NORMAL_EXPECTED_COUNT) {
    return {
      method: "exact-binomial-four-sigma",
      minimum: 0,
      maximum: exactSparseBinomialUpperBound(sampleSize, probability)
    };
  }
  const expectedFailures = sampleSize - expectedCount;
  if (expectedFailures < MIN_NORMAL_EXPECTED_COUNT) {
    const maximumFailures = exactSparseBinomialUpperBound(sampleSize, 1 - probability);
    return {
      method: "exact-binomial-four-sigma",
      minimum: sampleSize - maximumFailures,
      maximum: sampleSize
    };
  }
  return {
    method: "normal-four-sigma",
    minimum: Math.max(0, Math.ceil(expectedCount - maximumError - PROBABILITY_TOLERANCE)),
    maximum: Math.min(
      sampleSize,
      Math.floor(expectedCount + maximumError + PROBABILITY_TOLERANCE)
    )
  };
}

function fourSigmaCalibration(
  label: string,
  observedCount: number,
  probability: number,
  sampleSize: number
): FourSigmaCalibration {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    return fail("INVALID_INPUT", `${label} exact probability ${probability} is invalid`);
  }
  const expectedCount = sampleSize * probability;
  const standardDeviation = Math.sqrt(sampleSize * probability * (1 - probability));
  const absoluteError = Math.abs(observedCount - expectedCount);
  const maximumError = FOUR_SIGMA * standardDeviation;
  const acceptance = calibrationAcceptanceBounds(
    probability,
    sampleSize,
    expectedCount,
    maximumError
  );
  if (observedCount < acceptance.minimum || observedCount > acceptance.maximum) {
    fail(
      "CALIBRATION_FAILED",
      `${label} observed count ${observedCount} differs from exact expectation ${expectedCount} ` +
        `by ${absoluteError}; ${acceptance.method} accepts integer counts from ` +
        `${acceptance.minimum} through ${acceptance.maximum}`
    );
  }
  return {
    method: acceptance.method,
    expectedCount,
    standardDeviation,
    absoluteError,
    maximumError,
    minimumAcceptedCount: acceptance.minimum,
    maximumAcceptedCount: acceptance.maximum
  };
}

function finalizeStrategy(
  name: StrategyName,
  counts: MutableStrategyCounts,
  exact: ExactStrategyProfile,
  sampleSize: number
): SpeedSimulationStrategyReport {
  const exactRiskProbability = exact.riskPerTenThousand / 10_000;
  return {
    discardCount: counts.discardCount,
    discardCoverage: counts.discardCount / sampleSize,
    missCount: counts.missCount,
    missesPerTenThousandDrops: counts.missCount / sampleSize * 10_000,
    exactDiscardCoverage: exact.discardCoverage,
    exactExpectedMissesPerTenThousandDrops: exact.riskPerTenThousand,
    calibration: {
      discard: fourSigmaCalibration(
        `${name} discard calibration`,
        counts.discardCount,
        exact.discardCoverage,
        sampleSize
      ),
      miss: fourSigmaCalibration(
        `${name} miss calibration`,
        counts.missCount,
        exactRiskProbability,
        sampleSize
      )
    }
  };
}

function validateSimulationInput(input: SimulateSpeedValidationInput): {
  readonly sampleSize: number;
  readonly seed: number;
} {
  if (!isRecord(input)) return fail("INVALID_INPUT", "simulation input must be an object");
  const sampleSize = input.sampleSize ?? DEFAULT_SIMULATION_SAMPLE_SIZE;
  if (!Number.isSafeInteger(sampleSize) || sampleSize < DEFAULT_SIMULATION_SAMPLE_SIZE) {
    return fail(
      "INVALID_INPUT",
      `sampleSize must be a safe integer of at least ${DEFAULT_SIMULATION_SAMPLE_SIZE}`
    );
  }
  const seed = input.seed ?? DEFAULT_SIMULATION_SEED;
  if (!Number.isInteger(seed) || seed < 0 || seed > UINT32_MAX) {
    return fail("INVALID_INPUT", "seed must be an unsigned 32-bit integer");
  }
  if (input.onProgress !== undefined && typeof input.onProgress !== "function") {
    return fail("INVALID_INPUT", "onProgress must be a function when provided");
  }
  return { sampleSize, seed };
}

/**
 * Validate the personalized decision, the generic player rule, and the encoded D\\E plan
 * against a seeded synthetic population drawn from the supplied empirical level-0 source.
 */
export function simulateSpeedValidation(
  input: SimulateSpeedValidationInput
): SpeedValidationReport {
  const { sampleSize, seed } = validateSimulationInput(input);
  const sourceItems = validateSourceItems(input.sourceItems);
  let plan: DualFilterDrafts;
  try {
    plan = buildDualFilterDrafts(input.planInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail("INVALID_INPUT", `Could not derive a trusted filter plan: ${message}`);
  }
  assertSourceFrequencyMatchesPlan(sourceItems, plan.decision);
  const tier0Proof = proveTrustedTier0(plan.decision, new Map());
  const { members, planDiscardCount } = buildPopulation(plan, sourceItems);

  const exact = {
    personalized: exactStrategyProfile(members, "personalized"),
    generic: exactStrategyProfile(members, "generic"),
    realizedPlan: exactStrategyProfile(members, "realizedPlan")
  };
  if (!isClose(
    exact.personalized.riskPerTenThousand,
    plan.decision.expectedMissesPerTenThousand
  )) {
    fail(
      "BUDGET_EXCEEDED",
      `Exact personalized risk ${exact.personalized.riskPerTenThousand} does not match ` +
        `decision risk ${plan.decision.expectedMissesPerTenThousand}`
    );
  }
  if (exact.personalized.riskPerTenThousand >
      plan.decision.budgetPerTenThousand + PROBABILITY_TOLERANCE) {
    fail(
      "BUDGET_EXCEEDED",
      `Exact personalized risk ${exact.personalized.riskPerTenThousand} exceeds budget ` +
        `${plan.decision.budgetPerTenThousand}`
    );
  }
  if (exact.realizedPlan.riskPerTenThousand >
      exact.personalized.riskPerTenThousand + PROBABILITY_TOLERANCE) {
    fail("PLAN_NOT_DECISION_SUBSET", "Final D\\E plan risk exceeds personalized decision risk");
  }

  const rollDistributions = new Map<string, readonly TargetRollOutcome[]>();
  for (const member of members) {
    targetRollsFor(member.decision.category, rollDistributions);
  }

  const counts: Record<StrategyName, MutableStrategyCounts> = {
    personalized: { discardCount: 0, missCount: 0 },
    generic: { discardCount: 0, missCount: 0 },
    realizedPlan: { discardCount: 0, missCount: 0 }
  };
  let tier0DiscardCount = 0;
  let tier0MissCount = 0;
  const random = mulberry32(seed);
  for (let sample = 0; sample < sampleSize; sample += 1) {
    const member = members[Math.floor(random() * members.length)]!;
    const outcomes = targetRollsFor(member.decision.category, rollDistributions);
    const rolls = sampleRollCount(outcomes, random());
    let finalSpeed = 0;
    for (let roll = 0; roll < rolls; roll += 1) {
      finalSpeed += (0.8 + 0.2 * random()) * SUB_STAT_MAX_ROLLS.speed;
    }
    const improves = member.decision.minimumThreshold !== null &&
      finalSpeed > member.decision.minimumThreshold;

    for (const strategy of ["personalized", "generic", "realizedPlan"] as const) {
      if (!strategySelection(member, strategy)) continue;
      counts[strategy].discardCount += 1;
      if (improves) counts[strategy].missCount += 1;
    }
    if (member.decision.riskTier === "tier0" && member.personalizedDiscard) {
      tier0DiscardCount += 1;
      if (improves) tier0MissCount += 1;
    }
    if ((sample + 1) % 5_000 === 0) input.onProgress?.(sample + 1, sampleSize);
  }
  if (tier0MissCount !== 0) {
    fail("TIER0_MISS", `Tier 0 simulation produced ${tier0MissCount} mistaken discards`);
  }
  const personalizedMissesPerTenThousand =
    counts.personalized.missCount / sampleSize * 10_000;
  if (personalizedMissesPerTenThousand >
      plan.decision.budgetPerTenThousand + BUDGET_TOLERANCE) {
    fail(
      "BUDGET_EXCEEDED",
      `Seeded personalized miss rate ${personalizedMissesPerTenThousand} per ten thousand ` +
        `exceeds budget ${plan.decision.budgetPerTenThousand}`
    );
  }

  return {
    sampleSize,
    seed,
    sourceSampleSize: members.length,
    frequencyBiasNotice: FREQUENCY_BIAS_NOTICE,
    tier0Proof,
    planSourceDiscardCount: planDiscardCount,
    planSourceDiscardCoverage: planDiscardCount / members.length,
    tier0DiscardCount,
    tier0MissCount,
    planDiscardIsDecisionDiscardSubset: true,
    exactBudgetSatisfied: true,
    personalized: finalizeStrategy("personalized", counts.personalized, exact.personalized, sampleSize),
    generic: finalizeStrategy("generic", counts.generic, exact.generic, sampleSize),
    realizedPlan: finalizeStrategy("realizedPlan", counts.realizedPlan, exact.realizedPlan, sampleSize)
  };
}
