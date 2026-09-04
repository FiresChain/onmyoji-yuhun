import { STAT_LABELS } from "./mappings.js";
import type { StatId } from "./types.js";

export type UpgradeSelectionModel = "uniform" | "reinforcementWeighted";

export interface UpgradeSelectionInput {
  /** The four distinct sub-stats currently present on the yuhun. */
  subStats: readonly StatId[];
  /** Number of future +3 upgrade selections to evaluate. */
  rolls: number;
  /** Rule used to select an existing sub-stat. */
  model: UpgradeSelectionModel;
  /** Existing rattr occurrence counts. Defaults to one occurrence per sub-stat. */
  initialWeights?: Partial<Record<StatId, number>>;
}

export interface UpgradeSelectionOutcome {
  /** Number of future selections received by each of the four sub-stats. */
  addedRolls: Partial<Record<StatId, number>>;
  /** rattr occurrence counts after all future selections. */
  finalWeights: Partial<Record<StatId, number>>;
  probability: number;
}

interface PreparedInput {
  stats: readonly [StatId, StatId, StatId, StatId];
  initialWeights: readonly [number, number, number, number];
  rolls: number;
  model: UpgradeSelectionModel;
}

interface DistributionState {
  counts: readonly number[];
  probability: number;
}

const KNOWN_STATS = new Set<StatId>(Object.keys(STAT_LABELS) as StatId[]);
const MAX_ENUMERATED_ROLLS = 30;

function prepareInput(input: UpgradeSelectionInput): PreparedInput {
  if (input.subStats.length !== 4) {
    throw new Error("Upgrade selection currently requires exactly four sub-stats");
  }

  const stats = input.subStats as [StatId, StatId, StatId, StatId];
  if (new Set(stats).size !== stats.length) {
    throw new Error("Upgrade selection requires four distinct sub-stats");
  }
  for (const stat of stats) {
    if (!KNOWN_STATS.has(stat)) throw new Error(`Unknown yuhun stat: ${stat}`);
  }

  if (!Number.isInteger(input.rolls) || input.rolls < 0 || input.rolls > MAX_ENUMERATED_ROLLS) {
    throw new Error(`rolls must be an integer from 0 to ${MAX_ENUMERATED_ROLLS}`);
  }
  if (input.model !== "uniform" && input.model !== "reinforcementWeighted") {
    throw new Error(`Unknown upgrade selection model: ${String(input.model)}`);
  }

  const selectedStats = new Set<StatId>(stats);
  for (const stat of Object.keys(input.initialWeights ?? {}) as StatId[]) {
    if (!selectedStats.has(stat)) {
      throw new Error(`initialWeights contains a stat not present on the yuhun: ${stat}`);
    }
  }

  const initialWeights = stats.map((stat) => input.initialWeights?.[stat] ?? 1);
  for (const weight of initialWeights) {
    if (!Number.isInteger(weight) || weight < 1) {
      throw new Error("Every initial weight must be a positive integer rattr occurrence count");
    }
  }

  return {
    stats,
    initialWeights: initialWeights as [number, number, number, number],
    rolls: input.rolls,
    model: input.model
  };
}

function selectionProbability(
  input: PreparedInput,
  addedCounts: readonly number[],
  statIndex: number,
  completedRolls: number
): number {
  if (input.model === "uniform") return 1 / input.stats.length;

  const initialTotal = input.initialWeights.reduce((total, weight) => total + weight, 0);
  return (input.initialWeights[statIndex]! + addedCounts[statIndex]!) /
    (initialTotal + completedRolls);
}

function countsKey(counts: readonly number[]): string {
  return counts.join(",");
}

function countsRecord(
  stats: PreparedInput["stats"],
  counts: readonly number[]
): Partial<Record<StatId, number>> {
  return Object.fromEntries(stats.map((stat, index) => [stat, counts[index]!])) as Partial<
    Record<StatId, number>
  >;
}

/**
 * Enumerate the exact sub-stat selection distribution for a four-sub-stat yuhun.
 * This models which attribute is selected, but not the numeric value of each roll.
 */
export function enumerateUpgradeOutcomes(
  rawInput: UpgradeSelectionInput
): UpgradeSelectionOutcome[] {
  const input = prepareInput(rawInput);
  let states = new Map<string, DistributionState>([
    [countsKey([0, 0, 0, 0]), { counts: [0, 0, 0, 0], probability: 1 }]
  ]);

  for (let completedRolls = 0; completedRolls < input.rolls; completedRolls += 1) {
    const nextStates = new Map<string, DistributionState>();
    for (const state of states.values()) {
      for (let statIndex = 0; statIndex < input.stats.length; statIndex += 1) {
        const counts = [...state.counts];
        counts[statIndex] = counts[statIndex]! + 1;
        const probability = state.probability * selectionProbability(
          input,
          state.counts,
          statIndex,
          completedRolls
        );
        const key = countsKey(counts);
        const existing = nextStates.get(key);
        nextStates.set(key, {
          counts,
          probability: probability + (existing?.probability ?? 0)
        });
      }
    }
    states = nextStates;
  }

  return [...states.values()].map((state) => ({
    addedRolls: countsRecord(input.stats, state.counts),
    finalWeights: countsRecord(
      input.stats,
      state.counts.map((count, index) => count + input.initialWeights[index]!)
    ),
    probability: state.probability
  }));
}

/** Sum the exact probability of all enumerated outcomes accepted by a predicate. */
export function calculateUpgradeProbability(
  input: UpgradeSelectionInput,
  matches: (outcome: UpgradeSelectionOutcome) => boolean
): number {
  return enumerateUpgradeOutcomes(input).reduce(
    (probability, outcome) => probability + (matches(outcome) ? outcome.probability : 0),
    0
  );
}

/** Simulate one sequence. Inject `random` to make callers and tests deterministic. */
export function simulateUpgradeSelections(
  rawInput: UpgradeSelectionInput,
  random: () => number = Math.random
): StatId[] {
  const input = prepareInput(rawInput);
  const counts = [0, 0, 0, 0];
  const selections: StatId[] = [];

  for (let completedRolls = 0; completedRolls < input.rolls; completedRolls += 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new Error("random must return a finite number in the range [0, 1)");
    }

    let cumulative = 0;
    let selectedIndex = input.stats.length - 1;
    for (let statIndex = 0; statIndex < input.stats.length; statIndex += 1) {
      cumulative += selectionProbability(input, counts, statIndex, completedRolls);
      if (value < cumulative) {
        selectedIndex = statIndex;
        break;
      }
    }

    counts[selectedIndex] = counts[selectedIndex]! + 1;
    selections.push(input.stats[selectedIndex]!);
  }

  return selections;
}
