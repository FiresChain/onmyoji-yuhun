import { SUB_STAT_MAX_ROLLS } from "./mappings.js";
import type { StatId } from "./types.js";

export interface TargetRollInput {
  targetPresent: boolean;
  initialCount: 1 | 2 | 3 | 4;
  events?: number;
}

export interface TargetRollState {
  targetRolls: number;
  otherRolls: readonly number[];
  probability: number;
}

export interface TargetRollOutcome {
  rolls: number;
  probability: number;
}

interface MutableTargetRollState {
  targetRolls: number;
  otherRolls: number[];
  probability: number;
}

const SUB_STAT_COUNT = 11;
const MAX_UPGRADE_EVENTS = 5;
const MAX_TOTAL_ROLLS = 6;

function prepareInput(input: TargetRollInput): Required<TargetRollInput> {
  if (typeof input.targetPresent !== "boolean") {
    throw new Error("targetPresent must be a boolean");
  }
  if (!Number.isInteger(input.initialCount) || input.initialCount < 1 || input.initialCount > 4) {
    throw new Error("initialCount must be an integer from 1 to 4");
  }

  const events = input.events ?? MAX_UPGRADE_EVENTS;
  if (!Number.isInteger(events) || events < 0 || events > MAX_UPGRADE_EVENTS) {
    throw new Error(`events must be an integer from 0 to ${MAX_UPGRADE_EVENTS}`);
  }
  return { ...input, events };
}

function canonicalOtherRolls(otherRolls: readonly number[]): number[] {
  return [...otherRolls].sort((left, right) => right - left);
}

function stateKey(targetRolls: number, otherRolls: readonly number[]): string {
  return `${targetRolls}|${otherRolls.join(",")}`;
}

function addState(
  states: Map<string, MutableTargetRollState>,
  targetRolls: number,
  rawOtherRolls: readonly number[],
  probability: number
): void {
  if (probability === 0) return;
  const otherRolls = canonicalOtherRolls(rawOtherRolls);
  const key = stateKey(targetRolls, otherRolls);
  const existing = states.get(key);
  if (existing === undefined) {
    states.set(key, { targetRolls, otherRolls, probability });
  } else {
    existing.probability += probability;
  }
}

