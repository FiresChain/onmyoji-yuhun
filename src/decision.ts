import {
  calculateBaseline,
  SCATTERED_ROLE,
  type BaselineRole,
  type DominanceThresholds
} from "./baseline.js";
import {
  categoryUpperBound,
  enumerateSpeedCategories,
  type SpeedCategory
} from "./categories.js";
import {
  SIX_STAR_SPEED_MAIN_STAT_MAX,
  YUHUN_POSITIONS,
  YUHUN_SUIT_IDS_BY_NAME
} from "./mappings.js";
import { enumerateTargetRolls, growthTailProbability } from "./potential.js";
import {
  validateTemplate,
  type RiskTier,
  type YuhunTemplate
} from "./templates.js";
import type { YyxYuhun } from "./yyx.js";

export const FREQUENCY_BIAS_NOTICE = "含玩家筛选偏差" as const;

export interface SuitSpeedCategory {
  readonly suitId: number;
  readonly category: SpeedCategory;
}

export interface SpeedCategoryFrequency extends SuitSpeedCategory {
  readonly key: string;
  readonly count: number;
  /** Empirical share among all six-star level-0 items in the snapshot. */
  readonly frequency: number;
  readonly frequencyPerTenThousand: number;
}

export interface SpeedCategoryFrequencyReport {
  readonly sampleSize: number;
  readonly biasNotice: typeof FREQUENCY_BIAS_NOTICE;
  readonly categories: readonly SpeedCategoryFrequency[];
}

export type ThresholdOutcome = "dominated" | "can-exceed" | "missing-witness";

export interface ThresholdComparison {
  readonly templateId: string;
  readonly templateRiskTier: RiskTier;
  readonly role: BaselineRole;
  readonly threshold: number | null;
  readonly subStatUpperBound: number;
  readonly outcome: ThresholdOutcome;
  /** Strict P(final sub-stat speed > threshold); null when no witness exists. */
  readonly strictExceedProbability: number | null;
}

export type DecisionDisposition = "discard" | "retain";
export type DecisionReason =
  | "speed-main-protected"
  | "missing-witness"
  | "tier0-template-not-dominated"
  | "tier0-dominated"
  | "unobserved-frequency"
  | "tier1-budget-selected"
  | "tier1-budget-excluded";

export interface SpeedCategoryDecision extends SpeedCategoryFrequency {
  readonly subStatUpperBound: number;
  readonly comparisons: readonly ThresholdComparison[];
  readonly minimumThreshold: number | null;
  readonly minimumThresholdSources: readonly {
    templateId: string;
    role: BaselineRole;
  }[];
  readonly exceedProbability: number | null;
  readonly riskPerTenThousand: number | null;
  readonly disposition: DecisionDisposition;
  readonly riskTier: RiskTier | null;
  readonly reason: DecisionReason;
}

export interface SpeedDecisionReport {
  readonly sampleSize: number;
  readonly biasNotice: typeof FREQUENCY_BIAS_NOTICE;
  readonly budgetPerTenThousand: number;
  readonly expectedMissesPerTenThousand: number;
  readonly observedDiscardCount: number;
  readonly observedDiscardCoverage: number | null;
  readonly tier0DiscardedCategoryCount: number;
  readonly tier1DiscardedCategoryCount: number;
  readonly categories: readonly SpeedCategoryDecision[];
  /** Present only when the caller requests diagnostics for the Tier 1 selector. */
  readonly tier1SelectionDiagnostics?: Tier1SelectionDiagnostics;
}

export interface Tier1SelectionDiagnostics {
  readonly candidateCount: number;
  readonly maximumCoverage: number;
  readonly transitionCount: number;
  readonly updatedStateCount: number;
}

export interface DecideSpeedCategoriesInput {
  readonly templates: readonly YuhunTemplate[];
  readonly thresholds: DominanceThresholds;
  readonly frequencies: SpeedCategoryFrequencyReport;
  readonly budgetPerTenThousand?: number;
  readonly diagnostics?: boolean;
}

interface TemplateCompatibility {
  readonly template: YuhunTemplate;
  readonly rolesByPositionAndSuit: ReadonlyMap<string, readonly BaselineRole[]>;
}

