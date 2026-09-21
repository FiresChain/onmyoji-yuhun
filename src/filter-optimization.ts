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

function bitCount(mask: bigint): number {
  return [...words(mask, Math.ceil(mask.toString(16).length / 8))].reduce((sum, word) => sum + popcount(word), 0);
}

function prepareBudgetCandidates(candidates: readonly Rule[], targets: bigint, affected: bigint) {
  const length = Math.ceil((targets | affected).toString(16).length / 8);
  const sparse = (mask: bigint) => {
    const result: { value: number; index: number }[] = [];
    const hex = mask.toString(16);
    for (let end = hex.length, index = 0; end > 0; end -= 8, index++) {
      const value = Number.parseInt(hex.slice(Math.max(0, end - 8), end), 16);
      if (value) result.push({ value, index });
    }
    return result;
  };
  return {
    targets: words(targets, length), affected: words(affected, length),
    rules: candidates.map(rule => ({ rule, good: sparse(rule.matches & targets), loss: sparse(rule.matches & affected) }))
  };
}

/** Counts the union of final affected retain items, never per-rule duplicate hits. */
function selectWithBudget(prepared: ReturnType<typeof prepareBudgetCandidates>, budget: number, quota: number, penalty: number): Selection {
  const uncovered = prepared.targets.slice(), unspent = prepared.affected.slice();
  const remaining = [...prepared.rules];
  const rules: Rule[] = [];
  let matches = 0n, total = 0, spent = 0;
  while (rules.length < GROUP_LIMIT && total < quota) {
    let best = -1, bestGood = 0, bestLoss = 0, bestScore = -1;
    for (let i = 0; i < remaining.length; i++) {
      const entry = remaining[i]!;
      let good = 0, loss = 0;
      for (const word of entry.good) good += popcount(word.value & uncovered[word.index]!);
      for (const word of entry.loss) loss += popcount(word.value & unspent[word.index]!);
      if (!good || spent + loss > budget) continue;
      const finishes = total + good + loss >= quota;
      const bestFinishes = best >= 0 && total + bestGood + bestLoss >= quota;
      const score = good / (1 + penalty * loss);
      const better = finishes !== bestFinishes ? finishes : finishes
        ? loss < bestLoss || (loss === bestLoss && good < bestGood)
        : score > bestScore || (score === bestScore && loss < bestLoss);
      if (best < 0 || better) { best = i; bestGood = good; bestLoss = loss; bestScore = score; }
    }
    if (best < 0) break;
    const entry = remaining.splice(best, 1)[0]!;
    rules.push(entry.rule);
    matches |= entry.rule.matches;
    total += bestGood + bestLoss;
    spent += bestLoss;
    for (const word of entry.good) uncovered[word.index] = uncovered[word.index]! & ~word.value;
    for (const word of entry.loss) unspent[word.index] = unspent[word.index]! & ~word.value;
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
export function optimizeDecisionRules(items: readonly YyxYuhun[], discardIds: ReadonlySet<string>, quota: number, impactIds: ReadonlySet<string> = new Set(), impactBudget = 0): {
  discard: FilterCriteria[];
  rescue: FilterCriteria[];
  cellCount: number;
} {
  const domain = items.filter(item => !item.lock && item.star === 6 && item.level <= 2);
  const universe = (1n << BigInt(domain.length)) - 1n;
  let targets = 0n, protectedItems = 0n, historical = 0n, soft = 0n;
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
    else {
      protectedItems |= bit;
      if (item.level === 0 && impactIds.has(item.id)) soft |= bit;
    }
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
  const search = (wanted: bigint, forbidden: bigint, affected = 0n, budget = 0) => {
    const valid = (matches: bigint) => !(matches & forbidden) && (!affected || bitCount(matches & affected) <= budget);
    const exact = new Map<bigint, Rule>(), merged = new Map<bigint, Rule>();
    const add = (map: Map<bigint, Rule>, ids: readonly number[], matches: bigint) => {
      const previous = map.get(matches);
      if (!previous || previous.complexity > ids.length) map.set(matches, rule(ids, matches));
    };
    for (const [, seed] of [...seeds].sort(([a], [b]) => a.localeCompare(b))) {
      if (!(seed.members & wanted)) continue;
      const initial = intersect(seed.ids);
      if (!valid(initial)) continue;
      add(exact, seed.ids, initial);
      add(merged, seed.ids, initial);
      // Opposite elimination orders retain different useful generalizations.
      // Each removal checks all blockers, including the game's +1/+2 level band.
      for (const order of [seed.ids, [...seed.ids].reverse()]) {
        let ids = [...seed.ids], matches = initial;
        for (const removed of order) {
          const next = ids.filter(id => id !== removed), widened = intersect(next);
          if (!valid(widened)) continue;
          ids = next;
          matches = widened;
          if (affected) add(merged, ids, matches);
        }
        add(merged, ids, matches);
      }
    }
    return { exact: [...exact.values()], merged: [...merged.values()] };
  };
  const empty: Selection = { rules: [], matches: 0n, count: 0 };
  if (!targets || quota === 0) return { discard: [], rescue: [], cellCount: seeds.size };
  const originalTargets = targets, originalProtected = protectedItems;
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
  if (best.discard.count < quota && impactBudget > 0 && soft) {
    // Start with the zero-impact result; relaxation must improve it. E never
    // restores historical discards. Previously inseparable target classes
    // rescued by the zero-impact solution are excluded from release counts.
    const hard = originalProtected & ~soft;
    const rescue = selectRules(search(originalProtected, originalTargets | historical).merged, originalProtected);
    const loss = (solution: Solution) => bitCount(solution.discard.matches & ~solution.rescue.matches & soft);
    const consider = (candidate: Solution) => {
      const reached = candidate.discard.count >= quota, bestReached = best.discard.count >= quota;
      if (reached !== bestReached ? reached : reached
        ? loss(candidate) < loss(best) || (loss(candidate) === loss(best) && candidate.discard.count < best.discard.count)
        : candidate.discard.count > best.discard.count || (candidate.discard.count === best.discard.count && loss(candidate) < loss(best))) best = candidate;
    };
    const protections = new Map([empty, best.rescue, rescue].map(protection => [protection.matches, protection]));
    for (const protection of protections.values()) {
      const affected = soft & ~protection.matches;
      const releasableTargets = originalTargets & ~protection.matches;
      const candidatesByMask = new Map<bigint, Rule>();
      // Preserve the zero-impact generalizations too: relaxed elimination can
      // take a different path and otherwise lose these efficient safe rules.
      for (const candidate of [
        ...search(releasableTargets, originalProtected & ~protection.matches).merged,
        ...search(releasableTargets, hard & ~protection.matches, affected, impactBudget).merged
      ]) {
        const previous = candidatesByMask.get(candidate.matches);
        if (!previous || previous.complexity > candidate.complexity) candidatesByMask.set(candidate.matches, candidate);
      }
      const candidates = prepareBudgetCandidates([...candidatesByMask.values()], releasableTargets, affected);
      for (const penalty of [0, 0.1, 0.5, 2]) {
        const trials = new Map<number, Solution>();
        const trial = (budget: number): Solution => {
          const previous = trials.get(budget);
          if (previous) return previous;
          const discard = selectWithBudget(candidates, budget, quota, penalty);
          const needed = discard.matches & protection.matches & (originalProtected | originalTargets);
          const pruned = selectRules(protection.rules, needed);
          const candidate = (needed & ~pruned.matches) === 0n ? { discard, rescue: pruned } : { discard: empty, rescue: empty };
          trials.set(budget, candidate);
          consider(candidate);
          return candidate;
        };
        for (const budget of [...new Set([Math.max(1, Math.floor(impactBudget / 4)), Math.max(1, Math.floor(impactBudget / 2)), impactBudget])]) trial(budget);
        // Once a trial reaches the quota, try smaller budgets as well. This
        // refines the bounded heuristic; it is not a global optimality proof.
        const reached = [...trials.values()].filter(candidate => candidate.discard.count >= quota);
        if (reached.length) {
          let lower = 0, upper = Math.min(...reached.map(loss));
          for (let iteration = 0; lower < upper && iteration < 8; iteration++) {
            const middle = Math.floor((lower + upper) / 2);
            const candidate = trial(middle);
            if (candidate.discard.count >= quota) upper = Math.min(middle, loss(candidate));
            else lower = middle + 1;
          }
        }
      }
    }
  }
  return {
    discard: best.discard.rules.map(rule => rule.criteria),
    rescue: best.rescue.rules.map(rule => rule.criteria),
    cellCount: seeds.size
  };
}
