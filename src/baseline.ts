import {
  YUHUN_POSITIONS,
  YUHUN_SUIT_IDS_BY_NAME
} from "./mappings.js";
import type { Yuhun } from "./calculation.js";
import {
  TEMPLATE_METRIC,
  type YuhunTemplate,
  validateTemplate
} from "./templates.js";

export const SCATTERED_ROLE = "scattered" as const;
export type BaselineRole = typeof SCATTERED_ROLE | `suit:${number}` | `suits:${string}`;

// Reports contain every feasible six-slot role assignment, so fail explicitly
// before an untrusted template can make the output itself unbounded.
const MAX_BASELINE_ENUMERATION_STATES = 100_000;

export interface BaselineSlot {
  position: number;
  role: BaselineRole;
  yuhun: Yuhun | null;
  speed: number;
}

export interface SetAllocation {
  /** One-based positions assigned to the required set. */
  setPositions: readonly number[];
}

export interface BaselinePattern {
  index: number;
  setRole: BaselineRole | null;
  setPositions: readonly number[];
  rolesByPosition: readonly BaselineRole[];
  score: number | null;
  slots: readonly BaselineSlot[];
}

export interface BaselineReport {
  template: YuhunTemplate;
  metric: typeof TEMPLATE_METRIC;
  baseline: number | null;
  bestPattern: BaselinePattern | null;
  patterns: readonly BaselinePattern[];
}

/** `null` means no retained witness exists, so the role cannot dominate a candidate. */
export type DominanceThreshold = number | null;
export type DominanceThresholds = Record<string, Record<string, Record<string, DominanceThreshold>>>;

function requireYuhunArray(value: readonly Yuhun[]): void {
  if (!Array.isArray(value)) throw new Error("yuhun must be an array");
  for (const [index, item] of value.entries()) {
    if (item.level !== 15) throw new Error(`yuhun[${index}] must be level 15 for a baseline report`);
    if (!YUHUN_POSITIONS.includes(item.position as (typeof YUHUN_POSITIONS)[number])) {
      throw new Error(`yuhun[${index}] has invalid position ${String(item.position)}`);
    }
    if (typeof item.id !== "string" || item.id.length === 0) {
      throw new Error(`yuhun[${index}] must have a non-empty id`);
    }
    if (YUHUN_SUIT_IDS_BY_NAME[item.name as keyof typeof YUHUN_SUIT_IDS_BY_NAME] === undefined) {
      throw new Error(`yuhun[${index}] has an unknown suit name ${item.name}`);
    }
    if (!Number.isFinite(item.mainValue) || item.mainValue < 0) {
      throw new Error(`yuhun[${index}] must have a finite non-negative mainValue`);
    }
    const speed = item.subStats.speed;
    if (speed !== undefined && (!Number.isFinite(speed) || speed < 0)) {
      throw new Error(`yuhun[${index}] must have a finite non-negative subStats.speed`);
    }
  }
}

function suitIdFor(item: Yuhun): number {
  const suitId = YUHUN_SUIT_IDS_BY_NAME[item.name as keyof typeof YUHUN_SUIT_IDS_BY_NAME];
  if (suitId === undefined) throw new Error(`Unknown yuhun suit name: ${item.name}`);
  return suitId;
}

function subSpeed(item: Yuhun): number {
  return item.subStats.speed ?? 0;
}

function totalSpeed(item: Yuhun): number {
  return subSpeed(item) + (item.mainStat === "speed" ? item.mainValue : 0);
}

function betterCandidate(left: Yuhun, right: Yuhun, metric: (item: Yuhun) => number): Yuhun {
  const leftScore = metric(left);
  const rightScore = metric(right);
  if (leftScore !== rightScore) return leftScore > rightScore ? left : right;
  return left.id <= right.id ? left : right;
}

function bestFor(
  items: readonly Yuhun[],
  position: number,
  role: BaselineRole,
  metric: (item: Yuhun) => number
): Yuhun | null {
  let best: Yuhun | null = null;
  const allowedSuitIds = role === SCATTERED_ROLE
    ? null
    : role.slice(role.startsWith("suits:") ? "suits:".length : "suit:".length)
      .split(",")
      .map(Number);
  for (const item of items) {
    if (item.position !== position) continue;
    if (allowedSuitIds !== null && !allowedSuitIds.includes(suitIdFor(item))) continue;
    best = best === null ? item : betterCandidate(best, item, metric);
  }
  return best;
}