interface MutableDecision extends SpeedCategoryFrequency {
  subStatUpperBound: number;
  comparisons: ThresholdComparison[];
  minimumThreshold: number | null;
  minimumThresholdSources: Array<{ templateId: string; role: BaselineRole }>;
  exceedProbability: number | null;
  riskPerTenThousand: number | null;
  disposition: DecisionDisposition;
  riskTier: RiskTier | null;
  reason: DecisionReason;
}

interface SelectionNode {
  readonly candidateIndex: number;
  readonly previous: SelectionNode | null;
}

const KNOWN_SUIT_IDS = Object.freeze(
  Object.values(YUHUN_SUIT_IDS_BY_NAME).sort((left, right) => left - right)
);
const KNOWN_SUIT_ID_SET = new Set<number>(KNOWN_SUIT_IDS);
const BUDGET_EPSILON = 1e-12;

function booleanDigit(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

/** Stable key for the mutually exclusive `(suitId, SpeedCategory)` decision cell. */
export function speedDecisionCategoryKey(cell: SuitSpeedCategory): string {
  return [
    String(cell.suitId).padStart(6, "0"),
    `p${cell.category.position}`,
    `m${booleanDigit(cell.category.mainStatIsSpeed)}`,
    `n${cell.category.initialCount}`,
    `s${booleanDigit(cell.category.initialSpeedPresent)}`
  ].join(":");
}

function frequencyCell(item: YyxYuhun): SuitSpeedCategory {
  if (!KNOWN_SUIT_ID_SET.has(item.suitId)) {
    throw new Error(`Cannot estimate speed-category frequency for unknown suit ID ${item.suitId}`);
  }
  if (item.initialSubStats === null) {
    throw new Error(`Six-star level-0 item ${item.id} is missing its initial sub-stats`);
  }
  const initialCount = Object.keys(item.initialSubStats).length;
  if (initialCount < 1 || initialCount > 4) {
    throw new Error(`Six-star level-0 item ${item.id} has invalid initial sub-stat count ${initialCount}`);
  }
  const cell: SuitSpeedCategory = {
    suitId: item.suitId,
    category: {
      position: item.position as SpeedCategory["position"],
      mainStatIsSpeed: item.mainStat === "speed",
      initialCount: initialCount as SpeedCategory["initialCount"],
      initialSpeedPresent: Object.prototype.hasOwnProperty.call(item.initialSubStats, "speed")
    }
  };
  // Reuse the category module's structural validation.
  categoryUpperBound(cell.category);
  return cell;
}

/**
 * Estimate the empirical frequency of every known six-star level-0 cell.
 * Locked and garbage-marked items intentionally remain in the denominator.
 */
export function estimateSpeedCategoryFrequencies(
  items: readonly YyxYuhun[]
): SpeedCategoryFrequencyReport {
  if (!Array.isArray(items)) throw new Error("items must be an array");
  const counts = new Map<string, number>();
  let sampleSize = 0;
  for (const item of items) {
    if (item.star !== 6 || item.level !== 0) continue;
    const cell = frequencyCell(item);
    const key = speedDecisionCategoryKey(cell);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    sampleSize += 1;
  }

  const categories: SpeedCategoryFrequency[] = [];
  for (const suitId of KNOWN_SUIT_IDS) {
    for (const category of enumerateSpeedCategories()) {
      const cell = { suitId, category };
      const key = speedDecisionCategoryKey(cell);
      const count = counts.get(key) ?? 0;
      const frequency = sampleSize === 0 ? 0 : count / sampleSize;
      categories.push({
        key,
        suitId,
        category: { ...category },
        count,
        frequency,
        frequencyPerTenThousand: frequency * 10_000
      });
    }
  }
  categories.sort((left, right) => left.key.localeCompare(right.key));
  return { sampleSize, biasNotice: FREQUENCY_BIAS_NOTICE, categories };
}

/** Exact P(final sub-stat speed > threshold), including the atom at zero. */
export function categoryStrictExceedProbability(
  category: SpeedCategory,
  threshold: number
): number {
  categoryUpperBound(category);
  if (!Number.isFinite(threshold)) throw new Error("threshold must be a finite number");
  const probability = enumerateTargetRolls({
    targetPresent: category.initialSpeedPresent,
    initialCount: category.initialCount
  }).reduce((sum, outcome) => {
    if (outcome.rolls === 0) {
      return sum + (threshold < 0 ? outcome.probability : 0);
    }
    return sum + outcome.probability * growthTailProbability(
      "speed",
      outcome.rolls,
      threshold
    );
  }, 0);
  return Math.max(0, Math.min(1, probability));
}

function parsePatternRole(role: BaselineRole): readonly number[] {
  if (role === SCATTERED_ROLE) return [];
  const prefix = role.startsWith("suits:") ? "suits:" : "suit:";
  return role.slice(prefix.length).split(",").map(Number);
}

function compatibilityKey(position: number, suitId: number): string {
  return `${position}:${suitId}`;
}

function buildTemplateCompatibility(templateInput: YuhunTemplate): TemplateCompatibility {
  const template = validateTemplate(templateInput);
  const patterns = calculateBaseline(template, []).patterns;
  const rolesByPositionAndSuit = new Map<string, readonly BaselineRole[]>();
  for (const position of YUHUN_POSITIONS) {
    const patternRoles = new Set(
      patterns.map((pattern) => pattern.rolesByPosition[position - 1]!)
    );
    const exactSuitIds = new Set<number>();
    for (const role of patternRoles) {
      for (const suitId of parsePatternRole(role)) exactSuitIds.add(suitId);
    }
    for (const suitId of KNOWN_SUIT_IDS) {
      const roles: BaselineRole[] = [];
      if (patternRoles.has(SCATTERED_ROLE)) roles.push(SCATTERED_ROLE);
      if (exactSuitIds.has(suitId)) roles.push(`suit:${suitId}`);
      rolesByPositionAndSuit.set(compatibilityKey(position, suitId), roles);
    }
  }
  return { template, rolesByPositionAndSuit };
}

function requireThresholdContainer(
  templates: readonly TemplateCompatibility[],
  thresholds: DominanceThresholds
): void {
  if (typeof thresholds !== "object" || thresholds === null || Array.isArray(thresholds)) {
    throw new Error("thresholds must be an object");
  }
  for (const { template } of templates) {
    const byPosition = thresholds[template.id];
    if (byPosition === undefined) {
      throw new Error(`Missing thresholds for template ${template.id}`);
    }
    for (const position of YUHUN_POSITIONS) {
      const byRole = byPosition[String(position)];
      if (byRole === undefined || typeof byRole !== "object" || byRole === null || Array.isArray(byRole)) {
        throw new Error(`Missing thresholds for template ${template.id}, position ${position}`);
      }
    }
  }
}

function validateFrequencyReport(report: SpeedCategoryFrequencyReport): SpeedCategoryFrequency[] {
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    throw new Error("frequencies must be a frequency report");
  }
  if (!Number.isSafeInteger(report.sampleSize) || report.sampleSize < 0) {
    throw new Error("frequencies.sampleSize must be a non-negative safe integer");
  }
  if (report.biasNotice !== FREQUENCY_BIAS_NOTICE) {
    throw new Error(`frequencies.biasNotice must be ${FREQUENCY_BIAS_NOTICE}`);
  }
  if (!Array.isArray(report.categories)) {
    throw new Error("frequencies.categories must be an array");
  }

  const seen = new Set<string>();
  let countSum = 0;
  const categories = report.categories.map((entry, index) => {
    const path = `frequencies.categories[${index}]`;
    categoryUpperBound(entry.category);
    if (!Number.isInteger(entry.suitId) || entry.suitId <= 0) {
      throw new Error(`${path}.suitId must be a positive integer`);
    }
    if (!KNOWN_SUIT_ID_SET.has(entry.suitId)) {
      throw new Error(`${path}.suitId is not a known yuhun suit ID`);
    }
    const expectedKey = speedDecisionCategoryKey(entry);
    if (entry.key !== expectedKey) throw new Error(`${path}.key does not match its category`);
    if (seen.has(entry.key)) throw new Error(`${path}.key is duplicated`);
    seen.add(entry.key);
    if (!Number.isSafeInteger(entry.count) || entry.count < 0) {
      throw new Error(`${path}.count must be a non-negative safe integer`);
    }
    const expectedFrequency = report.sampleSize === 0 ? 0 : entry.count / report.sampleSize;
    if (!Number.isFinite(entry.frequency) || Math.abs(entry.frequency - expectedFrequency) > 1e-12) {
      throw new Error(`${path}.frequency does not equal count / sampleSize`);
    }
    const expectedPerTenThousand = expectedFrequency * 10_000;
    if (!Number.isFinite(entry.frequencyPerTenThousand) ||
        Math.abs(entry.frequencyPerTenThousand - expectedPerTenThousand) > 1e-9) {
      throw new Error(`${path}.frequencyPerTenThousand is inconsistent with frequency`);
    }
    countSum += entry.count;
    return {
      ...entry,
      category: { ...entry.category }
    };
  });
  if (countSum !== report.sampleSize) {
    throw new Error("frequency category counts must sum to sampleSize");
  }
  for (const suitId of KNOWN_SUIT_IDS) {
    for (const category of enumerateSpeedCategories()) {
      const cell = { suitId, category };
      const key = speedDecisionCategoryKey(cell);
      if (seen.has(key)) continue;
      categories.push({
        key,
        suitId,
        category: { ...category },
        count: 0,
        frequency: 0,
        frequencyPerTenThousand: 0
      });
    }
  }
  categories.sort((left, right) => left.key.localeCompare(right.key));
  return categories;
}

