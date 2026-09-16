import { canonicalYuhunName, STAT_LABELS } from "./mappings.js";
import { compileFilterCriteria } from "./matcher.js";
import type { FilterCriteria, IntrinsicStatId, StatId, SubStatCount } from "./types.js";
import type { YyxYuhun } from "./yyx.js";

const GROUP_LIMIT = 60;
const STATS = Object.keys(STAT_LABELS) as StatId[];
const baseCriteria = (): FilterCriteria => ({
  types: [], positions: [], stars: [6], levelRanges: ["0-2"], mainStats: [],
  subStats: [], subStatCounts: [], intrinsicStats: [], unknownTypeBits: [], unknownOptionBits: []
});

interface Rule {
  readonly criteria: FilterCriteria;
  readonly matches: bigint;
  readonly complexity: number;
}

interface Selection {
  readonly rules: readonly Rule[];
  readonly matches: bigint;
  readonly count: number;
}

interface Solution {
  readonly discard: Selection;
  readonly rescue: Selection;
}

function popcount(value: number): number {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function words(mask: bigint, length: number): Uint32Array {
  const result = new Uint32Array(length);
  const hex = mask.toString(16);
  for (let end = hex.length, i = 0; end > 0; end -= 8, i++) {
    result[i] = Number.parseInt(hex.slice(Math.max(0, end - 8), end), 16);
  }
  return result;
}

function selectRules(candidates: readonly Rule[], target: bigint, quota = Infinity): Selection {
  const length = Math.ceil(target.toString(16).length / 8);
  const uncovered = words(target, length);
  const remaining = candidates.map(rule => ({ rule, coverage: words(rule.matches & target, length) }));
  const rules: Rule[] = [];
  let matches = 0n, total = 0;
  while (rules.length < GROUP_LIMIT && total < quota) {
    let bestIndex = -1, bestGain = 0;
    const required = quota - total;
    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]!;
      let gain = 0;
      for (let j = 0; j < length; j++) gain += popcount(candidate.coverage[j]! & uncovered[j]!);
      if (gain === 0) continue;
      const finishes = gain >= required, bestFinishes = bestGain >= required;
      const betterGain = finishes === bestFinishes
        ? (finishes ? gain < bestGain : gain > bestGain)
        : finishes;
      if (bestIndex < 0 || betterGain || (gain === bestGain && candidate.rule.complexity < remaining[bestIndex]!.rule.complexity)) {
        bestIndex = i;
        bestGain = gain;
      }
    }
    if (bestIndex < 0) break;
    const selected = remaining.splice(bestIndex, 1)[0]!;
    rules.push(selected.rule);
    matches |= selected.rule.matches;
    total += bestGain;
    for (let j = 0; j < length; j++) uncovered[j] = uncovered[j]! & ~selected.coverage[j]!;
  }
  return { rules, matches, count: total };
}

function prefer(a: Solution, b: Solution, quota: number): Solution {
  const reachedA = a.discard.count >= quota, reachedB = b.discard.count >= quota;
  if (reachedA !== reachedB) return reachedA ? a : b;
  const imports = (s: Solution) => Number(s.discard.rules.length > 0) + Number(s.rescue.rules.length > 0);
  if (reachedA && imports(a) !== imports(b)) return imports(a) < imports(b) ? a : b;
  if (a.discard.count !== b.discard.count) {
    return (reachedA ? a.discard.count < b.discard.count : a.discard.count > b.discard.count) ? a : b;
  }
  if (imports(a) !== imports(b)) return imports(a) < imports(b) ? a : b;
  return a.discard.rules.length + a.rescue.rules.length <= b.discard.rules.length + b.rescue.rules.length ? a : b;
}