function countMultiplicities(values: readonly number[]): Map<number, number> {
  const result = new Map<number, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function incrementOneOther(otherRolls: readonly number[], currentRolls: number): number[] {
  const result = [...otherRolls];
  const index = result.indexOf(currentRolls);
  if (index < 0) throw new Error("Internal target-roll state is inconsistent");
  result[index] = currentRolls + 1;
  return result;
}

function compareStates(left: TargetRollState, right: TargetRollState): number {
  if (left.targetRolls !== right.targetRolls) return left.targetRolls - right.targetRolls;
  for (let index = 0; index < Math.max(left.otherRolls.length, right.otherRolls.length); index += 1) {
    const difference = (right.otherRolls[index] ?? -1) - (left.otherRolls[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Enumerate the exact symmetry-compressed state distribution after all requested events. */
export function enumerateTargetRollStates(rawInput: TargetRollInput): TargetRollState[] {
  const input = prepareInput(rawInput);
  const initialTargetRolls = input.targetPresent ? 1 : 0;
  const initialOtherRolls = Array.from(
    { length: input.initialCount - (input.targetPresent ? 1 : 0) },
    () => 1
  );
  let states = new Map<string, MutableTargetRollState>();
  addState(states, initialTargetRolls, initialOtherRolls, 1);

  for (let event = 0; event < input.events; event += 1) {
    const nextStates = new Map<string, MutableTargetRollState>();
    for (const state of states.values()) {
      const targetCount = state.targetRolls > 0 ? 1 : 0;
      const distinctCount = targetCount + state.otherRolls.length;
      const multiplicities = countMultiplicities(state.otherRolls);

      if (distinctCount < 4) {
        addState(
          nextStates,
          state.targetRolls > 0 ? state.targetRolls + 1 : 1,
          state.otherRolls,
          state.probability / SUB_STAT_COUNT
        );

        for (const [rolls, multiplicity] of multiplicities) {
          addState(
            nextStates,
            state.targetRolls,
            incrementOneOther(state.otherRolls, rolls),
            state.probability * multiplicity / SUB_STAT_COUNT
          );
        }

        const unseenOtherCount = input.targetPresent || state.targetRolls > 0
          ? SUB_STAT_COUNT - distinctCount
          : SUB_STAT_COUNT - distinctCount - 1;
        if (unseenOtherCount > 0) {
          addState(
            nextStates,
            state.targetRolls,
            [...state.otherRolls, 1],
            state.probability * unseenOtherCount / SUB_STAT_COUNT
          );
        }
      } else if (distinctCount === 4) {
        const totalRolls = state.targetRolls + state.otherRolls.reduce(
          (total, rolls) => total + rolls,
          0
        );
        if (state.targetRolls > 0) {
          addState(
            nextStates,
            state.targetRolls + 1,
            state.otherRolls,
            state.probability * state.targetRolls / totalRolls
          );
        }
        for (const [rolls, multiplicity] of multiplicities) {
          addState(
            nextStates,
            state.targetRolls,
            incrementOneOther(state.otherRolls, rolls),
            state.probability * rolls * multiplicity / totalRolls
          );
        }
      } else {
        throw new Error("Internal target-roll state contains more than four sub-stats");
      }
    }
    states = nextStates;
  }

  return [...states.values()]
    .map((state) => ({
      targetRolls: state.targetRolls,
      otherRolls: [...state.otherRolls],
      probability: state.probability
    }))
    .sort(compareStates);
}

/** Return the marginal distribution of the target stat's final roll count. */
export function enumerateTargetRolls(input: TargetRollInput): TargetRollOutcome[] {
  const probabilities = new Map<number, number>();
  for (const state of enumerateTargetRollStates(input)) {
    probabilities.set(
      state.targetRolls,
      (probabilities.get(state.targetRolls) ?? 0) + state.probability
    );
  }
  return [...probabilities]
    .sort(([left], [right]) => left - right)
    .map(([rolls, probability]) => ({ rolls, probability }));
}

function factorial(value: number): number {
  let result = 1;
  for (let factor = 2; factor <= value; factor += 1) result *= factor;
  return result;
}

function binomial(total: number, selected: number): number {
  return factorial(total) / (factorial(selected) * factorial(total - selected));
}

function irwinHallCdf(rolls: number, value: number): number {
  if (value <= 0) return 0;
  if (value >= rolls) return 1;

  let sum = 0;
  for (let index = 0; index <= Math.floor(value); index += 1) {
    const sign = index % 2 === 0 ? 1 : -1;
    sum += sign * binomial(rolls, index) * (value - index) ** rolls;
  }
  return sum / factorial(rolls);
}

function irwinHallTail(rolls: number, value: number): number {
  if (value <= 0) return 1;
  if (value >= rolls) return 0;
  // The Irwin-Hall distribution is symmetric; reflecting the upper tail avoids
  // subtracting two nearly equal numbers close to the maximum.
  return value > rolls / 2
    ? irwinHallCdf(rolls, rolls - value)
    : 1 - irwinHallCdf(rolls, value);
}

/** Exact tail probability for the sum of uniformly distributed numeric roll values. */
export function growthTailProbability(stat: StatId, rolls: number, minTotal: number): number {
  const maxRoll = SUB_STAT_MAX_ROLLS[stat];
  if (typeof maxRoll !== "number") throw new Error(`Unknown yuhun stat: ${String(stat)}`);
  if (!Number.isInteger(rolls) || rolls < 0 || rolls > MAX_TOTAL_ROLLS) {
    throw new Error(`rolls must be an integer from 0 to ${MAX_TOTAL_ROLLS}`);
  }
  if (!Number.isFinite(minTotal)) throw new Error("minTotal must be a finite number");

  if (rolls === 0) return minTotal <= 0 ? 1 : 0;

  const minimum = 0.8 * rolls * maxRoll;
  const maximum = rolls * maxRoll;
  if (minTotal <= minimum) return 1;
  if (minTotal >= maximum) return 0;

  const normalized = (minTotal / maxRoll - 0.8 * rolls) / 0.2;
  const tail = irwinHallTail(rolls, normalized);
  return Math.max(0, Math.min(1, tail));
}
