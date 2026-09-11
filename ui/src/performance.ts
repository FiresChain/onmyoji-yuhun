export type PerformanceOperation = "team-calculation" | "analysis" | "simulation";

export interface PerformanceStageTiming {
  readonly name: string;
  readonly elapsedMs: number;
}

export interface PerformanceTargetTiming {
  readonly index: number;
  readonly elapsedMs: number;
  readonly candidateCount: number;
  readonly candidateCombinations: number;
  readonly evaluatedCombinations: number;
  readonly exact: boolean | null;
  readonly stageTimings: readonly PerformanceStageTiming[];
}

export interface PerformanceDeviceInfo {
  readonly logicalCores: number | null;
  readonly memoryGiB: number | null;
  readonly platform: string | null;
  readonly browserName: string | null;
  readonly browserMajorVersion: string | null;
  readonly wasm: boolean;
  readonly webGpu: boolean;
  readonly gpuAdapter: string | null;
  readonly gpuMaxBufferSize: number | null;
  readonly gpuMaxComputeInvocationsPerWorkgroup: number | null;
  readonly gpuMaxComputeWorkgroupsPerDimension: number | null;
  readonly crossOriginIsolated: boolean;
}

export interface PerformanceGpuInfo {
  readonly adapter: string | null;
  readonly maxBufferSize: number | null;
  readonly maxComputeInvocationsPerWorkgroup: number | null;
  readonly maxComputeWorkgroupsPerDimension: number | null;
}

export interface PerformanceCpuBenchmark {
  readonly id: "cpu-yuhun-search-js-v1";
  readonly durationMs: number;
  readonly evaluatedCombinations: number;
  readonly evaluationsPerSecond: number;
  readonly checksum: number;
}

/** Measured aggregate CPU throughput for one specific number of Workers. */
export interface PerformanceCpuParallelSample extends PerformanceCpuBenchmark {
  readonly workerCount: number;
}

export interface PerformanceMemoryBenchmark {
  readonly id: "memory-f64-stream-v1";
  readonly durationMs: number;
  readonly bytesProcessed: number;
  readonly mebibytesPerSecond: number;
  readonly checksum: number;
}

export interface PerformanceBenchmark {
  readonly id: "onmyoji-hardware-profile-v1" | "onmyoji-hardware-profile-v2";
  readonly measuredAt: string;
  readonly environmentKey: string;
  readonly totalDurationMs: number;
  readonly cpuSingle: PerformanceCpuBenchmark;
  readonly cpuMulti: PerformanceCpuBenchmark;
  readonly cpuMultiWorkerCount: number;
  readonly cpuParallelSpeedup: number;
  /** v2 measures each lane count, so scheduling can use actual browser throughput. */
  readonly cpuParallelSamples: readonly PerformanceCpuParallelSample[];
  readonly memory: PerformanceMemoryBenchmark;
  readonly gpu: PerformanceGpuBenchmark;
}

export type CalculationResourceProfile = "light" | "balanced" | "performance" | "custom";

export interface CalculationResourceProfileDefinition {
  readonly id: CalculationResourceProfile;
  readonly label: string;
  readonly targetCapacityRatio: number;
}

export const CALCULATION_RESOURCE_PROFILES: readonly CalculationResourceProfileDefinition[] = [
  { id: "light", label: "轻量 30%", targetCapacityRatio: 0.3 },
  { id: "balanced", label: "平衡 50%", targetCapacityRatio: 0.5 },
  { id: "performance", label: "性能 70%", targetCapacityRatio: 0.7 },
  { id: "custom", label: "自定义", targetCapacityRatio: 0 }
];

export interface PerformanceResourceAllocation {
  readonly profile: CalculationResourceProfile;
  readonly targetCapacityRatio: number;
  readonly source: "benchmark" | "logical-core-estimate" | "custom";
  readonly benchmarkPeakEvaluationsPerSecond: number | null;
  readonly targetEvaluationsPerSecond: number | null;
  readonly estimatedCapacityRatio: number | null;
}

export interface PerformanceGpuBenchmark {
  readonly id: "gpu-f32-compute-v1";
  readonly measuredAt: string;
  readonly status: "completed" | "unavailable" | "failed";
  readonly initializationMs: number | null;
  readonly durationMs: number | null;
  readonly elementsPerDispatch: number;
  readonly iterationsPerElement: number;
  readonly dispatches: number;
  readonly iterationsPerSecond: number | null;
  readonly uploadMebibytesPerSecond: number | null;
  readonly readbackMebibytesPerSecond: number | null;
  readonly verified: boolean;
  readonly reason: string | null;
}

