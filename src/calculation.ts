import { SUB_STAT_MAX_ROLLS, TWO_PIECE_EFFECTS } from "./mappings.js";
import type { IntrinsicStatId, StatId } from "./types.js";

export interface HeroDataRecord {
  "式神名称": string;
  "攻生防属性成长值": {
    "攻击": number;
    "生命": number;
    "防御": number;
  };
  "固定属性基础面板": Partial<Record<"速度" | "暴击" | "暴击伤害" | "效果命中" | "效果抵抗", number>>;
}

export interface HeroDataFile {
  "式神数据": HeroDataRecord[];
}

export interface CbgYuhunItem {
  uuid: string;
  name: string;
  pos: number;
  level: number;
  qua: number;
  attrs: Array<[string, string]>;
  rattr?: Array<[string, number]>;
  single_attr?: [string, string];
  lock?: boolean;
  isuseless?: boolean;
  suitid?: number;
  born?: number;
  base_rindex?: number;
}

export interface CbgExport {
  equip_desc: string | { inventory: Record<string, CbgYuhunItem> };
}

export interface Yuhun {
  id: string;
  name: string;
  position: number;
  level: number;
  star: number;
  mainStat: StatId;
  mainValue: number;
  subStats: Partial<Record<StatId, number>>;
  intrinsicStats: Partial<Record<StatId, number>>;
}

export interface Panel {
  attack: number;
  hp: number;
  defense: number;
  speed: number;
  crit: number;
  critDamage: number;
  effectHit: number;
  effectResist: number;
}

export type PanelStatId = Exclude<StatId, "attackPercent" | "defensePercent" | "hpPercent">;
/** Registered score indicators. Derived indicators are calculated from the final panel. */
export type Indicator = "damageOutput" | "healing" | "hitResist" | "defenseOutput" | PanelStatId;

export interface ValueConstraint {
  min?: number;
  max?: number | undefined;
  maxExclusive?: number;
}

export interface OptimizeOptions {
  indicator?: Indicator;
  constraints?: Partial<Record<PanelStatId, ValueConstraint>>;
  /** Non-yuhun panel attributes, such as the four extra attributes in a team code. */
  bonusStats?: Readonly<Partial<Record<StatId, number>>>;
  requiredSets?: Record<string, number>;
  requiredSetGroups?: readonly {
    readonly names: readonly string[];
    readonly count: number;
    /** Boss souls with this intrinsic stat also satisfy the broad two-piece effect. */
    readonly intrinsicStat?: IntrinsicStatId;
  }[];
  topN?: number;
  maxCombinations?: number;
  beamWidth?: number;
  candidateLimitPerPosition?: number;
}

export interface YuhunBuildResult {
  yuhun: Yuhun[];
  panel: Panel;
  score: number;
}

export interface YuhunSearchResult {
  readonly results: readonly YuhunBuildResult[];
  readonly exact: boolean;
  readonly candidateCombinations: number;
  readonly evaluatedCombinations: number;
}