function comparisonFor(
  template: YuhunTemplate,
  role: BaselineRole,
  threshold: number | null,
  category: SpeedCategory,
  upperBound: number
): ThresholdComparison {
  if (threshold === null) {
    return {
      templateId: template.id,
      templateRiskTier: template.riskTier,
      role,
      threshold,
      subStatUpperBound: upperBound,
      outcome: "missing-witness",
      strictExceedProbability: null
    };
  }
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error(
      `Invalid threshold for template ${template.id}, position ${category.position}, role ${role}`
    );
  }
  return {
    templateId: template.id,
    templateRiskTier: template.riskTier,
    role,
    threshold,
    subStatUpperBound: upperBound,
    outcome: upperBound <= threshold ? "dominated" : "can-exceed",
    strictExceedProbability: categoryStrictExceedProbability(category, threshold)
  };
}

function initialDecision(
  frequency: SpeedCategoryFrequency,
  templates: readonly TemplateCompatibility[],
  thresholds: DominanceThresholds
): MutableDecision {
  const category = frequency.category;
  const fullUpperBound = categoryUpperBound(category);
  const subStatUpperBound = category.mainStatIsSpeed
    ? fullUpperBound - SIX_STAR_SPEED_MAIN_STAT_MAX
    : fullUpperBound;
  if (category.mainStatIsSpeed) {
    return {
      ...frequency,
      subStatUpperBound,
      comparisons: [],
      minimumThreshold: null,
      minimumThresholdSources: [],
      exceedProbability: null,
      riskPerTenThousand: null,
      disposition: "retain",
      riskTier: null,
      reason: "speed-main-protected"
    };
  }

  const comparisons: ThresholdComparison[] = [];
  for (const compatibility of templates) {
    const { template } = compatibility;
    const roles = compatibility.rolesByPositionAndSuit.get(
      compatibilityKey(category.position, frequency.suitId)
    ) ?? [];
    const byRole = thresholds[template.id]![String(category.position)]!;
    for (const role of roles) {
      if (!Object.prototype.hasOwnProperty.call(byRole, role) || byRole[role] === undefined) {
        throw new Error(
          `Missing threshold for template ${template.id}, position ${category.position}, role ${role}`
        );
      }
      comparisons.push(comparisonFor(
        template,
        role,
        byRole[role]!,
        category,
        subStatUpperBound
      ));
    }
  }

  const numericComparisons = comparisons.filter(
    (comparison): comparison is ThresholdComparison & { threshold: number } => comparison.threshold !== null
  );
  const minimumThreshold = numericComparisons.length === 0
    ? null
    : Math.min(...numericComparisons.map((comparison) => comparison.threshold));
  const minimumThresholdSources = minimumThreshold === null
    ? []
    : numericComparisons
      .filter((comparison) => comparison.threshold === minimumThreshold)
      .map((comparison) => ({ templateId: comparison.templateId, role: comparison.role }));

  const base = {
    ...frequency,
    subStatUpperBound,
    comparisons,
    minimumThreshold,
    minimumThresholdSources
  };
  if (comparisons.some((comparison) => comparison.outcome === "missing-witness")) {
    return {
      ...base,
      exceedProbability: null,
      riskPerTenThousand: null,
      disposition: "retain",
      riskTier: null,
      reason: "missing-witness"
    };
  }
  if (comparisons.every((comparison) => comparison.outcome === "dominated")) {
    return {
      ...base,
      exceedProbability: 0,
      riskPerTenThousand: 0,
      disposition: "discard",
      riskTier: "tier0",
      reason: "tier0-dominated"
    };
  }
  if (comparisons.some((comparison) =>
    comparison.templateRiskTier === "tier0" && comparison.outcome !== "dominated"
  )) {
    return {
      ...base,
      exceedProbability: minimumThreshold === null
        ? null
        : categoryStrictExceedProbability(category, minimumThreshold),
      riskPerTenThousand: null,
      disposition: "retain",
      riskTier: null,
      reason: "tier0-template-not-dominated"
    };
  }
  if (minimumThreshold === null) {
    throw new Error(`Category ${frequency.key} can exceed a threshold but has no numeric threshold`);
  }
  const exceedProbability = categoryStrictExceedProbability(category, minimumThreshold);
  const riskPerTenThousand = frequency.frequencyPerTenThousand * exceedProbability;
  if (frequency.count === 0) {
    return {
      ...base,
      exceedProbability,
      riskPerTenThousand,
      disposition: "retain",
      riskTier: null,
      reason: "unobserved-frequency"
    };
  }
  return {
    ...base,
    exceedProbability,
    riskPerTenThousand,
    disposition: "retain",
    riskTier: null,
    reason: "tier1-budget-excluded"
  };
}

