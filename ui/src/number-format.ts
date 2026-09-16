import type { StatId } from "../../src/browser.js";

const DISPLAY_DECIMAL_PLACES_KEY = "onmyoji-yuhun-display-decimal-places-v1";
export const DEFAULT_DISPLAY_DECIMAL_PLACES = 2;
export const MAX_DISPLAY_DECIMAL_PLACES = 6;

export function normalizeDisplayDecimalPlaces(value: number): number {
  return Number.isInteger(value) && value >= 0 && value <= MAX_DISPLAY_DECIMAL_PLACES
    ? value
    : DEFAULT_DISPLAY_DECIMAL_PLACES;
}

export function loadDisplayDecimalPlaces(): number {
  try {
    const value = localStorage.getItem(DISPLAY_DECIMAL_PLACES_KEY);
    return value === null || value.trim() === "" ? DEFAULT_DISPLAY_DECIMAL_PLACES : normalizeDisplayDecimalPlaces(Number(value));
  } catch {
    return DEFAULT_DISPLAY_DECIMAL_PLACES;
  }
}

export function saveDisplayDecimalPlaces(value: number): void {
  try { localStorage.setItem(DISPLAY_DECIMAL_PLACES_KEY, String(normalizeDisplayDecimalPlaces(value))); }
  catch { /* Keep the current preference when browser storage is unavailable. */ }
}

const formatters = new Map<number, Intl.NumberFormat>();

export function formatNumber(value: number | null | undefined, decimalPlaces = DEFAULT_DISPLAY_DECIMAL_PLACES): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const digits = normalizeDisplayDecimalPlaces(decimalPlaces);
  let formatter = formatters.get(digits);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(digits, formatter);
  }
  return formatter.format(value);
}

const percentageStats = new Set<StatId>([
  "attackPercent", "defensePercent", "hpPercent", "crit", "critDamage", "effectHit", "effectResist"
]);

export function formatStatValue(stat: StatId, value: number | null | undefined, decimalPlaces = DEFAULT_DISPLAY_DECIMAL_PLACES, signed = true): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const percentage = percentageStats.has(stat);
  return `${signed && value >= 0 ? "+" : ""}${formatNumber(percentage ? value * 100 : value, decimalPlaces)}${percentage ? "%" : ""}`;
}
