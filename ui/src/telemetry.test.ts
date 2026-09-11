import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setTelemetryConsent, telemetryConsent, uploadPerformanceRecord, uploadTeamTarget } from "./telemetry.js";
import type { PerformanceRecord } from "./performance.js";

const fetchMock = vi.fn(async () => ({ ok: true }));
const target = { code: "synthetic", label: "test", sceneId: "test", sceneLabel: "test", difficulty: 1, metricCount: 1 };
const record = { id: "synthetic" } as PerformanceRecord;

beforeEach(() => { localStorage.clear(); fetchMock.mockClear(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

it("gates team and performance uploads independently and persists both choices", async () => {
  expect(await uploadTeamTarget(target)).toBe(false);
  expect(await uploadPerformanceRecord(record)).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  setTelemetryConsent("team-target", true);
  expect(telemetryConsent("team-target")).toBe(true);
  expect(telemetryConsent("performance")).toBe(false);
  expect(await uploadTeamTarget(target)).toBe(true);
  expect(await uploadPerformanceRecord(record)).toBe(false);
  setTelemetryConsent("team-target", false);
  setTelemetryConsent("performance", true);
  expect(await uploadTeamTarget(target)).toBe(false);
  expect(await uploadPerformanceRecord(record)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("inherits legacy consent while allowing either category to be disabled", () => {
  localStorage.setItem("onmyoji-yuhun-telemetry-consent-v1", "granted");
  expect(telemetryConsent("team-target")).toBe(true);
  expect(telemetryConsent("performance")).toBe(true);
  setTelemetryConsent("team-target", false);
  expect(telemetryConsent("team-target")).toBe(false);
  expect(telemetryConsent("performance")).toBe(true);
});