function setRole(suitId: number): BaselineRole {
  return `suit:${suitId}`;
}

/** Enumerate all one-based slot allocations with at least `minimumSetCount` set pieces. */
export function enumerateSetAllocations(minimumSetCount: number): SetAllocation[] {
  if (!Number.isInteger(minimumSetCount) || minimumSetCount < 1 || minimumSetCount > 6) {
    throw new Error("minimumSetCount must be an integer from 1 to 6");
  }
  const allocations: SetAllocation[] = [];
  for (let mask = 0; mask < 1 << YUHUN_POSITIONS.length; mask += 1) {
    const setPositions = YUHUN_POSITIONS.filter((position) => (mask & (1 << (position - 1))) !== 0);
    if (setPositions.length >= minimumSetCount) allocations.push({ setPositions });
  }
  return allocations;
}

function patternsForTemplate(template: YuhunTemplate): Array<{
  setRole: BaselineRole | null;
  setPositions: readonly number[];
  rolesByPosition: readonly BaselineRole[];
}> {
  if (template.sets.length === 0) {
    return [{
      setRole: null,
      setPositions: [],
      rolesByPosition: YUHUN_POSITIONS.map(() => SCATTERED_ROLE)
    }];
  }

  const suitMemberships = new Map<number, number[]>();
  for (const [requirementIndex, requirement] of template.sets.entries()) {
    for (const suitId of requirement.suitIds) {
      const memberships = suitMemberships.get(suitId) ?? [];
      memberships.push(requirementIndex);
      suitMemberships.set(suitId, memberships);
    }
  }
  const suitsByMembership = new Map<string, { requirementIndexes: number[]; suitIds: number[] }>();
  for (const [suitId, requirementIndexes] of suitMemberships) {
    const key = requirementIndexes.join(",");
    const group = suitsByMembership.get(key) ?? { requirementIndexes, suitIds: [] };
    group.suitIds.push(suitId);
    suitsByMembership.set(key, group);
  }
  const roleOptions = [...suitsByMembership.values()].map(({ requirementIndexes, suitIds }) => {
    suitIds.sort((left, right) => left - right);
    const role: BaselineRole = suitIds.length === 1
      ? setRole(suitIds[0]!)
      : `suits:${suitIds.join(",")}`;
    return { role, requirementIndexes };
  });

  const assignments: BaselineRole[][] = [];
  const current = YUHUN_POSITIONS.map(() => SCATTERED_ROLE as BaselineRole);
  const counts = template.sets.map(() => 0);
  let visitedStates = 0;
  function visit(positionIndex: number): void {
    visitedStates += 1;
    if (visitedStates > MAX_BASELINE_ENUMERATION_STATES) {
      throw new Error(
        `Template ${template.id} exceeds the baseline pattern enumeration limit of ` +
        `${MAX_BASELINE_ENUMERATION_STATES} states`
      );
    }
    const positionsRemaining = YUHUN_POSITIONS.length - positionIndex;
    if (template.sets.some((requirement, index) =>
      counts[index]! + positionsRemaining < requirement.count
    )) return;
    if (positionIndex === YUHUN_POSITIONS.length) {
      if (template.sets.every((requirement, index) =>
        counts[index]! >= requirement.count
      )) assignments.push([...current]);
      return;
    }

    current[positionIndex] = SCATTERED_ROLE;
    visit(positionIndex + 1);
    for (const option of roleOptions) {
      current[positionIndex] = option.role;
      for (const index of option.requirementIndexes) counts[index]! += 1;
      visit(positionIndex + 1);
      for (const index of option.requirementIndexes) counts[index]! -= 1;
    }
  }
  visit(0);
  if (assignments.length === 0) {
    throw new Error(`Template ${template.id} set requirements cannot be satisfied by six yuhun slots`);
  }

  return assignments.map((rolesByPosition) => {
    const setRolesUsed = [...new Set(rolesByPosition.filter((role) => role !== SCATTERED_ROLE))];
    const setPositions: number[] = [];
    for (const [index, role] of rolesByPosition.entries()) {
      if (role !== SCATTERED_ROLE) setPositions.push(YUHUN_POSITIONS[index]!);
    }
    return {
      setRole: setRolesUsed.length === 1 ? setRolesUsed[0]! : null,
      setPositions,
      rolesByPosition
    };
  });
}