function roundScore(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const LEVEL_40_GROWTH = {
  attack: 2680,
  hp: 11392.970873786408,
  defense: 441
} as const;

const CBG_RATTR_STATS: Record<string, StatId> = {
  attackAdditionVal: "attack",
  maxHpAdditionVal: "hp",
  defenseAdditionVal: "defense",
  speedAdditionVal: "speed",
  attackAdditionRate: "attackPercent",
  maxHpAdditionRate: "hpPercent",
  defenseAdditionRate: "defensePercent",
  critRateAdditionVal: "crit",
  critPowerAdditionVal: "critDamage",
  debuffEnhance: "effectHit",
  debuffResist: "effectResist"
};

const DISPLAY_STAT_IDS: Record<string, StatId> = {
  "攻击": "attack",
  "攻击加成": "attackPercent",
  "生命": "hp",
  "生命加成": "hpPercent",
  "防御": "defense",
  "防御加成": "defensePercent",
  "速度": "speed",
  "暴击": "crit",
  "暴击伤害": "critDamage",
  "效果命中": "effectHit",
  "效果抵抗": "effectResist"
};

const TWO_PIECE_VALUES: Partial<Record<StatId, number>> = {
  attackPercent: 0.15,
  crit: 0.15,
  hpPercent: 0.15,
  defensePercent: 0.15,
  effectHit: 0.15,
  effectResist: 0.15
};

const TWO_PIECE_SETS: Partial<Record<StatId, ReadonlySet<string>>> = Object.fromEntries(
  TWO_PIECE_EFFECTS.map((effect) => [effect.stat, new Set<string>(effect.suitNames)])
) as Partial<Record<StatId, ReadonlySet<string>>>;

function parseDisplayValue(value: string): number {
  return value.endsWith("%") ? Number.parseFloat(value.slice(0, -1)) / 100 : Number.parseFloat(value);
}

function addStat(target: Partial<Record<StatId, number>>, stat: StatId, value: number): void {
  target[stat] = (target[stat] ?? 0) + value;
}

function requireStatId(label: string): StatId {
  const stat = DISPLAY_STAT_IDS[label];
  if (stat === undefined) {
    throw new Error(`Unknown yuhun stat: ${label}`);
  }
  return stat;
}

export function parseCbgYuhun(item: CbgYuhunItem): Yuhun {
  const main = item.attrs[0];
  if (main === undefined) {
    throw new Error(`Yuhun ${item.uuid} has no main stat`);
  }

  const subStats: Partial<Record<StatId, number>> = {};
  for (const [rawStat, ratio] of item.rattr ?? []) {
    const stat = CBG_RATTR_STATS[rawStat];
    if (stat === undefined) {
      throw new Error(`Unknown CBG rattr: ${rawStat}`);
    }
    addStat(subStats, stat, ratio * SUB_STAT_MAX_ROLLS[stat]);
  }

  const intrinsicStats: Partial<Record<StatId, number>> = {};
  if (item.single_attr !== undefined) {
    addStat(intrinsicStats, requireStatId(item.single_attr[0]), parseDisplayValue(item.single_attr[1]));
  }

  return {
    id: item.uuid,
    name: item.name,
    position: item.pos,
    level: item.level,
    star: item.qua,
    mainStat: requireStatId(main[0]),
    mainValue: parseDisplayValue(main[1]),
    subStats,
    intrinsicStats
  };
}

export function parseCbgInventory(data: CbgExport): Yuhun[] {
  const description = typeof data.equip_desc === "string" ? JSON.parse(data.equip_desc) as { inventory: Record<string, CbgYuhunItem> } : data.equip_desc;
  return Object.values(description.inventory).map(parseCbgYuhun);
}

export function getHeroBasePanel(data: HeroDataFile, heroName: string): Panel {
  const hero = data["式神数据"].find((entry) => entry["式神名称"] === heroName);
  if (hero === undefined) {
    throw new Error(`Unknown hero: ${heroName}`);
  }
  const growth = hero["攻生防属性成长值"];
  const fixed = hero["固定属性基础面板"];
  return {
    attack: growth["攻击"] * LEVEL_40_GROWTH.attack,
    hp: growth["生命"] * LEVEL_40_GROWTH.hp,
    defense: growth["防御"] * LEVEL_40_GROWTH.defense,
    speed: fixed["速度"] ?? 0,
    crit: fixed["暴击"] ?? 0,
    critDamage: fixed["暴击伤害"] ?? 1.5,
    effectHit: fixed["效果命中"] ?? 0,
    effectResist: fixed["效果抵抗"] ?? 0
  };
}

export function calculatePanel(
  base: Panel,
  yuhun: readonly Yuhun[],
  bonusStats: Readonly<Partial<Record<StatId, number>>> = {}
): Panel {
  const stats: Partial<Record<StatId, number>> = {};
  const setCounts = new Map<string, number>();
  for (const item of yuhun) {
    addStat(stats, item.mainStat, item.mainValue);
    for (const [stat, value] of Object.entries(item.subStats) as Array<[StatId, number]>) addStat(stats, stat, value);
    for (const [stat, value] of Object.entries(item.intrinsicStats) as Array<[StatId, number]>) addStat(stats, stat, value);
    setCounts.set(item.name, (setCounts.get(item.name) ?? 0) + 1);
  }
  for (const [stat, names] of Object.entries(TWO_PIECE_SETS) as Array<[StatId, ReadonlySet<string>]>) {
    const activeSetCount = [...setCounts].filter(([name, count]) => count >= 2 && names.has(name)).length;
    addStat(stats, stat, activeSetCount * (TWO_PIECE_VALUES[stat] ?? 0));
  }
  const panel: Panel = {
    attack: base.attack * (1 + (stats.attackPercent ?? 0)) + (stats.attack ?? 0),
    hp: base.hp * (1 + (stats.hpPercent ?? 0)) + (stats.hp ?? 0),
    defense: base.defense * (1 + (stats.defensePercent ?? 0)) + (stats.defense ?? 0),
    speed: base.speed + (stats.speed ?? 0),
    crit: base.crit + (stats.crit ?? 0),
    critDamage: base.critDamage + (stats.critDamage ?? 0),
    effectHit: base.effectHit + (stats.effectHit ?? 0),
    effectResist: base.effectResist + (stats.effectResist ?? 0)
  };
  // Team-code extra attributes are post-calculation modifiers: apply them to
  // the completed yuhun panel, then let the indicator be recalculated.
  if (bonusStats.attackPercent !== undefined) panel.attack *= 1 + bonusStats.attackPercent;
  if (bonusStats.attack !== undefined) panel.attack += bonusStats.attack;
  if (bonusStats.crit !== undefined) panel.crit += bonusStats.crit;
  if (bonusStats.critDamage !== undefined) panel.critDamage += bonusStats.critDamage;
  return panel;
}

export function calculateIndicator(panel: Panel, indicator: Indicator): number {
  if (indicator === "damageOutput") return panel.attack * panel.critDamage;
  if (indicator === "healing") return panel.hp * panel.critDamage;
  if (indicator === "hitResist") return panel.effectHit + panel.effectResist;
  if (indicator === "defenseOutput") return panel.defense * panel.critDamage;
  return panel[indicator];
}

export function matchesConstraints(panel: Panel, constraints: Partial<Record<PanelStatId, ValueConstraint>> = {}): boolean {
  return (Object.entries(constraints) as Array<[PanelStatId, ValueConstraint]>).every(([stat, limit]) => {
    const value = panel[stat];
    return (limit.min === undefined || value >= limit.min)
      && (limit.max === undefined || value <= limit.max)
      && (limit.maxExclusive === undefined || roundScore(value) < roundScore(limit.maxExclusive));
  });
}

function matchesSets(yuhun: readonly Yuhun[], requiredSets: Record<string, number>): boolean {
  const counts = new Map<string, number>();
  for (const item of yuhun) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  return Object.entries(requiredSets).every(([name, count]) => (counts.get(name) ?? 0) >= count);
}

function matchesSetGroups(
  yuhun: readonly Yuhun[],
  groups: NonNullable<OptimizeOptions["requiredSetGroups"]>
): boolean {
  if (groups.length === 0) return true;
  const counts = new Map<string, number>();
  for (const item of yuhun) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  return groups.every((group) => (
    group.names.some((name) => (counts.get(name) ?? 0) >= group.count)
    || (group.intrinsicStat !== undefined && yuhun.filter((item) => item.intrinsicStats[group.intrinsicStat!] !== undefined).length >= group.count)
  ));
}

function canStillMatchSetGroups(
  selected: readonly Yuhun[],
  remainingPositions: readonly (readonly Yuhun[])[],
  groups: NonNullable<OptimizeOptions["requiredSetGroups"]>
): boolean {
  if (groups.length === 0) return true;
  const selectedCounts = new Map<string, number>();
  for (const item of selected) selectedCounts.set(item.name, (selectedCounts.get(item.name) ?? 0) + 1);
  return groups.every((group) => {
    const matchesByName = group.names.some((name) => {
      const possible = remainingPositions.reduce(
        (count, candidates) => count + (candidates.some((item) => item.name === name) ? 1 : 0),
        selectedCounts.get(name) ?? 0
      );
      return possible >= group.count;
    });
    if (matchesByName || group.intrinsicStat === undefined) return matchesByName;
    const intrinsicStat = group.intrinsicStat;
    const possible = remainingPositions.reduce(
      (count, candidates) => count + (candidates.some((item) => item.intrinsicStats[intrinsicStat] !== undefined) ? 1 : 0),
      selected.filter((item) => item.intrinsicStats[intrinsicStat] !== undefined).length
    );
    return possible >= group.count;
  });
}

const PANEL_STATS: readonly PanelStatId[] = [
  "attack", "hp", "defense", "speed", "crit", "critDamage", "effectHit", "effectResist"
];

function zeroPanel(): Panel {
  return {
    attack: 0,
    hp: 0,
    defense: 0,
    speed: 0,
    crit: 0,
    critDamage: 0,
    effectHit: 0,
    effectResist: 0
  };
}

function singlePieceDelta(
  base: Panel,
  baseline: Panel,
  item: Yuhun,
  bonusStats: Readonly<Partial<Record<StatId, number>>>
): Panel {
  const panel = calculatePanel(base, [item], bonusStats);
  return Object.fromEntries(PANEL_STATS.map((stat) => [stat, panel[stat] - baseline[stat]])) as unknown as Panel;
}

function maximumSetBonuses(base: Panel, candidatesByPosition: readonly (readonly Yuhun[])[]): Panel {
  const result = zeroPanel();
  for (const [stat, names] of Object.entries(TWO_PIECE_SETS) as Array<[StatId, ReadonlySet<string>]>) {
    const possibleSets = [...names].filter((name) =>
      candidatesByPosition.filter((items) => items.some((item) => item.name === name)).length >= 2
    ).length;
    const bonus = Math.min(3, possibleSets) * (TWO_PIECE_VALUES[stat] ?? 0);
    if (stat === "attackPercent") result.attack += base.attack * bonus;
    else if (stat === "hpPercent") result.hp += base.hp * bonus;
    else if (stat === "defensePercent") result.defense += base.defense * bonus;
    else if (stat in result) result[stat as PanelStatId] += bonus;
  }
  return result;
}

function candidatePool(
  base: Panel,
  baseline: Panel,
  items: readonly Yuhun[],
  options: OptimizeOptions,
  deltas: ReadonlyMap<Yuhun, Panel>,
  requiredNames: ReadonlySet<string>,
  requiredIntrinsicStats: ReadonlySet<IntrinsicStatId>
): Yuhun[] {
  const limit = options.candidateLimitPerPosition ?? 80;
  if (items.length <= limit) return [...items];
  const constraints = Object.entries(options.constraints ?? {}) as Array<[PanelStatId, ValueConstraint]>;
  const feasible = items.filter((item) => constraints.every(([stat, range]) =>
    (range.max === undefined || baseline[stat] + deltas.get(item)![stat] <= range.max)
    && (range.maxExclusive === undefined || roundScore(baseline[stat] + deltas.get(item)![stat]) < roundScore(range.maxExclusive))
  ));
  const selected = new Set<Yuhun>();
  const add = (source: readonly Yuhun[], score: (item: Yuhun) => number, descending: boolean): void => {
    const ranked = [...source].sort((left, right) => {
      const difference = score(left) - score(right);
      return descending ? -difference : difference;
    });
    for (const item of ranked.slice(0, limit)) selected.add(item);
  };
  const indicator = options.indicator ?? "damageOutput";
  const indicatorScore = (item: Yuhun): number => calculateIndicator(
    calculatePanel(base, [item], options.bonusStats),
    indicator
  );
  const retainDirections = (source: readonly Yuhun[]): void => {
    add(source, indicatorScore, true);
    for (const [stat, range] of constraints) {
      if (range.min !== undefined) add(source, (item) => deltas.get(item)![stat], true);
      if (range.max !== undefined || range.maxExclusive !== undefined) add(source, (item) => deltas.get(item)![stat], false);
    }
  };
  retainDirections(feasible);
  for (const name of requiredNames) retainDirections(feasible.filter((item) => item.name === name));
  for (const stat of requiredIntrinsicStats) retainDirections(feasible.filter((item) => item.intrinsicStats[stat] !== undefined));
  return [...selected];
}

function remainingMaximums(
  candidatesByPosition: readonly (readonly Yuhun[])[],
  deltas: ReadonlyMap<Yuhun, Panel>
): Panel[] {
  const result = Array.from({ length: candidatesByPosition.length + 1 }, zeroPanel);
  for (let position = candidatesByPosition.length - 1; position >= 0; position -= 1) {
    const current = { ...result[position + 1]! };
    for (const stat of PANEL_STATS) {
      current[stat] += Math.max(0, ...candidatesByPosition[position]!.map((item) => deltas.get(item)![stat]));
    }
    result[position] = current;
  }
  return result;
}

function optimisticPanel(
  baseline: Panel,
  selected: readonly Yuhun[],
  remaining: Panel,
  setBonusUpper: Panel,
  deltas: ReadonlyMap<Yuhun, Panel>,
  current: Panel
): Panel {
  return Object.fromEntries(PANEL_STATS.map((stat) => [
    stat,
    current[stat] + remaining[stat] + Math.max(
      0,
      setBonusUpper[stat] - (current[stat] - baseline[stat] - selected.reduce(
        (total, item) => total + deltas.get(item)![stat],
        0
      ))
    )
  ])) as unknown as Panel;
}

function canStillMatchConstraints(
  current: Panel,
  optimistic: Panel,
  constraints: Partial<Record<PanelStatId, ValueConstraint>>
): boolean {
  return (Object.entries(constraints) as Array<[PanelStatId, ValueConstraint]>).every(([stat, range]) =>
    (range.max === undefined || current[stat] <= range.max) &&
    (range.maxExclusive === undefined || roundScore(current[stat]) < roundScore(range.maxExclusive)) &&
    (range.min === undefined || optimistic[stat] >= range.min)
  );
}

interface BeamEntry {
  readonly selected: Yuhun[];
  readonly rank: number;
  readonly constraintRank: number;
}

function setProgressKey(
  selected: readonly Yuhun[],
  groups: NonNullable<OptimizeOptions["requiredSetGroups"]>
): string {
  if (groups.length === 0) return "none";
  const counts = new Map<string, number>();
  for (const item of selected) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
  return groups.map((group) => {
    const nameProgress = Math.max(0, ...group.names.map((name) => counts.get(name) ?? 0));
    const intrinsicProgress = group.intrinsicStat === undefined
      ? 0
      : selected.filter((item) => item.intrinsicStats[group.intrinsicStat!] !== undefined).length;
    return Math.min(group.count, Math.max(nameProgress, intrinsicProgress));
  }).join(":");
}

function indicatorSetProgressKey(selected: readonly Yuhun[], indicator: Indicator): string {
  const stats = indicator === "damageOutput"
    ? ["attackPercent"] as const
    : indicator === "healing" ? ["hpPercent"] as const
      : indicator === "defenseOutput" ? ["defensePercent"] as const
        : indicator === "hitResist" ? ["effectHit", "effectResist"] as const
          : [indicator] as const;
  const relevantNames = new Set(stats.flatMap((stat) => [...(TWO_PIECE_SETS[stat] ?? [])]));
  const counts = new Map<string, number>();
  for (const item of selected) {
    if (relevantNames.has(item.name)) counts.set(item.name, Math.min(2, (counts.get(item.name) ?? 0) + 1));
  }
  return [...counts].filter(([, count]) => count === 2).sort(([left], [right]) => left.localeCompare(right))
    .map(([name]) => name).join(",") || "none";
}

function constraintProgressKey(
  baseline: Panel,
  current: Panel,
  constraints: Partial<Record<PanelStatId, ValueConstraint>>
): string {
  return (Object.entries(constraints) as Array<[PanelStatId, ValueConstraint]>).map(([stat, range]) => {
    if (range.min !== undefined && current[stat] < range.min) {
      const span = range.min - baseline[stat];
      const ratio = span === 0 ? 1 : (current[stat] - baseline[stat]) / span;
      return `${stat}:below-${Math.max(0, Math.min(9, Math.floor(ratio * 10)))}`;
    }
    if (range.min !== undefined && range.max !== undefined && range.max > range.min) {
      const ratio = (current[stat] - range.min) / (range.max - range.min);
      return `${stat}:within-${Math.max(0, Math.min(10, Math.floor(ratio * 10)))}`;
    }
    if (range.max !== undefined && range.max !== baseline[stat]) {
      const ratio = (current[stat] - baseline[stat]) / (range.max - baseline[stat]);
      return `${stat}:max-${Math.max(0, Math.min(10, Math.floor(ratio * 10)))}`;
    }
    return `${stat}:met`;
  }).join("|");
}

function compareBeamEntries(left: BeamEntry, right: BeamEntry): number {
  return left.rank - right.rank || left.constraintRank - right.constraintRank;
}

function constraintRank(
  base: Panel,
  current: Panel,
  constraints: Partial<Record<PanelStatId, ValueConstraint>>
): number {
  return (Object.entries(constraints) as Array<[PanelStatId, ValueConstraint]>).reduce((total, [stat, range]) => {
    if (range.min !== undefined && current[stat] < range.min) {
      const span = range.min - base[stat];
      return total + (span <= 0 ? 1 : (current[stat] - base[stat]) / span);
    }
    if (range.max !== undefined) {
      const span = range.max - base[stat];
      return total + (span <= 0 ? 0 : (range.max - current[stat]) / span);
    }
    return total + 1;
  }, 0);
}

function pushBeam(heap: BeamEntry[], entry: BeamEntry, maximum: number): void {
  if (maximum <= 0) return;
  if (heap.length < maximum) {
    heap.push(entry);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareBeamEntries(heap[parent]!, heap[index]!) <= 0) break;
      [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
      index = parent;
    }
    return;
  }
  if (compareBeamEntries(entry, heap[0]!) <= 0) return;
  heap[0] = entry;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && compareBeamEntries(heap[left]!, heap[smallest]!) < 0) smallest = left;
    if (right < heap.length && compareBeamEntries(heap[right]!, heap[smallest]!) < 0) smallest = right;
    if (smallest === index) break;
    [heap[index], heap[smallest]] = [heap[smallest]!, heap[index]!];
    index = smallest;
  }
}

