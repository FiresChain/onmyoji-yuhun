import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("coalesces concurrent codecs, releases failed work, and honors 429 without retrying", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { share: { groups: [] } } })));
  vi.stubGlobal("fetch", fetcher);
  const api = await import("./onmyoji-api.js");
  await Promise.all([api.decodeYuhunCode("same"), api.decodeYuhunCode("same")]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValue(new Response(JSON.stringify({ error: "slow down" }), { status: 429, headers: { "Retry-After": "60" } }));
  await expect(api.decodeYuhunCode("changed")).rejects.toThrow("slow down");
  await expect(api.decodeYuhunCode("changed-again")).rejects.toThrow("稍后");
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { share: { groups: [] } } })));
  await api.decodeYuhunCode("retry-manually");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
});

it("legacy hydration sends serially, spaces work and stops at the first failure", async () => {
  const { hydrateTargetInspections } = await import("./hydrate-target-inspections.js");
  const inspect = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(null);
  const run = hydrateTargetInspections([1, 2, 3, 4], inspect, () => true);
  await vi.advanceTimersByTimeAsync(2999);
  expect(inspect.mock.calls).toEqual([[1]]);
  await vi.advanceTimersByTimeAsync(1);
  await run;
  expect(inspect.mock.calls).toEqual([[1], [2]]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(inspect).toHaveBeenCalledTimes(2);
});

it("leaving the view stops remaining hydration work", async () => {
  const { hydrateTargetInspections } = await import("./hydrate-target-inspections.js");
  let active = true;
  const inspect = vi.fn().mockResolvedValue({});
  const run = hydrateTargetInspections([1, 2, 3], inspect, () => active);
  await vi.advanceTimersByTimeAsync(10);
  active = false;
  await vi.advanceTimersByTimeAsync(3000);
  await run;
  expect(inspect).toHaveBeenCalledTimes(1);
});

const snapshot = (id: string) => ({ schemaVersion: 2, scenes: [{ id, gameSceneId: null, level1: "a", level2: "b", level3: id, displayOrder: 1, status: "active" }], targets: [] });
const version = (stamp: string) => ({ schemaVersion: 1, objects: { scenes: `scenes/snapshot-${stamp}.json` } });
const json = (data: unknown) => new Response(JSON.stringify(data));

it("shares in-flight scene reads and reuses only the same immutable snapshot while following changed pointers", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(json(version("20261023T000000000Z")))
    .mockResolvedValueOnce(json(snapshot("first")))
    .mockResolvedValueOnce(json(version("20261023T000000000Z")))
    .mockResolvedValueOnce(json(version("20261023T010000000Z")))
    .mockResolvedValueOnce(json(snapshot("second")));
  vi.stubGlobal("fetch", fetcher);
  const { fetchPublishedSceneData } = await import("./target-catalog.js");
  const [a, b] = await Promise.all([fetchPublishedSceneData(), fetchPublishedSceneData()]);
  expect(a).toBe(b);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(await fetchPublishedSceneData()).toBe(a);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const updated = await fetchPublishedSceneData();
  expect(updated.catalog[0]!.categories[0]!.scenes[0]!.id).toBe("second");
  expect(fetcher).toHaveBeenCalledTimes(5);
});

it("failed scene reads can be retried and mutable development URLs are not memoized", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("missing", { status: 404 }))
    .mockResolvedValueOnce(json(snapshot("first"))).mockResolvedValueOnce(json(snapshot("second")));
  vi.stubGlobal("fetch", fetcher);
  const { fetchPublishedSceneData } = await import("./target-catalog.js");
  const url = "http://localhost/scenes.json";
  await expect(fetchPublishedSceneData(url)).rejects.toThrow("404");
  await fetchPublishedSceneData(url);
  const result = await fetchPublishedSceneData(url);
  expect(result.catalog[0]!.categories[0]!.scenes[0]!.id).toBe("second");
  expect(fetcher).toHaveBeenCalledTimes(3);
});
