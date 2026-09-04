import {
  SIX_STAR_SPEED_MAIN_STAT_MAX,
  SPEED_MAIN_STAT_POSITIONS,
  SUB_STAT_MAX_ROLLS,
  YUHUN_POSITIONS
} from "./mappings.js";
import type { YuhunPosition } from "./mappings.js";
import { enumerateTargetRolls, growthTailProbability } from "./potential.js";

export type InitialSubStatCount = 1 | 2 | 3 | 4;

export interface SpeedCategory {
  position: YuhunPosition;
  mainStatIsSpeed: boolean;
  initialCount: InitialSubStatCount;
  initialSpeedPresent: boolean;
}

const INITIAL_COUNTS = [1, 2, 3, 4] as const;

function validateCategory(category: SpeedCategory): void {
  if (!YUHUN_POSITIONS.includes(category.position)) {
    throw new Error(`Invalid yuhun position: ${String(category.position)}`);
  }
  if (!INITIAL_COUNTS.includes(category.initialCount)) {
    throw new Error(`Invalid initial sub-stat count: ${String(category.initialCount)}`);
  }
  if (typeof category.mainStatIsSpeed !== "boolean" ||
      typeof category.initialSpeedPresent !== "boolean") {
    throw new Error("Speed category flags must be boolean");
  }
  if (category.mainStatIsSpeed && !SPEED_MAIN_STAT_POSITIONS.includes(category.position)) {
    throw new Error(`Speed is not a valid main stat at position ${category.position}`);
  }
}

function mainStatContribution(category: SpeedCategory): number {
  return category.mainStatIsSpeed ? SIX_STAR_SPEED_MAIN_STAT_MAX : 0;
}

/** Enumerate the mutually exclusive six-star speed-axis category space. */
export function enumerateSpeedCategories(): SpeedCategory[] {
  const categories: SpeedCategory[] = [];
  for (const position of YUHUN_POSITIONS) {
    const mainStatOptions = SPEED_MAIN_STAT_POSITIONS.includes(position)
      ? [false, true]
      : [false];
    for (const mainStatIsSpeed of mainStatOptions) {
      for (const initialCount of INITIAL_COUNTS) {
        for (const initialSpeedPresent of [false, true]) {
          categories.push({ position, mainStatIsSpeed, initialCount, initialSpeedPresent });
        }
      }
    }
  }
  return categories;
}

/** Maximum final speed contribution, including a deterministic speed main stat when present. */
export function categoryUpperBound(category: SpeedCategory): number {
  validateCategory(category);
  const maximumRolls = category.initialSpeedPresent
    ? 6
    : category.initialCount < 4 ? 5 : 0;
  return mainStatContribution(category) + maximumRolls * SUB_STAT_MAX_ROLLS.speed;
}

/** Exact probability that a category reaches at least the requested sub-stat speed threshold. */
export function categoryReachProbability(category: SpeedCategory, threshold: number): number {
  validateCategory(category);
  if (!Number.isFinite(threshold)) throw new Error("threshold must be a finite number");

  const probability = enumerateTargetRolls({
    targetPresent: category.initialSpeedPresent,
    initialCount: category.initialCount
  }).reduce(
    (probability, outcome) => probability + outcome.probability * growthTailProbability(
      "speed",
      outcome.rolls,
      threshold
    ),
    0
  );
  return Math.max(0, Math.min(1, probability));
}