function selectTier1Candidates(
  decisions: MutableDecision[],
  budget: number,
  collectDiagnostics: boolean
): { readonly selected: Set<number>; readonly diagnostics: Tier1SelectionDiagnostics } {
  const candidates = decisions
    .map((decision, decisionIndex) => ({ decision, decisionIndex }))
    .filter(({ decision }) =>
      decision.reason === "tier1-budget-excluded" &&
      decision.count > 0 &&
      decision.riskPerTenThousand !== null
    )
    .sort((left, right) => left.decision.key.localeCompare(right.decision.key));
  if (candidates.length === 0) {
    return {
      selected: new Set(),
      diagnostics: { candidateCount: 0, maximumCoverage: 0, transitionCount: 0, updatedStateCount: 0 }
    };
  }

  const maximumCoverage = candidates.reduce((sum, candidate) => sum + candidate.decision.count, 0);
  const bestRisk = new Float64Array(maximumCoverage + 1);
  bestRisk.fill(Number.POSITIVE_INFINITY);
  bestRisk[0] = 0;
  const bestNode: Array<SelectionNode | null> = Array.from(
    { length: maximumCoverage + 1 },
    () => null
  );
  let reachableCoverage = 0;
  let transitionCount = 0;
  let updatedStateCount = 0;

  // Exact 0/1 knapsack: primary objective is observed discard coverage;
  // minimum cumulative risk is retained for every exact coverage value.
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const count = candidate.decision.count;
    const risk = candidate.decision.riskPerTenThousand!;
    transitionCount += reachableCoverage + 1;
    for (let covered = reachableCoverage; covered >= 0; covered -= 1) {
      const previousRisk = bestRisk[covered]!;
      if (!Number.isFinite(previousRisk)) continue;
      const nextRisk = previousRisk + risk;
      if (nextRisk > budget + BUDGET_EPSILON) continue;
      const nextCovered = covered + count;
      if (nextRisk < bestRisk[nextCovered]!) {
        const previous = covered === 0 ? null : bestNode[covered];
        if (previous === undefined || (covered > 0 && previous === null)) {
          throw new Error("Tier 1 selection state is missing its backtracking node");
        }
        bestRisk[nextCovered] = nextRisk;
        bestNode[nextCovered] = {
          candidateIndex,
          previous
        };
        if (collectDiagnostics) updatedStateCount += 1;
      }
    }
    reachableCoverage += count;
  }

  let selectedCoverage = reachableCoverage;
  while (selectedCoverage > 0 && !Number.isFinite(bestRisk[selectedCoverage]!)) {
    selectedCoverage -= 1;
  }
  const selected = new Set<number>();
  let node: SelectionNode | null = bestNode[selectedCoverage] ?? null;
  while (node !== null) {
    selected.add(candidates[node.candidateIndex]!.decisionIndex);
    node = node.previous;
  }
  return {
    selected,
    diagnostics: {
      candidateCount: candidates.length,
      maximumCoverage,
      transitionCount,
      updatedStateCount
    }
  };
}

