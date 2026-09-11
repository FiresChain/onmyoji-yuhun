import type { PerformanceRecord } from "./performance.js";

const CONSENT_KEY = "onmyoji-yuhun-telemetry-consent-v1";
export type TelemetryKind = "team-target" | "performance";
const API_URL = (import.meta.env.VITE_ONMYOJI_API_URL ?? "https://api.fireschain.org").replace(/\/$/, "");

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function storedTelemetryConsent(kind: TelemetryKind): boolean | null {
  try {
    const local = storage();
    const value = local?.getItem(`${CONSENT_KEY}:${kind}`) ?? local?.getItem(CONSENT_KEY);
    return value === "granted" ? true : value === "denied" ? false : null;
  } catch { return null; }
}

export function telemetryConsent(kind: TelemetryKind): boolean {
  return storedTelemetryConsent(kind) === true;
}

export function setTelemetryConsent(kind: TelemetryKind, enabled: boolean): boolean {
  const local = storage();
  if (local === null) return false;
  try { local.setItem(`${CONSENT_KEY}:${kind}`, enabled ? "granted" : "denied"); return true; } catch { return false; }
}

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const extra: Record<string, unknown> = body !== null && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true, ...extra })
    });
    return response.ok;
  } catch { return false; }
}

export function uploadPerformanceRecord(record: PerformanceRecord): Promise<boolean> {
  return telemetryConsent("performance") ? post("/onmyoji/v1/collect", { kind: "performance", record }) : Promise.resolve(false);
}

export function uploadTeamTarget(target: { code: string; label: string; sceneId: string; sceneLabel: string; difficulty: number | null; metricCount: number }): Promise<boolean> {
  return telemetryConsent("team-target") ? post("/onmyoji/v1/collect", { kind: "team-target", target }) : Promise.resolve(false);
}

export function telemetryApiUrl(): string { return API_URL; }