export interface PerformanceSchedulerInfo {
  readonly id: "workflow-worker-lanes-v1" | "workflow-worker-lanes-v2";
  readonly mode: "single-worker" | "parallel-workloads";
  readonly workerCount: number;
  /** Null for operations that do not schedule independent team workloads. */
  readonly resourceAllocation: PerformanceResourceAllocation | null;
}

export type SchedulerDebugEventType = "batch-start" | "worker-start" | "task-queued" | "task-reestimated" | "task-start" | "task-complete" | "mutual-release" | "worker-idle" | "batch-complete";

export interface SchedulerDebugEvent {
  readonly atMs: number;
  readonly type: SchedulerDebugEventType;
  readonly workerId?: number;
  readonly targetIndex?: number;
  readonly queueType?: "normal" | "mutual";
  /** Anonymous ordinal for one mutual-exclusion scene within a run. */
  readonly sceneGroup?: number | undefined;
  readonly queueWaitMs?: number;
  readonly runMs?: number;
  readonly estimatedWork?: number;
  readonly activeWorkers?: number;
  readonly normalQueueLength?: number;
  readonly mutualReadyQueueLength?: number;
  readonly pendingTaskCount?: number;
}

export interface SchedulerDebugLog {
  readonly schemaVersion: 1;
  readonly kind: "onmyoji-yuhun-scheduler-debug";
  readonly recordedAt: string;
  readonly resourceProfile: CalculationResourceProfile;
  readonly requestedWorkerCount: number;
  readonly requestCount: number;
  readonly events: readonly SchedulerDebugEvent[];
  /** Number of events omitted after reaching the in-memory limit. */
  readonly droppedEventCount: number;
}

export interface AnalysisDiagnosticSummary {
  readonly itemCount: number;
  readonly level15Count: number;
  readonly level0SampleCount: number;
  readonly templateCount: number;
  readonly categoryCount: number;
  readonly observedCategoryCount: number;
  readonly ruleCount: number;
  readonly teamReportCount: number;
  readonly teamEntityCount: number;
  readonly potentialEvidenceCount: number;
  readonly potentialYuhunCount: number;
  readonly tier1CandidateCount: number;
  readonly tier1MaximumCoverage: number;
  readonly tier1TransitionCount: number;
  readonly tier1UpdatedStateCount: number;
  readonly stages: readonly PerformanceStageTiming[];
}

/** Privacy-safe diagnostics export shared by performance and scheduler tools. */
export interface DiagnosticsExport {
  readonly schemaVersion: 1;
  readonly kind: "onmyoji-yuhun-diagnostics-export";
  readonly exportedAt: string;
  readonly benchmark: PerformanceBenchmark | null;
  readonly records: readonly PerformanceRecord[];
  readonly schedulerLog: SchedulerDebugLog | null;
}

export interface ImportedDiagnostics {
  readonly sourceKind: "unified" | "performance" | "scheduler";
  readonly exportedAt: string;
  readonly benchmark: PerformanceBenchmark | null;
  readonly records: readonly PerformanceRecord[];
  readonly schedulerLog: SchedulerDebugLog | null;
}

const SCHEDULER_DEBUG_MAX_EVENTS = 5_000;
let schedulerDebugLog: SchedulerDebugLog | null = null;

export function beginSchedulerDebugLog(resourceProfile: CalculationResourceProfile, requestedWorkerCount: number, requestCount: number): void {
  schedulerDebugLog = {
    schemaVersion: 1,
    kind: "onmyoji-yuhun-scheduler-debug",
    recordedAt: new Date().toISOString(),
    resourceProfile,
    requestedWorkerCount,
    requestCount,
    events: [],
    droppedEventCount: 0
  };
}

export function appendSchedulerDebugEvent(event: SchedulerDebugEvent): void {
  if (schedulerDebugLog === null) return;
  schedulerDebugLog = schedulerDebugLog.events.length >= SCHEDULER_DEBUG_MAX_EVENTS
    ? {
      ...schedulerDebugLog,
      events: [...schedulerDebugLog.events.slice(1), event],
      droppedEventCount: schedulerDebugLog.droppedEventCount + 1
    }
    : { ...schedulerDebugLog, events: [...schedulerDebugLog.events, event] };
  if (typeof console !== "undefined") console.debug("[onmyoji-yuhun][scheduler]", event);
}

export function getSchedulerDebugLog(): SchedulerDebugLog | null {
  return schedulerDebugLog;
}