/**
 * Apply deterministic Tier 0 dominance and the shared Tier 1 expected-miss budget.
 * Tier 1 maximizes observed discard count, then minimizes cumulative risk.
 */
export function decideSpeedCategories(input: DecideSpeedCategoriesInput): SpeedDecisionReport {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("decision input must be an object");
  }
  if (!Array.isArray(input.templates) || input.templates.length === 0) {
    throw new Error("templates must be a non-empty array");
  }
  const templateIds = new Set<string>();
  const templates = input.templates.map((template) => {
    const compatibility = buildTemplateCompatibility(template);
    if (templateIds.has(compatibility.template.id)) {
      throw new Error(`Duplicate template id ${compatibility.template.id}`);
    }
    templateIds.add(compatibility.template.id);
    return compatibility;
  }).sort((left, right) => left.template.id.localeCompare(right.template.id));
  requireThresholdContainer(templates, input.thresholds);
  const frequencies = validateFrequencyReport(input.frequencies);
  const budget = input.budgetPerTenThousand ?? 1;
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error("budgetPerTenThousand must be a finite non-negative number");
  }

  const decisions = frequencies.map((frequency) =>
    initialDecision(frequency, templates, input.thresholds)
  );
  const selection = selectTier1Candidates(decisions, budget, input.diagnostics === true);
  for (const decisionIndex of selection.selected) {
    const decision = decisions[decisionIndex]!;
    decision.disposition = "discard";
    decision.riskTier = "tier1";
    decision.reason = "tier1-budget-selected";
  }

  const discarded = decisions.filter((decision) => decision.disposition === "discard");
  const observedDiscardCount = discarded.reduce((sum, decision) => sum + decision.count, 0);
  const expectedMissesPerTenThousand = discarded.reduce(
    (sum, decision) => sum + (decision.riskTier === "tier1"
      ? decision.riskPerTenThousand ?? 0
      : 0),
    0
  );
  if (expectedMissesPerTenThousand > budget + BUDGET_EPSILON) {
    throw new Error("Tier 1 selection exceeded its expected-miss budget");
  }

  return {
    sampleSize: input.frequencies.sampleSize,
    biasNotice: FREQUENCY_BIAS_NOTICE,
    budgetPerTenThousand: budget,
    expectedMissesPerTenThousand,
    observedDiscardCount,
    observedDiscardCoverage: input.frequencies.sampleSize === 0
      ? null
      : observedDiscardCount / input.frequencies.sampleSize,
    tier0DiscardedCategoryCount: discarded.filter((decision) => decision.riskTier === "tier0").length,
    tier1DiscardedCategoryCount: discarded.filter((decision) => decision.riskTier === "tier1").length,
    categories: decisions,
    ...(input.diagnostics === true ? { tier1SelectionDiagnostics: selection.diagnostics } : {})
  };
}