function makePattern(
  index: number,
  setRole: BaselineRole | null,
  setPositions: readonly number[],
  rolesByPosition: readonly BaselineRole[],
  items: readonly Yuhun[]
): BaselinePattern {
  const slots: BaselineSlot[] = [];
  let score = 0;
  let complete = true;
  for (const position of YUHUN_POSITIONS) {
    const role = rolesByPosition[position - 1] ?? SCATTERED_ROLE;
    const yuhun = bestFor(items, position, role, totalSpeed);
    const speed = yuhun === null ? 0 : totalSpeed(yuhun);
    if (yuhun === null) complete = false;
    score += speed;
    slots.push({ position, role, yuhun, speed });
  }
  return {
    index,
    setRole,
    setPositions: [...setPositions],
    rolesByPosition: [...rolesByPosition],
    score: complete ? score : null,
    slots
  };
}

/**
 * Compute baseline speed without invoking the Cartesian optimizer.
 *
 * Throws when the template is structurally impossible or its complete pattern
 * report would require more than the bounded enumeration above.
 */
export function calculateBaseline(templateInput: YuhunTemplate, items: readonly Yuhun[]): BaselineReport {
  const template = validateTemplate(templateInput);
  requireYuhunArray(items);
  const patterns = patternsForTemplate(template).map((pattern, index) => makePattern(
    index,
    pattern.setRole,
    pattern.setPositions,
    pattern.rolesByPosition,
    items
  ));
  const complete = patterns.filter((pattern): pattern is BaselinePattern & { score: number } => pattern.score !== null);
  const bestPattern = complete.reduce<BaselinePattern | null>((best, pattern) => {
    if (best === null || best.score === null || pattern.score > best.score ||
        (pattern.score === best.score && pattern.index < best.index)) return pattern;
    return best;
  }, null);
  return {
    template,
    metric: TEMPLATE_METRIC,
    baseline: bestPattern?.score ?? null,
    bestPattern,
    patterns
  };
}

/** Calculate slot-level dominance thresholds using only retained sub-stat speed. */
export function calculateDominanceThresholds(
  templateInput: YuhunTemplate,
  items: readonly Yuhun[]
): DominanceThresholds {
  const template = validateTemplate(templateInput);
  requireYuhunArray(items);
  const roles: BaselineRole[] = [SCATTERED_ROLE];
  for (const requirement of template.sets) {
    for (const suitId of requirement.suitIds) {
      const role = setRole(suitId);
      if (!roles.includes(role)) roles.push(role);
    }
  }

  const byPosition: Record<string, Record<string, number | null>> = {};
  for (const position of YUHUN_POSITIONS) {
    const byRole: Record<string, number | null> = {};
    for (const role of roles) {
      let maximum: number | null = null;
      for (const item of items) {
        if (item.position !== position) continue;
        const allowedSuitIds = role === SCATTERED_ROLE
          ? null
          : role.slice(role.startsWith("suits:") ? "suits:".length : "suit:".length)
            .split(",")
            .map(Number);
        if (allowedSuitIds !== null && !allowedSuitIds.includes(suitIdFor(item))) continue;
        const speed = subSpeed(item);
        if (maximum === null || speed > maximum) maximum = speed;
      }
      byRole[role] = maximum;
    }
    byPosition[String(position)] = byRole;
  }
  return { [template.id]: byPosition };
}

/** Convenience helper for producing both reports for a template collection. */
export function calculateBaselineBundle(
  templates: readonly YuhunTemplate[],
  items: readonly Yuhun[]
): Array<{ baseline: BaselineReport; thresholds: DominanceThresholds }> {
  return templates.map((template) => ({
    baseline: calculateBaseline(template, items),
    thresholds: calculateDominanceThresholds(template, items)
  }));
}

// Descriptive aliases for callers using report terminology.
export const calculateBaselineReport = calculateBaseline;
export const calculateThresholds = calculateDominanceThresholds;