/** Bounded snapshot-only search; every atomic condition uses the preview matcher. */
export function optimizeDecisionRules(items: readonly YyxYuhun[], discardIds: ReadonlySet<string>, quota: number): {
  discard: FilterCriteria[];
  rescue: FilterCriteria[];
  cellCount: number;
} {
  const domain = items.filter(item => !item.lock && item.star === 6 && item.level <= 2);
  const universe = (1n << BigInt(domain.length)) - 1n;
  let targets = 0n, protectedItems = 0n, historical = 0n;
  const atoms: Rule[] = [];
  const atomIds = new Map<string, number>();
  const seeds = new Map<string, { ids: number[]; members: bigint }>();
  const atom = (criteria: FilterCriteria): number => {
    const key = JSON.stringify(criteria);
    const existing = atomIds.get(key);
    if (existing !== undefined) return existing;
    const predicate = compileFilterCriteria(criteria);
    let matches = 0n;
    for (let i = 0; i < domain.length; i++) if (predicate(domain[i]!)) matches |= 1n << BigInt(i);
    const id = atoms.length;
    atoms.push({ criteria, matches, complexity: 1 });
    atomIds.set(key, id);
    return id;
  };
  for (let i = 0; i < domain.length; i++) {
    const item = domain[i]!, bit = 1n << BigInt(i);
    if (item.garbage) historical |= bit;
    else if (item.level === 0 && discardIds.has(item.id)) targets |= bit;
    else protectedItems |= bit;
    const subCount = Object.keys(item.subStats).length;
    const parts: FilterCriteria[] = [
      { ...baseCriteria(), types: [canonicalYuhunName(item.name)] },
      { ...baseCriteria(), positions: [item.position] },
      { ...baseCriteria(), mainStats: [item.mainStat] },
      ...STATS.map(stat => ({ ...baseCriteria(), subStats: [{ stat, requirement: Object.hasOwn(item.subStats, stat) ? "include" as const : "exclude" as const }] }))
    ];
    if (subCount <= 4) parts.push({ ...baseCriteria(), subStatCounts: [subCount < 2 ? "lessThan2" : String(subCount) as SubStatCount] });
    if (Object.keys(item.intrinsicStats).length) parts.push({ ...baseCriteria(), intrinsicStats: Object.keys(item.intrinsicStats).sort() as IntrinsicStatId[] });
    const key = JSON.stringify(parts);
    const existing = seeds.get(key);
    if (existing) existing.members |= bit;
    else seeds.set(key, { ids: parts.map(atom), members: bit });
  }
  const intersect = (ids: readonly number[]): bigint => ids.reduce((mask, id) => mask & atoms[id]!.matches, universe);
  const rule = (ids: readonly number[], matches: bigint): Rule => {
    const criteria = baseCriteria();
    for (const id of ids) {
      const part = atoms[id]!.criteria;
      criteria.types.push(...part.types);
      criteria.positions.push(...part.positions);
      criteria.mainStats.push(...part.mainStats);
      criteria.subStats.push(...part.subStats);
      criteria.subStatCounts.push(...part.subStatCounts);
      criteria.intrinsicStats.push(...part.intrinsicStats);
    }
    return { criteria, matches, complexity: ids.length };
  };
  const search = (wanted: bigint, forbidden: bigint) => {
    const exact = new Map<bigint, Rule>(), merged = new Map<bigint, Rule>();
    const add = (map: Map<bigint, Rule>, ids: readonly number[], matches: bigint) => {
      const previous = map.get(matches);
      if (!previous || previous.complexity > ids.length) map.set(matches, rule(ids, matches));
    };
    for (const [, seed] of [...seeds].sort(([a], [b]) => a.localeCompare(b))) {
      if (!(seed.members & wanted)) continue;
      const initial = intersect(seed.ids);
      if (initial & forbidden) continue;
      add(exact, seed.ids, initial);
      add(merged, seed.ids, initial);
      // Opposite elimination orders retain different useful generalizations.
      // Each removal checks all blockers, including the game's +1/+2 level band.
      for (const order of [seed.ids, [...seed.ids].reverse()]) {
        let ids = [...seed.ids], matches = initial;
        for (const removed of order) {
          const next = ids.filter(id => id !== removed), widened = intersect(next);
          if (widened & forbidden) continue;
          ids = next;
          matches = widened;
        }
        add(merged, ids, matches);
      }
    }
    return { exact: [...exact.values()], merged: [...merged.values()] };
  };
  const empty: Selection = { rules: [], matches: 0n, count: 0 };
  if (!targets || quota === 0) return { discard: [], rescue: [], cellCount: seeds.size };
  const safe = search(targets, protectedItems);
  // A target indistinguishable from a retained item cannot be discarded by
  // either code. Allow E to protect that entire conflicting class as well.
  const separable = safe.exact.reduce((mask, rule) => mask | rule.matches, 0n) & targets;
  protectedItems |= targets & ~separable;
  targets = separable;
  let best = prefer(
    { discard: selectRules(safe.exact, targets, quota), rescue: empty },
    { discard: selectRules(safe.merged, targets, quota), rescue: empty },
    quota
  );
  if (best.discard.count < quota && (targets & ~best.discard.matches) !== 0n && protectedItems) {
    // E cannot match a target or any previous discard. D may then expand only
    // into the retained region covered by those independently safe E rules.
    const rescue = selectRules(search(protectedItems, targets | historical).merged, protectedItems);
    if (rescue.matches) {
      const expanded = search(targets, protectedItems & ~rescue.matches);
      const discard = selectRules(expanded.merged, targets, quota);
      const needed = discard.matches & protectedItems;
      const prunedRescue = selectRules(rescue.rules, needed);
      if ((needed & ~prunedRescue.matches) === 0n) best = prefer(best, { discard, rescue: prunedRescue }, quota);
    }
  }
  return {
    discard: best.discard.rules.map(rule => rule.criteria),
    rescue: best.rescue.rules.map(rule => rule.criteria),
    cellCount: seeds.size
  };
}