export function parseDiagnosticsExport(value: unknown): ImportedDiagnostics | null {
  if (!isRecord(value)) return null;
  const benchmark = normalizePerformanceBenchmark(value.benchmark);
  if (value.kind === "onmyoji-yuhun-diagnostics-export" && value.schemaVersion === 1) {
    const records = Array.isArray(value.records) ? value.records.flatMap((entry) => normalizeRecord(entry)) : [];
    const schedulerLog = normalizeSchedulerDebugLog(value.schedulerLog);
    return { sourceKind: "unified", exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "", benchmark, records, schedulerLog };
  }
  if (value.kind === "onmyoji-yuhun-performance-export") {
    const records = Array.isArray(value.records) ? value.records.flatMap((entry) => normalizeRecord(entry)) : [];
    return { sourceKind: "performance", exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "", benchmark, records, schedulerLog: null };
  }
  if (value.kind === "onmyoji-yuhun-scheduler-debug-export" && isRecord(value.log)) {
    const schedulerLog = normalizeSchedulerDebugLog(value.log);
    if (schedulerLog === null) return null;
    return { sourceKind: "scheduler", exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "", benchmark, records: [], schedulerLog };
  }
  return null;
}

export function clearSchedulerDebugLog(): void {
  schedulerDebugLog = null;
}

export interface PerformanceRecord {
  readonly schemaVersion: 4;
  readonly kind: "onmyoji-yuhun-performance";
  readonly id: string;
  readonly recordedAt: string;
  readonly operation: PerformanceOperation;
  readonly itemCount: number | null;
  readonly targetCount: number | null;
  readonly metricCount: number | null;
  readonly categoryCount: number | null;
  readonly sampleSize: number | null;
  readonly candidateCount: number;
  readonly candidateCombinations: number;
  readonly evaluatedCombinations: number;
  readonly successfulCount: number;
  readonly noMatchCount: number;
  readonly unsupportedCount: number;
  readonly disabledCount: number;
  readonly exactCount: number;
  readonly approximateCount: number;
  readonly elapsedMs: number;
  readonly stages: readonly PerformanceStageTiming[];
  readonly targets: readonly PerformanceTargetTiming[];
  readonly device: PerformanceDeviceInfo;
  readonly benchmark: PerformanceBenchmark | null;
  /** Reserved for a future D1/API sync without changing the local schema. */
  readonly uploadState: "local-only";
  readonly algorithm: {
    readonly id: string;
    readonly runtime: "typescript" | "wasm" | "webgpu";
    readonly parameters: Readonly<Record<string, string | number | boolean>>;
    readonly workerCount: number;
  };
  readonly scheduler: PerformanceSchedulerInfo;
  readonly app: { readonly version: string; readonly buildId: string | null };
  readonly evaluatedPerSecond: number | null;
  readonly endToEndEvaluatedPerSecond: number | null;
  readonly pruningRate: number | null;
  readonly searchElapsedMs: number;
  readonly targetElapsedMs: number;
  readonly criticalPathMs: number;
  readonly overheadMs: number;
  /** Anonymous input-shape key for comparing like-for-like runs. */
  readonly workloadKey: string;
  readonly metricDistribution: Readonly<Record<string, number>>;
  /** Present only when the performance-diagnostics switch was enabled. */
  readonly analysisDiagnostics?: AnalysisDiagnosticSummary;
}

const STORAGE_KEY = "onmyoji-yuhun-performance-history-v1";
const BENCHMARK_STORAGE_KEY = "onmyoji-yuhun-performance-benchmark-v3";
const GPU_STORAGE_KEY = "onmyoji-yuhun-performance-gpu-v1";
const RESOURCE_PROFILE_STORAGE_KEY = "onmyoji-yuhun-calculation-resource-profile-v1";
const CUSTOM_WORKER_COUNT_STORAGE_KEY = "onmyoji-yuhun-calculation-worker-count-v1";
const SCHEDULER_DEBUG_STORAGE_KEY = "onmyoji-yuhun-calculation-scheduler-debug-v1";
const MAX_RECORDS = 20;
const BENCHMARK_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSchedulerDebugLog(value: unknown): SchedulerDebugLog | null {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== "onmyoji-yuhun-scheduler-debug"
    || typeof value.recordedAt !== "string"
    || !isCalculationResourceProfile(value.resourceProfile)
    || !isNonNegativeInteger(value.requestedWorkerCount)
    || value.requestedWorkerCount < 1
    || !isNonNegativeInteger(value.requestCount)
    || !isNonNegativeInteger(value.droppedEventCount)
    || !Array.isArray(value.events)) return null;
  const events = value.events.flatMap((event) => normalizeSchedulerDebugEvent(event));
  if (events.length !== value.events.length) return null;
  return {
    schemaVersion: 1,
    kind: "onmyoji-yuhun-scheduler-debug",
    recordedAt: value.recordedAt,
    resourceProfile: value.resourceProfile,
    requestedWorkerCount: value.requestedWorkerCount,
    requestCount: value.requestCount,
    events,
    droppedEventCount: value.droppedEventCount
  };
}

