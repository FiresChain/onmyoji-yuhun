import type { PerformanceRecord } from "./performance.js";

const CONSENT_KEY = "onmyoji-yuhun-telemetry-consent-v1";
const API_URL = (import.meta.env.VITE_ONMYOJI_API_URL ?? "https://api.fireschain.org").replace(/\/$/, "");

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

export function telemetryConsent(): boolean {
  return storage()?.getItem(CONSENT_KEY) === "granted";
}

export function setTelemetryConsent(enabled: boolean): void {
  const local = storage();
  if (local === null) return;
  try { local.setItem(CONSENT_KEY, enabled ? "granted" : "denied"); } catch { /* best effort */ }
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
  return telemetryConsent() ? post("/onmyoji/v1/telemetry/performance", { record }) : Promise.resolve(false);
}

export function uploadTeamTarget(target: { code: string; label: string; sceneId: string; sceneLabel: string; difficulty: number | null; metricCount: number }): Promise<boolean> {
  return telemetryConsent() ? post("/onmyoji/v1/telemetry/team-target", { target }) : Promise.resolve(false);
}

export function telemetryApiUrl(): string { return API_URL; }
