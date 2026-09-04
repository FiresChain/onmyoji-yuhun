import { SUB_STAT_MAX_ROLLS } from "./mappings.js";
import type { Yuhun } from "./calculation.js";
import type { StatId } from "./types.js";

/** Strategies exposed in the single-yuhun decision explanation. */
export type YuhunPotentialStrategy = "candidate-build" | "embryo-comparison" | "upgrade-upper-bound";

export interface MaximumUpgradeState {
  readonly subStats: Partial<Record<StatId, number>>;
}

const SUB_STATS = Object.keys(SUB_STAT_MAX_ROLLS) as StatId[];

function stateKey(subStats: Partial<Record<StatId, number>>): string {
  return SUB_STATS.map((stat) => `${stat}:${subStats[stat] ?? 0}`).join("|");
}

/** Number of +3 events strictly above the current level. */
export function remainingUpgradeRolls(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, 5 - Math.floor(Math.max(0, Math.min(15, level)) / 3));
}

/**
 * Enumerate unique states reached by assigning every remaining upgrade to a
 * legal sub-stat at its maximum roll. This is a deterministic upper-bound
 * calculation, not a random +15 simulation.
 */
export function enumerateMaximumUpgradeStates(
  item: Pick<Yuhun, "level" | "subStats">,
  rolls = remainingUpgradeRolls(item.level)
): readonly MaximumUpgradeState[] {
  let states = new Map<string, MaximumUpgradeState>();
  const initial: Partial<Record<StatId, number>> = { ...item.subStats };
  states.set(stateKey(initial), { subStats: initial });

  for (let completed = 0; completed < rolls; completed += 1) {
    const next = new Map<string, MaximumUpgradeState>();
    for (const state of states.values()) {
      const present = new Set(Object.keys(state.subStats) as StatId[]);
      const allowed = present.size >= 4 ? [...present] : SUB_STATS;
      for (const stat of allowed) {
        const value = (state.subStats[stat] ?? 0) + SUB_STAT_MAX_ROLLS[stat];
        const subStats = { ...state.subStats, [stat]: value };
        const key = stateKey(subStats);
        if (!next.has(key)) next.set(key, { subStats });
      }
    }
    states = next;
  }
  return [...states.values()];
}

export function initialSubStatsForComparison(
  item: Pick<Yuhun, "level" | "subStats"> & { initialSubStats?: Partial<Record<StatId, number>> | null }
): Partial<Record<StatId, number>> | null {
  if (item.initialSubStats !== undefined && item.initialSubStats !== null) {
    return { ...item.initialSubStats };
  }
  // Once four sub-stats exist, later upgrades cannot add a new stat, so the
  // current stat names are also the embryo's stat names. Values are not
  // reversible without the enhancement history and are intentionally omitted.
  if (Object.keys(item.subStats).length === 4) {
    return Object.fromEntries(Object.keys(item.subStats).map((stat) => [stat, 0])) as Partial<Record<StatId, number>>;
  }
  return null;
}