function normalizeSchedulerDebugEvent(value: unknown): SchedulerDebugEvent[] {
  const eventTypes: readonly SchedulerDebugEventType[] = [
    "batch-start", "worker-start", "task-queued", "task-reestimated", "task-start",
    "task-complete", "mutual-release", "worker-idle", "batch-complete"
  ];
  if (!isRecord(value)
    || typeof value.atMs !== "number"
    || !Number.isFinite(value.atMs)
    || value.atMs < 0
    || !eventTypes.includes(value.type as SchedulerDebugEventType)) return [];
  const numberField = (field: string): number | undefined =>
    typeof value[field] === "number" && Number.isFinite(value[field]) && value[field] >= 0
      ? value[field]
      : undefined;
  const workerId = numberField("workerId");
  const targetIndex = numberField("targetIndex");
  const sceneGroup = numberField("sceneGroup");
  const queueWaitMs = numberField("queueWaitMs");
  const runMs = numberField("runMs");
  const estimatedWork = numberField("estimatedWork");
  const activeWorkers = numberField("activeWorkers");
  const normalQueueLength = numberField("normalQueueLength");
  const mutualReadyQueueLength = numberField("mutualReadyQueueLength");
  const pendingTaskCount = numberField("pendingTaskCount");
  const queueType = value.queueType === "normal" || value.queueType === "mutual" ? value.queueType : undefined;
  return [{
    atMs: value.atMs,
    type: value.type as SchedulerDebugEventType,
    ...(workerId === undefined ? {} : { workerId }),
    ...(targetIndex === undefined ? {} : { targetIndex }),
    ...(queueType === undefined ? {} : { queueType }),
    ...(sceneGroup === undefined ? {} : { sceneGroup }),
    ...(queueWaitMs === undefined ? {} : { queueWaitMs }),
    ...(runMs === undefined ? {} : { runMs }),
    ...(estimatedWork === undefined ? {} : { estimatedWork }),
    ...(activeWorkers === undefined ? {} : { activeWorkers }),
    ...(normalQueueLength === undefined ? {} : { normalQueueLength }),
    ...(mutualReadyQueueLength === undefined ? {} : { mutualReadyQueueLength }),
    ...(pendingTaskCount === undefined ? {} : { pendingTaskCount })
  }];
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizeDevice(value: unknown): PerformanceDeviceInfo {
  const device = isRecord(value) ? value : {};
  return {
    logicalCores: typeof device.logicalCores === "number" ? device.logicalCores : null,
    memoryGiB: typeof device.memoryGiB === "number" ? device.memoryGiB : null,
    platform: typeof device.platform === "string" ? device.platform : null,
    browserName: typeof device.browserName === "string" ? device.browserName : null,
    browserMajorVersion: typeof device.browserMajorVersion === "string" ? device.browserMajorVersion : null,
    wasm: device.wasm === true,
    webGpu: device.webGpu === true,
    gpuAdapter: typeof device.gpuAdapter === "string" ? device.gpuAdapter : null,
    gpuMaxBufferSize: typeof device.gpuMaxBufferSize === "number" ? device.gpuMaxBufferSize : null,
    gpuMaxComputeInvocationsPerWorkgroup: typeof device.gpuMaxComputeInvocationsPerWorkgroup === "number" ? device.gpuMaxComputeInvocationsPerWorkgroup : null,
    gpuMaxComputeWorkgroupsPerDimension: typeof device.gpuMaxComputeWorkgroupsPerDimension === "number" ? device.gpuMaxComputeWorkgroupsPerDimension : null,
    crossOriginIsolated: device.crossOriginIsolated === true
  };
}

export function loadPerformanceHistory(): PerformanceRecord[] {
  const local = storage();
  if (local === null) return [];
  try {
    const parsed: unknown = JSON.parse(local.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const records = parsed.flatMap((value) => normalizeRecord(value)).slice(0, MAX_RECORDS);
    if (parsed.length > MAX_RECORDS) {
      try { local.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* best effort */ }
    }
    return records;
  } catch {
    return [];
  }
}

function normalizeRecord(value: unknown): PerformanceRecord[] {
  if (!isRecord(value) || value.kind !== "onmyoji-yuhun-performance") return [];
  if (value.schemaVersion === 4 || value.schemaVersion === 3) {
    const workerCount = isRecord(value.algorithm) && typeof value.algorithm.workerCount === "number"
      ? value.algorithm.workerCount
      : 1;
    return [{
      ...(value as unknown as PerformanceRecord),
      schemaVersion: 4,
      device: normalizeDevice(value.device),
      benchmark: normalizePerformanceBenchmark(value.benchmark),
      scheduler: normalizeScheduler(value.scheduler, workerCount)
    }];
  }
  if (value.schemaVersion === 2) {
    const legacy = value as unknown as Omit<PerformanceRecord, "schemaVersion" | "benchmark" | "scheduler">;
    const workerCount = isRecord(value.algorithm) && typeof value.algorithm.workerCount === "number"
      ? value.algorithm.workerCount
      : 1;
    return [{
      ...legacy,
      schemaVersion: 4,
      device: normalizeDevice(value.device),
      benchmark: null,
      scheduler: normalizeScheduler(value.scheduler, workerCount)
    }];
  }
  // Migrate the initial local-only schema so users do not lose history after an update.
  if (value.schemaVersion !== 1) return [];
  const candidateCombinations = typeof value.candidateCombinations === "number" ? value.candidateCombinations : 0;
  const evaluatedCombinations = typeof value.evaluatedCombinations === "number" ? value.evaluatedCombinations : 0;
  const elapsedMs = typeof value.elapsedMs === "number" ? value.elapsedMs : 0;
  const targets = Array.isArray(value.targets) ? value.targets.map((target) => ({ ...target, stageTimings: [] })) : [];
  const targetElapsedMs = targets.reduce((sum, target) => sum + (typeof target.elapsedMs === "number" ? target.elapsedMs : 0), 0);
  return [{
    ...(value as unknown as Omit<PerformanceRecord, "schemaVersion" | "algorithm" | "app" | "evaluatedPerSecond" | "endToEndEvaluatedPerSecond" | "pruningRate" | "searchElapsedMs" | "targetElapsedMs" | "criticalPathMs" | "overheadMs" | "targets" | "noMatchCount" | "unsupportedCount" | "disabledCount" | "exactCount" | "workloadKey" | "metricDistribution" | "benchmark" | "scheduler">),
    schemaVersion: 4,
    device: normalizeDevice(value.device),
    targets,
    algorithm: { id: "legacy-v1", runtime: "typescript", parameters: {}, workerCount: 1 },
    scheduler: schedulerInfo(1),
    benchmark: null,
    app: { version: "unknown", buildId: null },
    evaluatedPerSecond: elapsedMs > 0 ? evaluatedCombinations / (elapsedMs / 1000) : null,
    endToEndEvaluatedPerSecond: elapsedMs > 0 ? evaluatedCombinations / (elapsedMs / 1000) : null,
    pruningRate: candidateCombinations > 0 ? Math.max(0, Math.min(1, 1 - evaluatedCombinations / candidateCombinations)) : null,
    searchElapsedMs: 0,
    targetElapsedMs,
    criticalPathMs: targetElapsedMs,
    overheadMs: Math.max(0, elapsedMs - targetElapsedMs),
    noMatchCount: 0,
    unsupportedCount: 0,
    disabledCount: 0,
    exactCount: 0,
    workloadKey: "legacy-v1",
    metricDistribution: {}
  }];
}

export function appendPerformanceRecord(record: PerformanceRecord): PerformanceRecord[] {
  const next = [record, ...loadPerformanceHistory()].slice(0, MAX_RECORDS);
  const local = storage();
  if (local !== null) {
    try { local.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* local history is best effort */ }
  }
  return next;
}

export function clearPerformanceHistory(): void {
  const local = storage();
  if (local === null) return;
  try { local.removeItem(STORAGE_KEY); } catch { /* local history is best effort */ }
}

function normalizePerformanceBenchmark(value: unknown): PerformanceBenchmark | null {
  if (!isRecord(value)
    || (value.id !== "onmyoji-hardware-profile-v1" && value.id !== "onmyoji-hardware-profile-v2")
    || typeof value.measuredAt !== "string"
    || typeof value.environmentKey !== "string"
    || typeof value.totalDurationMs !== "number"
    || !isRecord(value.cpuSingle)
    || !isRecord(value.cpuMulti)
    || !isRecord(value.memory)
    || normalizeGpuBenchmark(value.gpu) === null
    || typeof value.cpuMultiWorkerCount !== "number"
    || typeof value.cpuParallelSpeedup !== "number") return null;
  const cpuParallelSamples = Array.isArray(value.cpuParallelSamples)
    ? value.cpuParallelSamples.flatMap((sample) => normalizeCpuParallelSample(sample))
    : [];
  if (value.id === "onmyoji-hardware-profile-v2" && cpuParallelSamples.length === 0) return null;
  return {
    ...(value as unknown as Omit<PerformanceBenchmark, "cpuParallelSamples">),
    cpuParallelSamples
  };
}

function normalizeCpuParallelSample(value: unknown): PerformanceCpuParallelSample[] {
  if (!isRecord(value)
    || value.id !== "cpu-yuhun-search-js-v1"
    || typeof value.workerCount !== "number"
    || !Number.isSafeInteger(value.workerCount)
    || value.workerCount < 1
    || typeof value.durationMs !== "number"
    || typeof value.evaluatedCombinations !== "number"
    || typeof value.evaluationsPerSecond !== "number"
    || typeof value.checksum !== "number") return [];
  return [value as unknown as PerformanceCpuParallelSample];
}

function normalizeGpuBenchmark(value: unknown): PerformanceGpuBenchmark | null {
  if (!isRecord(value)
    || value.id !== "gpu-f32-compute-v1"
    || typeof value.measuredAt !== "string"
    || !["completed", "unavailable", "failed"].includes(String(value.status))
    || typeof value.elementsPerDispatch !== "number"
    || typeof value.iterationsPerElement !== "number"
    || typeof value.dispatches !== "number") return null;
  return value as unknown as PerformanceGpuBenchmark;
}

function loadStored<T>(key: string, normalize: (value: unknown) => T | null): T | null {
  const local = storage();
  if (local === null) return null;
  try { return normalize(JSON.parse(local.getItem(key) ?? "null")); } catch { return null; }
}

export function loadPerformanceBenchmark(): PerformanceBenchmark | null {
  const value = loadStored(BENCHMARK_STORAGE_KEY, normalizePerformanceBenchmark);
  if (value === null || typeof navigator === "undefined") return value;
  const measuredAt = Date.parse(value.measuredAt);
  const fresh = Number.isFinite(measuredAt) && Date.now() - measuredAt >= 0 && Date.now() - measuredAt < BENCHMARK_MAX_AGE_MS;
  return fresh
    && value.id === "onmyoji-hardware-profile-v2"
    && value.cpuParallelSamples.length > 0
    && value.environmentKey === performanceEnvironmentKey(capturePerformanceDevice())
    ? value
    : null;
}

export function savePerformanceBenchmark(value: PerformanceBenchmark): void {
  const local = storage();
  if (local === null) return;
  try { local.setItem(BENCHMARK_STORAGE_KEY, JSON.stringify(value)); } catch { /* local benchmark is best effort */ }
}

function loadPerformanceGpu(): PerformanceGpuInfo | null {
  const local = storage();
  if (local === null) return null;
  try {
    const value: unknown = JSON.parse(local.getItem(GPU_STORAGE_KEY) ?? "null");
    if (!isRecord(value)) return null;
    return {
      adapter: typeof value.adapter === "string" ? value.adapter : null,
      maxBufferSize: typeof value.maxBufferSize === "number" ? value.maxBufferSize : null,
      maxComputeInvocationsPerWorkgroup: typeof value.maxComputeInvocationsPerWorkgroup === "number" ? value.maxComputeInvocationsPerWorkgroup : null,
      maxComputeWorkgroupsPerDimension: typeof value.maxComputeWorkgroupsPerDimension === "number" ? value.maxComputeWorkgroupsPerDimension : null
    };
  } catch {
    return null;
  }
}

export function savePerformanceGpu(value: PerformanceGpuInfo | null): void {
  const local = storage();
  if (local === null) return;
  try {
    if (value === null) local.removeItem(GPU_STORAGE_KEY);
    else local.setItem(GPU_STORAGE_KEY, JSON.stringify(value));
  } catch { /* local capability data is best effort */ }
}

function normalizeResourceAllocation(value: unknown): PerformanceResourceAllocation | null {
  if (!isRecord(value)
    || !isCalculationResourceProfile(value.profile)
    || typeof value.targetCapacityRatio !== "number"
    || (value.source !== "benchmark" && value.source !== "logical-core-estimate" && value.source !== "custom")) return null;
  return {
    profile: value.profile,
    targetCapacityRatio: value.targetCapacityRatio,
    source: value.source,
    benchmarkPeakEvaluationsPerSecond: typeof value.benchmarkPeakEvaluationsPerSecond === "number" ? value.benchmarkPeakEvaluationsPerSecond : null,
    targetEvaluationsPerSecond: typeof value.targetEvaluationsPerSecond === "number" ? value.targetEvaluationsPerSecond : null,
    estimatedCapacityRatio: typeof value.estimatedCapacityRatio === "number" ? value.estimatedCapacityRatio : null
  };
}

function normalizeScheduler(value: unknown, fallbackWorkerCount: number): PerformanceSchedulerInfo {
  if (!isRecord(value)) return schedulerInfo(fallbackWorkerCount);
  const workerCount = typeof value.workerCount === "number" ? value.workerCount : fallbackWorkerCount;
  return schedulerInfo(workerCount, normalizeResourceAllocation(value.resourceAllocation));
}

export function schedulerInfo(workerCount: number, resourceAllocation: PerformanceResourceAllocation | null = null): PerformanceSchedulerInfo {
  const normalizedWorkerCount = Math.max(1, Math.floor(workerCount));
  return {
    id: resourceAllocation === null ? "workflow-worker-lanes-v1" : "workflow-worker-lanes-v2",
    mode: normalizedWorkerCount > 1 ? "parallel-workloads" : "single-worker",
    workerCount: normalizedWorkerCount,
    resourceAllocation
  };
}

function isCalculationResourceProfile(value: unknown): value is CalculationResourceProfile {
  return value === "light" || value === "balanced" || value === "performance" || value === "custom";
}

export function calculationResourceProfileDefinition(profile: CalculationResourceProfile): CalculationResourceProfileDefinition {
  return CALCULATION_RESOURCE_PROFILES.find((definition) => definition.id === profile) ?? CALCULATION_RESOURCE_PROFILES[1]!;
}

export function loadCalculationResourceProfile(): CalculationResourceProfile {
  const local = storage();
  if (local === null) return "balanced";
  try {
    const value = local.getItem(RESOURCE_PROFILE_STORAGE_KEY);
    return isCalculationResourceProfile(value) ? value : "balanced";
  } catch {
    return "balanced";
  }
}

export function saveCalculationResourceProfile(profile: CalculationResourceProfile): void {
  const local = storage();
  if (local === null) return;
  try { local.setItem(RESOURCE_PROFILE_STORAGE_KEY, profile); } catch { /* best effort */ }
}

export function loadCustomWorkerCount(): number | null {
  const local = storage();
  if (local === null) return null;
  try {
    const value = Number(local.getItem(CUSTOM_WORKER_COUNT_STORAGE_KEY));
    return Number.isSafeInteger(value) && value >= 1 && value <= 64 ? value : null;
  } catch {
    return null;
  }
}

export function saveCustomWorkerCount(workerCount: number | null): void {
  const local = storage();
  if (local === null) return;
  try {
    if (workerCount === null) local.removeItem(CUSTOM_WORKER_COUNT_STORAGE_KEY);
    else local.setItem(CUSTOM_WORKER_COUNT_STORAGE_KEY, String(Math.max(1, Math.min(64, Math.floor(workerCount)))));
  } catch { /* best effort */ }
}

export function loadSchedulerDebugEnabled(): boolean {
  const local = storage();
  if (local === null) return false;
  try { return local.getItem(SCHEDULER_DEBUG_STORAGE_KEY) === "enabled"; } catch { return false; }
}

export function saveSchedulerDebugEnabled(enabled: boolean): void {
  const local = storage();
  if (local === null) return;
  try { local.setItem(SCHEDULER_DEBUG_STORAGE_KEY, enabled ? "enabled" : "disabled"); } catch { /* best effort */ }
}

export interface TeamCalculationConcurrency {
  readonly workerCount: number;
  readonly resourceAllocation: PerformanceResourceAllocation;
}

/**
 * Select the smallest measured lane count that reaches the selected share of
 * this browser's measured peak. A smaller lane count leaves more capacity for
 * the browser UI and other tabs while meeting the user's chosen target.
 */
export function teamCalculationConcurrency(
  requestCount: number,
  profile: CalculationResourceProfile,
  benchmark: PerformanceBenchmark | null,
  logicalCores = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4,
  customWorkerCount: number | null = null
): TeamCalculationConcurrency {
  const definition = calculationResourceProfileDefinition(profile);
  const cappedRequestCount = Math.max(1, Math.floor(requestCount));
  if (profile === "custom") {
    const workerCount = Math.min(cappedRequestCount, Math.min(64, Math.max(1, Math.floor(customWorkerCount ?? 1))));
    return {
      workerCount,
      resourceAllocation: {
        profile,
        targetCapacityRatio: definition.targetCapacityRatio,
        source: "custom",
        benchmarkPeakEvaluationsPerSecond: benchmark?.cpuParallelSamples.length
          ? Math.max(...benchmark.cpuParallelSamples.map((sample) => sample.evaluationsPerSecond))
          : null,
        targetEvaluationsPerSecond: null,
        estimatedCapacityRatio: benchmark?.cpuMultiWorkerCount
          ? workerCount / benchmark.cpuMultiWorkerCount
          : null
      }
    };
  }
  const samples = benchmark?.cpuParallelSamples
    .filter((sample) => sample.evaluationsPerSecond > 0)
    .sort((left, right) => left.workerCount - right.workerCount) ?? [];
  const availableSamples = samples.filter((sample) => sample.workerCount <= cappedRequestCount);
  if (samples.length > 0 && availableSamples.length > 0) {
    const peak = Math.max(...samples.map((sample) => sample.evaluationsPerSecond));
    const target = peak * definition.targetCapacityRatio;
    const selected = availableSamples.find((sample) => sample.evaluationsPerSecond >= target)
      ?? availableSamples.reduce((best, sample) => sample.evaluationsPerSecond > best.evaluationsPerSecond ? sample : best);
    return {
      workerCount: selected.workerCount,
      resourceAllocation: {
        profile,
        targetCapacityRatio: definition.targetCapacityRatio,
        source: "benchmark",
        benchmarkPeakEvaluationsPerSecond: peak,
        targetEvaluationsPerSecond: Math.round(target),
        estimatedCapacityRatio: peak > 0 ? selected.evaluationsPerSecond / peak : null
      }
    };
  }

  const maximumWorkers = Math.max(1, Math.min(8, Math.floor(logicalCores)));
  const workerCount = Math.min(cappedRequestCount, Math.max(1, Math.ceil(maximumWorkers * definition.targetCapacityRatio)));
  return {
    workerCount,
    resourceAllocation: {
      profile,
      targetCapacityRatio: definition.targetCapacityRatio,
      source: "logical-core-estimate",
      benchmarkPeakEvaluationsPerSecond: null,
      targetEvaluationsPerSecond: null,
      estimatedCapacityRatio: workerCount / maximumWorkers
    }
  };
}

export function performanceEnvironmentKey(device: PerformanceDeviceInfo): string {
  return [
    device.platform ?? "unknown-platform",
    `${device.browserName ?? "unknown-browser"}:${device.browserMajorVersion ?? "unknown-version"}`,
    `cores:${device.logicalCores ?? "unknown"}`,
    `memory:${device.memoryGiB ?? "unknown"}`,
    `gpu:${device.gpuAdapter ?? (device.webGpu ? "webgpu" : "none")}`
  ].join("|");
}

function browserIdentity(userAgent: string): Pick<PerformanceDeviceInfo, "browserName" | "browserMajorVersion"> {
  const matches: ReadonlyArray<readonly [string, RegExp]> = [
    ["Edge", /Edg\/(\d+)/],
    ["Firefox", /Firefox\/(\d+)/],
    ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
    ["Safari", /Version\/(\d+).+Safari/]
  ];
  for (const [name, pattern] of matches) {
    const match = pattern.exec(userAgent);
    if (match !== null) return { browserName: name, browserMajorVersion: match[1] ?? null };
  }
  return { browserName: null, browserMajorVersion: null };
}

export function capturePerformanceDevice(): PerformanceDeviceInfo {
  if (typeof navigator === "undefined") {
    return { logicalCores: null, memoryGiB: null, platform: null, browserName: null, browserMajorVersion: null, wasm: false, webGpu: false, gpuAdapter: null, gpuMaxBufferSize: null, gpuMaxComputeInvocationsPerWorkgroup: null, gpuMaxComputeWorkgroupsPerDimension: null, crossOriginIsolated: false };
  }
  const extendedNavigator = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  const browser = browserIdentity(navigator.userAgent ?? "");
  const gpu = loadPerformanceGpu();
  return {
    logicalCores: Number.isSafeInteger(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null,
    memoryGiB: typeof extendedNavigator.deviceMemory === "number" && Number.isFinite(extendedNavigator.deviceMemory)
      ? extendedNavigator.deviceMemory
      : null,
    platform: typeof navigator.platform === "string" && navigator.platform !== "" ? navigator.platform : null,
    ...browser,
    wasm: typeof WebAssembly !== "undefined",
    webGpu: extendedNavigator.gpu !== undefined,
    gpuAdapter: gpu?.adapter ?? null,
    gpuMaxBufferSize: gpu?.maxBufferSize ?? null,
    gpuMaxComputeInvocationsPerWorkgroup: gpu?.maxComputeInvocationsPerWorkgroup ?? null,
    gpuMaxComputeWorkgroupsPerDimension: gpu?.maxComputeWorkgroupsPerDimension ?? null,
    crossOriginIsolated: typeof crossOriginIsolated === "boolean" && crossOriginIsolated
  };
}

export function newPerformanceId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const PERFORMANCE_STORAGE_KEY = STORAGE_KEY;
export const PERFORMANCE_BENCHMARK_STORAGE_KEY = BENCHMARK_STORAGE_KEY;