/**
 * Search six-slot builds. Small candidate spaces are exhaustively enumerated;
 * larger spaces use a bounded beam and are explicitly reported as approximate.
 */
export function searchYuhunBuilds(base: Panel, candidates: readonly Yuhun[], options: OptimizeOptions = {}): YuhunSearchResult {
  const byPosition = Array.from({ length: 6 }, (_, index) => candidates.filter((item) => item.position === index + 1));
  if (byPosition.some((items) => items.length === 0)) {
    return { results: [], exact: true, candidateCombinations: 0, evaluatedCombinations: 0 };
  }
  const combinations = byPosition.reduce((total, items) => total * items.length, 1);
  const maximum = options.maxCombinations ?? 5_000_000;
  const requiredSetGroups = options.requiredSetGroups ?? [];
  const bonusStats = options.bonusStats ?? {};
  const baseline = calculatePanel(base, [], bonusStats);
  let evaluatedCombinations = 0;

  const evaluate = (selected: readonly Yuhun[], results: YuhunBuildResult[]): void => {
    evaluatedCombinations += 1;
    if (!matchesSets(selected, options.requiredSets ?? {})) return;
    if (!matchesSetGroups(selected, requiredSetGroups)) return;
    const panel = calculatePanel(base, selected, bonusStats);
    if (!matchesConstraints(panel, options.constraints)) return;
    results.push({ yuhun: [...selected], panel, score: calculateIndicator(panel, options.indicator ?? "damageOutput") });
  };

  const results: YuhunBuildResult[] = [];
  if (combinations <= maximum) {
    const selected: Yuhun[] = [];
    const visit = (position: number): void => {
      if (position === 6) return evaluate(selected, results);
      for (const item of byPosition[position]!) {
        selected.push(item);
        if (canStillMatchSetGroups(selected, byPosition.slice(position + 1), requiredSetGroups)) visit(position + 1);
        selected.pop();
      }
    };
    visit(0);
  } else {
    const beamWidth = options.beamWidth ?? 5_000;
    const requiredNames = new Set(requiredSetGroups.flatMap((group) => group.names));
    const requiredIntrinsicStats = new Set(requiredSetGroups.flatMap((group) => group.intrinsicStat === undefined ? [] : [group.intrinsicStat]));
    const deltas = new Map(byPosition.flat().map((item) => [item, singlePieceDelta(base, baseline, item, bonusStats)]));
    const beamCandidates = byPosition.map((items) => candidatePool(base, baseline, items, options, deltas, requiredNames, requiredIntrinsicStats));
    const maximums = remainingMaximums(beamCandidates, deltas);
    const setBonusUpper = maximumSetBonuses(base, beamCandidates);
    const diversityWidth = ["damageOutput", "healing", "hitResist", "defenseOutput"].includes(options.indicator ?? "damageOutput") ? 64 : 8;
    let beam: Yuhun[][] = [[]];
    for (let position = 0; position < 6; position += 1) {
      const global: BeamEntry[] = [];
      const diversityBuckets = new Map<string, BeamEntry[]>();
      for (const selected of beam) {
        for (const item of beamCandidates[position]!) {
          const next = [...selected, item];
          if (!canStillMatchSetGroups(next, beamCandidates.slice(position + 1), requiredSetGroups)) continue;
          const current = calculatePanel(base, next, bonusStats);
          const optimistic = optimisticPanel(baseline, next, maximums[position + 1]!, setBonusUpper, deltas, current);
          if (!canStillMatchConstraints(current, optimistic, options.constraints ?? {})) continue;
          const entry = {
            selected: next,
            rank: calculateIndicator(optimistic, options.indicator ?? "damageOutput"),
            constraintRank: constraintRank(baseline, current, options.constraints ?? {})
          };
          pushBeam(global, entry, beamWidth);
          const key = `${setProgressKey(next, requiredSetGroups)}|${indicatorSetProgressKey(next, options.indicator ?? "damageOutput")}|${constraintProgressKey(baseline, current, options.constraints ?? {})}`;
          const bucket = diversityBuckets.get(key) ?? [];
          pushBeam(bucket, entry, diversityWidth);
          diversityBuckets.set(key, bucket);
        }
      }
      const retained = new Set(global);
      for (const bucket of diversityBuckets.values()) for (const entry of bucket) retained.add(entry);
      beam = [...retained].map((entry) => entry.selected);
      if (beam.length === 0) break;
    }
    for (const selected of beam) {
      if (selected.length === 6) evaluate(selected, results);
    }
  }

  results.sort((left, right) => right.score - left.score);
  return {
    results: results.slice(0, options.topN ?? 10),
    exact: combinations <= maximum,
    candidateCombinations: combinations,
    evaluatedCombinations
  };
}

export function optimizeYuhun(base: Panel, candidates: readonly Yuhun[], options: OptimizeOptions = {}): YuhunBuildResult[] {
  const search = searchYuhunBuilds(base, candidates, options);
  if (!search.exact) {
    throw new Error(`Candidate combinations ${search.candidateCombinations} exceed exact-search limit ${options.maxCombinations ?? 5_000_000}`);
  }
  return [...search.results];
}
