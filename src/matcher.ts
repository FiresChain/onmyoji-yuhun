import type {
  FilterCriteria,
  LevelRange,
  PlanKind,
  StatId,
  SubStatCount,
  YuhunFilterShare
} from "./types.js";
import type { YyxYuhun } from "./yyx.js";
import { canonicalYuhunName } from "./mappings.js";

export type FilterMatcherErrorCode =
  | "EMPTY_CRITERIA"
  | "UNKNOWN_BITS"
  | "CONTRADICTORY_SUB_STAT"
  | "DUPLICATE_YUHUN_ID";

export class FilterMatcherError extends Error {
  readonly code: FilterMatcherErrorCode;
  readonly groupIndex: number | null;

  constructor(code: FilterMatcherErrorCode, message: string, groupIndex: number | null) {
    super(message);
    this.name = "FilterMatcherError";
    this.code = code;
    this.groupIndex = groupIndex;
  }
}

export interface FilterGroupMatch {
  readonly groupIndex: number;
  readonly name: string;
  readonly matchedIds: readonly string[];
}

export interface FilterMatchReport {
  readonly planKind: PlanKind;
  readonly groups: readonly FilterGroupMatch[];
  readonly unionIds: readonly string[];
}

const LEVEL_BOUNDS: Readonly<Record<LevelRange, readonly [minimum: number, maximum: number]>> = {
  "0-2": [0, 2],
  "3-5": [3, 5],
  "6-8": [6, 8],
  "9-11": [9, 11],
  "12-14": [12, 14],
  "15": [15, 15]
};

function fail(
  code: FilterMatcherErrorCode,
  groupIndex: number,
  message: string
): never {
  throw new FilterMatcherError(code, `Cannot match filter group ${groupIndex}: ${message}`, groupIndex);
}

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isEmptyCriteria(criteria: FilterCriteria): boolean {
  return criteria.types.length === 0 &&
    criteria.positions.length === 0 &&
    criteria.stars.length === 0 &&
    criteria.mainStats.length === 0 &&
    criteria.subStats.length === 0 &&
    criteria.subStatCounts.length === 0 &&
    criteria.levelRanges.length === 0 &&
    criteria.intrinsicStats.length === 0 &&
    criteria.unknownTypeBits.length === 0 &&
    criteria.unknownOptionBits.length === 0;
}

function matchesSubStatCount(count: number, selected: readonly SubStatCount[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((value) => value === "lessThan2" ? count < 2 : count === Number(value));
}

function matchesLevel(level: number, selected: readonly LevelRange[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((range) => {
    const [minimum, maximum] = LEVEL_BOUNDS[range];
    return level >= minimum && level <= maximum;
  });
}

function compileCriteria(
  criteria: FilterCriteria,
  groupIndex: number
): (item: YyxYuhun) => boolean {
  if (criteria.unknownTypeBits.length > 0 || criteria.unknownOptionBits.length > 0) {
    return fail("UNKNOWN_BITS", groupIndex, "unknown mask bits have no matching semantics");
  }
  if (isEmptyCriteria(criteria)) {
    return fail("EMPTY_CRITERIA", groupIndex, "the game semantics of a completely empty group are unknown");
  }

  const includedSubStats = new Set<StatId>();
  const excludedSubStats = new Set<StatId>();
  for (const filter of criteria.subStats) {
    const target = filter.requirement === "include" ? includedSubStats : excludedSubStats;
    target.add(filter.stat);
  }
  for (const stat of includedSubStats) {
    if (excludedSubStats.has(stat)) {
      return fail(
        "CONTRADICTORY_SUB_STAT",
        groupIndex,
        `sub-stat ${stat} is both included and excluded`
      );
    }
  }

  return (item) => {
    if (criteria.types.length > 0 && !criteria.types.some((name) => canonicalYuhunName(name) === canonicalYuhunName(item.name))) return false;
    if (criteria.positions.length > 0 && !criteria.positions.includes(item.position)) return false;
    if (criteria.stars.length > 0 && !criteria.stars.includes(item.star)) return false;
    if (criteria.mainStats.length > 0 && !criteria.mainStats.includes(item.mainStat)) return false;

    for (const stat of includedSubStats) {
      if (!hasOwn(item.subStats, stat)) return false;
    }
    for (const stat of excludedSubStats) {
      if (hasOwn(item.subStats, stat)) return false;
    }

    if (!matchesSubStatCount(Object.keys(item.subStats).length, criteria.subStatCounts)) return false;
    if (!matchesLevel(item.level, criteria.levelRanges)) return false;
    // Ordinary souls have no intrinsic property. The game only applies this
    // condition to boss souls, which are represented by a non-empty map.
    if (
      criteria.intrinsicStats.length > 0 &&
      Object.keys(item.intrinsicStats).length > 0 &&
      !criteria.intrinsicStats.some((stat) => hasOwn(item.intrinsicStats, stat))
    ) return false;
    return true;
  };
}

/**
 * Match decoded filter groups against the supplied domain, excluding locked yuhun.
 * `garbage` is intentionally ignored; callers select the normal or discarded pool
 * by filtering the domain before this function is called.
 */
export function matchFilterShare(
  share: YuhunFilterShare,
  domain: readonly YyxYuhun[]
): FilterMatchReport {
  const inputIds = new Set<string>();
  for (const [index, item] of domain.entries()) {
    if (inputIds.has(item.id)) {
      throw new FilterMatcherError(
        "DUPLICATE_YUHUN_ID",
        `Cannot match yuhun input: duplicate item ID at index ${index}`,
        null
      );
    }
    inputIds.add(item.id);
  }
  const predicates = share.groups.map((group, groupIndex) =>
    compileCriteria(group.criteria, groupIndex)
  );
  const union = new Set<string>();
  const groups = share.groups.map((group, groupIndex): FilterGroupMatch => {
    const matched = new Set<string>();
    const predicate = predicates[groupIndex]!;
    for (const item of domain) {
      if (!item.lock && predicate(item)) {
        matched.add(item.id);
        union.add(item.id);
      }
    }
    return {
      groupIndex,
      name: group.name,
      matchedIds: [...matched]
    };
  });

  const unionIds: string[] = [];
  const emitted = new Set<string>();
  for (const item of domain) {
    if (union.has(item.id) && !emitted.has(item.id)) {
      emitted.add(item.id);
      unionIds.push(item.id);
    }
  }
  return { planKind: share.planKind, groups, unionIds };
}
