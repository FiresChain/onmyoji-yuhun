/** Ordered from strongest retention to first released when space is insufficient. */
export const RETENTION_STRATEGIES = [
  { id: "direct-improvement", label: "现有属性提升" },
  { id: "equivalent-suit", label: "同效果套装潜力" },
  { id: "new-substat", label: "补出新属性潜力" }
] as const;

export type RetentionStrategyId = (typeof RETENTION_STRATEGIES)[number]["id"];
export interface RetentionStrategySetting {
  readonly id: RetentionStrategyId;
  readonly enabled: boolean;
}

export function defaultRetentionStrategies(): RetentionStrategySetting[] {
  return RETENTION_STRATEGIES.map(({ id }) => ({ id, enabled: true }));
}

/** Ignore unknown/duplicate saved entries and append new strategies deterministically. */
export function normalizeRetentionStrategies(value: unknown): RetentionStrategySetting[] {
  const result: RetentionStrategySetting[] = [];
  if (Array.isArray(value)) for (const entry of value) {
    if (!entry || !RETENTION_STRATEGIES.some(strategy => strategy.id === entry.id) || result.some(strategy => strategy.id === entry.id)) continue;
    result.push({ id: entry.id, enabled: entry.enabled !== false });
  }
  for (const strategy of defaultRetentionStrategies()) if (!result.some(entry => entry.id === strategy.id)) result.push(strategy);
  return result;
}
