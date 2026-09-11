export interface YuhunCapacityStep {
  readonly level15Count: number;
  readonly capacity: number;
}

export const INITIAL_YUHUN_CAPACITY = 6_000;
export const DEFAULT_DESIRED_FREE_SLOTS = 500;

/** Largest nonnegative multiple of 100 strictly below the marked discard count. */
export function maximumDesiredFreeSlots(markedCount: number): number {
  requireNonNegativeInteger(markedCount, "markedCount");
  return Math.max(0, Math.floor((markedCount - 1) / 100) * 100);
}

export function normalizeDesiredFreeSlots(value: number, markedCount: number): number {
  const requested = Number.isFinite(value) ? Math.round(value / 100) * 100 : DEFAULT_DESIRED_FREE_SLOTS;
  return Math.max(0, Math.min(maximumDesiredFreeSlots(markedCount), requested));
}

export const YUHUN_CAPACITY_STEPS: readonly YuhunCapacityStep[] = [
  { level15Count: 1_000, capacity: 7_000 },
  { level15Count: 1_500, capacity: 7_500 },
  { level15Count: 2_500, capacity: 8_500 },
  { level15Count: 3_500, capacity: 9_500 },
  { level15Count: 4_500, capacity: 10_500 },
  { level15Count: 5_500, capacity: 11_500 },
  { level15Count: 6_500, capacity: 12_500 },
  { level15Count: 7_500, capacity: 13_500 },
  { level15Count: 8_500, capacity: 14_500 },
  { level15Count: 9_500, capacity: 15_500 }
];

export interface CleanupQuotaInput {
  readonly totalCount: number;
  readonly level15Count: number;
  readonly desiredFreeSlots: number;
}

export interface CleanupQuota {
  readonly capacity: number;
  readonly currentFreeSlots: number;
  readonly requiredRelease: number;
}

function requireNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
}

export function calculateYuhunCapacity(level15Count: number): number {
  requireNonNegativeInteger(level15Count, "level15Count");
  let capacity = INITIAL_YUHUN_CAPACITY;
  for (const step of YUHUN_CAPACITY_STEPS) {
    if (level15Count < step.level15Count) break;
    capacity = step.capacity;
  }
  return capacity;
}

export function calculateCleanupQuota(input: CleanupQuotaInput): CleanupQuota {
  requireNonNegativeInteger(input.totalCount, "totalCount");
  requireNonNegativeInteger(input.level15Count, "level15Count");
  requireNonNegativeInteger(input.desiredFreeSlots, "desiredFreeSlots");
  if (input.level15Count > input.totalCount) {
    throw new Error("level15Count cannot exceed totalCount");
  }

  const capacity = calculateYuhunCapacity(input.level15Count);
  return {
    capacity,
    currentFreeSlots: Math.max(0, capacity - input.totalCount),
    requiredRelease: Math.max(0, input.totalCount + input.desiredFreeSlots - capacity)
  };
}
