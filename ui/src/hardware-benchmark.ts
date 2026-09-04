import { runGpuBenchmark } from "./gpu-benchmark.js";
import {
  capturePerformanceDevice,
  loadPerformanceBenchmark,
  performanceEnvironmentKey,
  savePerformanceBenchmark,
  savePerformanceGpu,
  type PerformanceBenchmark,
  type PerformanceCpuBenchmark,
  type PerformanceDeviceInfo,
  type PerformanceMemoryBenchmark
} from "./performance.js";

type WorkerBenchmark = PerformanceCpuBenchmark | PerformanceMemoryBenchmark;
let activeBenchmark: Promise<PerformanceBenchmark> | null = null;

export async function inspectPerformanceDevice(): Promise<PerformanceDeviceInfo> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{
    info?: { description?: string; device?: string; vendor?: string };
    limits?: {
      maxBufferSize?: number;
      maxComputeInvocationsPerWorkgroup?: number;
      maxComputeWorkgroupsPerDimension?: number;
    };
  } | null> } }).gpu;
  if (gpu === undefined) {
    savePerformanceGpu(null);
    return capturePerformanceDevice();
  }
  try {
    const adapter = await gpu.requestAdapter();
    const info = adapter?.info;
    const name = info?.description || info?.device || info?.vendor || "WebGPU 适配器";
    savePerformanceGpu(adapter === null ? null : {
      adapter: name,
      maxBufferSize: adapter.limits?.maxBufferSize ?? null,
      maxComputeInvocationsPerWorkgroup: adapter.limits?.maxComputeInvocationsPerWorkgroup ?? null,
      maxComputeWorkgroupsPerDimension: adapter.limits?.maxComputeWorkgroupsPerDimension ?? null
    });
  } catch {
    savePerformanceGpu(null);
  }
  return capturePerformanceDevice();
}

function runWorkerBenchmark<T extends WorkerBenchmark>(kind: "cpu" | "memory", durationMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL("./worker/performance.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<T>) => {
      worker.terminate();
      resolve(event.data);
    }, { once: true });
    worker.addEventListener("error", () => {
      worker.terminate();
      reject(new Error("性能测试 Worker 运行失败"));
    }, { once: true });
    worker.postMessage({ kind, durationMs });
  });
}

async function executePerformanceBenchmark(device: PerformanceDeviceInfo): Promise<PerformanceBenchmark> {
  const startedAt = performance.now();
  const cpuSingle = await runWorkerBenchmark<PerformanceCpuBenchmark>("cpu", 900);
  const memory = await runWorkerBenchmark<PerformanceMemoryBenchmark>("memory", 450);
  const cpuMultiWorkerCount = Math.max(1, Math.min(8, device.logicalCores ?? 2));
  const cpuWorkers = await Promise.all(Array.from(
    { length: cpuMultiWorkerCount },
    () => runWorkerBenchmark<PerformanceCpuBenchmark>("cpu", 900)
  ));
  const multiDurationMs = Math.max(...cpuWorkers.map((value) => value.durationMs));
  const multiEvaluations = cpuWorkers.reduce((sum, value) => sum + value.evaluatedCombinations, 0);
  const cpuMulti: PerformanceCpuBenchmark = {
    id: "cpu-yuhun-search-js-v1",
    durationMs: multiDurationMs,
    evaluatedCombinations: multiEvaluations,
    evaluationsPerSecond: Math.round(multiEvaluations / (multiDurationMs / 1_000)),
    checksum: cpuWorkers.reduce((sum, value) => sum + value.checksum, 0)
  };
  const gpu = await runGpuBenchmark(900);
  const result: PerformanceBenchmark = {
    id: "onmyoji-hardware-profile-v1",
    measuredAt: new Date().toISOString(),
    environmentKey: performanceEnvironmentKey(device),
    totalDurationMs: performance.now() - startedAt,
    cpuSingle,
    cpuMulti,
    cpuMultiWorkerCount,
    cpuParallelSpeedup: cpuSingle.evaluationsPerSecond > 0
      ? cpuMulti.evaluationsPerSecond / cpuSingle.evaluationsPerSecond
      : 0,
    memory,
    gpu
  };
  savePerformanceBenchmark(result);
  return result;
}

export async function runPerformanceBenchmark(): Promise<PerformanceBenchmark> {
  if (activeBenchmark !== null) return activeBenchmark;
  activeBenchmark = inspectPerformanceDevice().then(executePerformanceBenchmark);
  try { return await activeBenchmark; } finally { activeBenchmark = null; }
}

export async function ensurePerformanceBenchmark(): Promise<PerformanceBenchmark> {
  const device = await inspectPerformanceDevice();
  const current = loadPerformanceBenchmark();
  if (current !== null) return current;
  if (activeBenchmark !== null) return activeBenchmark;
  activeBenchmark = executePerformanceBenchmark(device);
  try { return await activeBenchmark; } finally { activeBenchmark = null; }
}
