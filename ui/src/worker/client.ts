import type {
  AnalysisSummaryDTO,
  AnalyzeInput,
  DecisionQuery,
  GeneratedPlanDTO,
  GeneratePlanInput,
  ImportChecklistDTO,
  InventoryQuery,
  InventoryRowDTO,
  PageDTO,
  PlanSummaryDTO,
  SimulationSummaryDTO,
  SnapshotSummaryDTO,
  SpeedCategoryDecision,
  TeamCalculationReportDTO,
  TeamCalculationRequest,
  YuhunDecisionFacetsDTO,
  YuhunDecisionQuery,
  YuhunDecisionRowDTO,
  WorkflowErrorDTO
} from "../../../src/browser.js";
import {
  teamCalculationConcurrency,
  type CalculationResourceProfile,
  type PerformanceBenchmark,
  type PerformanceResourceAllocation
} from "../performance.js";

export interface WorkerProgress {
  readonly phase: "baseline" | "simulation" | "team-calculation";
  /** ID of the lineup currently being processed, when available. */
  readonly targetId?: string;
  /** Display name of the lineup currently being processed, when available. */
  readonly targetLabel?: string;
  readonly targetIndex?: number;
  readonly targetTotal?: number;
  readonly completed: number;
  readonly total: number;
  readonly current?: string;
  readonly currentShikigamiId?: number;
  readonly detail?: string;
}

export function teamCalculationWorkerCount(
  requestCount: number,
  logicalCores = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4
): number {
  if (requestCount <= 1) return Math.max(0, requestCount);
  return teamCalculationConcurrency(requestCount, "balanced", null, logicalCores).workerCount;
}

export interface TeamCalculationSchedule {
  readonly workerCount: number;
  readonly resourceAllocation: PerformanceResourceAllocation;
}

export function resolveTeamCalculationSchedule(
  requests: readonly TeamCalculationRequest[],
  profile: CalculationResourceProfile,
  benchmark: PerformanceBenchmark | null,
  logicalCores = typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4,
  customWorkerCount: number | null = null
): TeamCalculationSchedule {
  const allocation = teamCalculationConcurrency(requests.length, profile, benchmark, logicalCores, customWorkerCount);
  return {
    ...allocation,
    workerCount: Math.min(Math.max(1, initialRunnableTaskCount(requests)), allocation.workerCount)
  };
}

interface ScheduledTeamTask {
  readonly request: TeamCalculationRequest;
  readonly targetIndex: number;
  readonly mutualSceneId: string | null;
}

interface MutualSceneQueue {
  readonly tasks: ScheduledTeamTask[];
  readonly occupiedYuhunIds: Set<string>;
}

interface TeamTaskQueues {
  readonly normal: ScheduledTeamTask[];
  readonly mutualByScene: Map<string, MutualSceneQueue>;
  readonly readyMutualSceneIds: string[];
  preferNormal: boolean;
}

function createTeamTaskQueues(requests: readonly TeamCalculationRequest[]): TeamTaskQueues {
  const normal: ScheduledTeamTask[] = [];
  const mutualByScene = new Map<string, MutualSceneQueue>();
  requests.forEach((request, targetIndex) => {
    if (request.sceneMutualExclusion === true && request.sceneId !== undefined) {
      const queue = mutualByScene.get(request.sceneId) ?? {
        tasks: [],
        occupiedYuhunIds: new Set<string>()
      };
      queue.tasks.push({ request, targetIndex, mutualSceneId: request.sceneId });
      mutualByScene.set(request.sceneId, queue);
      return;
    }
    normal.push({ request, targetIndex, mutualSceneId: null });
  });
  return {
    normal,
    mutualByScene,
    readyMutualSceneIds: [...mutualByScene.keys()],
    preferNormal: true
  };
}

function initialRunnableTaskCount(requests: readonly TeamCalculationRequest[]): number {
  const queues = createTeamTaskQueues(requests);
  return queues.normal.length + queues.readyMutualSceneIds.length;
}

function takeNextTeamTask(queues: TeamTaskQueues): ScheduledTeamTask | null {
  // Alternate between queues while both have work. This preserves FIFO within
  // each queue without starving a ready mutual-exclusion scene behind a long
  // list of independent lineups.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const takeNormal = queues.preferNormal;
    queues.preferNormal = !queues.preferNormal;
    if (takeNormal) {
      const task = queues.normal.shift();
      if (task !== undefined) return task;
      continue;
    }
    const sceneId = queues.readyMutualSceneIds.shift();
    if (sceneId === undefined) continue;
    const task = queues.mutualByScene.get(sceneId)?.tasks.shift();
    if (task !== undefined) return task;
  }
  return null;
}

function releaseMutualScene(queues: TeamTaskQueues, sceneId: string): void {
  const queue = queues.mutualByScene.get(sceneId);
  if (queue !== undefined && queue.tasks.length > 0) queues.readyMutualSceneIds.push(sceneId);
}

interface PendingRequest<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
  readonly onProgress?: (progress: WorkerProgress) => void;
  readonly onReport?: (report: TeamCalculationReportDTO) => void;
}

export class WorkflowClientError extends Error {
  constructor(readonly dto: WorkflowErrorDTO) {
    super(dto.message);
    this.name = "WorkflowClientError";
  }
}

export class WorkflowClientPausedError extends Error {
  constructor() {
    super("计算已暂停");
    this.name = "WorkflowClientPausedError";
  }
}

export class WorkflowClient {
  private worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest<unknown>>();
  /**
   * Keep a private copy of the imported snapshot so independent workers can
   * calculate different lineups at the same time. The copy never leaves the
   * browser and is transferred only to workers created by this client.
   */
  private snapshotBuffer: ArrayBuffer | null = null;
  private snapshotRestore: Promise<unknown> | null = null;
  private readonly parallelClients = new Set<WorkflowClient>();
  private pauseRequested = false;

  constructor() {
    this.worker = this.createWorker();
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL("./workflow.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (event: MessageEvent<{
      id: number;
      result?: unknown;
      report?: TeamCalculationReportDTO;
      error?: WorkflowErrorDTO;
      progress?: WorkerProgress;
    }>) => {
      const pending = this.pending.get(event.data.id);
      if (pending === undefined) return;
      if (event.data.progress !== undefined) {
        pending.onProgress?.(event.data.progress);
        return;
      }
      if (event.data.report !== undefined) {
        pending.onReport?.(event.data.report);
        return;
      }
      this.pending.delete(event.data.id);
      if (event.data.error !== undefined) pending.reject(new WorkflowClientError(event.data.error));
      else pending.resolve(event.data.result);
    });
    worker.addEventListener("error", () => {
      const error = new Error("计算 Worker 意外停止，请重新导入快照");
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    return worker;
  }

  private call<T>(method: string, args: readonly unknown[] = [], transfer: Transferable[] = [], onProgress?: (progress: WorkerProgress) => void, onReport?: (report: TeamCalculationReportDTO) => void): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        ...(onProgress === undefined ? {} : { onProgress }),
        ...(onReport === undefined ? {} : { onReport })
      });
      // Pinia/Vue wraps arrays and objects in proxies, which cannot cross the
      // structured-clone boundary. RPC inputs are JSON DTOs except the one
      // transferred snapshot buffer.
      const payloadArgs = transfer.length === 0
        ? JSON.parse(JSON.stringify(args)) as unknown[]
        : args;
      this.worker.postMessage({ id, method, args: payloadArgs }, transfer);
    });
  }

  importSnapshot(buffer: ArrayBuffer): Promise<SnapshotSummaryDTO> {
    this.snapshotBuffer = buffer.slice(0);
    return this.call("importSnapshot", [buffer], [buffer]);
  }

  analyze(input: AnalyzeInput, onProgress?: (progress: WorkerProgress) => void): Promise<AnalysisSummaryDTO> {
    return this.call("analyze", [input], [], onProgress);
  }

  queryInventory(query: InventoryQuery): Promise<PageDTO<InventoryRowDTO>> {
    return this.call("queryInventory", [query]);
  }

  queryDecisions(query: DecisionQuery): Promise<PageDTO<SpeedCategoryDecision>> {
    return this.call("queryDecisions", [query]);
  }

  queryYuhunDecisions(query: YuhunDecisionQuery): Promise<PageDTO<YuhunDecisionRowDTO>> {
    return this.call("queryYuhunDecisions", [query]);
  }

  queryYuhunDecisionFacets(): Promise<YuhunDecisionFacetsDTO> {
    return this.call("queryYuhunDecisionFacets", []);
  }

  generatePlan(input: GeneratePlanInput): Promise<GeneratedPlanDTO> {
    return this.call("generatePlan", [input]);
  }

  runSimulation(sampleSize: number, seed: number, onProgress?: (progress: WorkerProgress) => void): Promise<SimulationSummaryDTO> {
    return this.call("runSimulation", [sampleSize, seed], [], onProgress);
  }

  buildImportChecklist(): Promise<ImportChecklistDTO> {
    return this.call("buildImportChecklist");
  }

  async calculateTeamTargets(
    requests: readonly TeamCalculationRequest[],
    onProgress?: (progress: WorkerProgress) => void,
    onReport?: (report: TeamCalculationReportDTO) => void,
    schedule?: TeamCalculationSchedule
  ): Promise<readonly TeamCalculationReportDTO[]> {
    this.pauseRequested = false;
    if (this.snapshotRestore !== null) {
      await this.snapshotRestore;
      this.snapshotRestore = null;
    }
    const concurrency = schedule?.workerCount ?? teamCalculationWorkerCount(requests.length);
    if (requests.length > 1 && concurrency > 1 && this.snapshotBuffer !== null) {
      return this.calculateTeamTargetsParallel(requests, onProgress, onReport, concurrency);
    }
    return this.call("calculateTeamTargets", [requests], [], onProgress, onReport);
  }

  private async calculateTeamTargetsParallel(
    requests: readonly TeamCalculationRequest[],
    onProgress?: (progress: WorkerProgress) => void,
    onReport?: (report: TeamCalculationReportDTO) => void,
    requestedConcurrency = teamCalculationWorkerCount(requests.length)
  ): Promise<readonly TeamCalculationReportDTO[]> {
    const snapshot = this.snapshotBuffer;
    if (snapshot === null) return this.call("calculateTeamTargets", [requests], [], onProgress, onReport);

    // Independent lineups use a FIFO queue. Each mutual-exclusion scene has
    // its own FIFO queue and only releases its next lineup after the previous
    // report has contributed occupied pieces. An idle Worker can therefore
    // keep taking unrelated work instead of owning a whole scene chain.
    const reports = new Array<TeamCalculationReportDTO>(requests.length);
    const queues = createTeamTaskQueues(requests);
    const concurrency = Math.min(
      Math.max(1, initialRunnableTaskCount(requests)),
      Math.max(1, Math.floor(requestedConcurrency))
    );
    const runWorker = async (): Promise<void> => {
      const client = new WorkflowClient();
        this.parallelClients.add(client);
      try {
        const snapshotCopy = snapshot.slice(0);
        await client.importSnapshot(snapshotCopy);
        while (true) {
          const task = takeNextTeamTask(queues);
          if (task === null) return;
          const { request, targetIndex, mutualSceneId } = task;
          const mutualQueue = mutualSceneId === null ? undefined : queues.mutualByScene.get(mutualSceneId);
          const effectiveRequest = mutualQueue === undefined
            ? request
            : {
              ...request,
              occupiedYuhunIds: [...new Set([...(request.occupiedYuhunIds ?? []), ...mutualQueue.occupiedYuhunIds])]
            };
          const result = await client.calculateTeamTargets([effectiveRequest], (progress) => {
            onProgress?.({
              ...progress,
              targetId: request.id,
              targetLabel: request.label,
              targetIndex,
              targetTotal: requests.length
            });
          }, (report) => onReport?.(report));
          const report = result[0];
          if (report === undefined) throw new Error(`阵容“${request.label}”没有返回计算结果`);
          reports[targetIndex] = report;
          if (mutualQueue !== undefined && mutualSceneId !== null) {
            for (const id of report.reservedYuhunIds ?? []) mutualQueue.occupiedYuhunIds.add(id);
            releaseMutualScene(queues, mutualSceneId);
          }
        }
      } finally {
        this.parallelClients.delete(client);
        client.dispose();
      }
    };
    try {
      await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
    } catch (error) {
      for (const client of this.parallelClients) client.dispose();
      this.parallelClients.clear();
      if (this.pauseRequested) throw new WorkflowClientPausedError();
      throw error;
    }
    return reports;
  }

  getGateState(): Promise<Readonly<Record<string, boolean>>> {
    return this.call("getGateState");
  }

  resetSession(): Promise<null> {
    return this.call<null>("resetSession").then((result) => {
      this.snapshotBuffer = null;
      return result;
    });
  }

  cancelAndReset(): void {
    this.snapshotBuffer = null;
    this.snapshotRestore = null;
    for (const client of this.parallelClients) client.dispose();
    this.parallelClients.clear();
    this.worker.terminate();
    const error = new Error("计算已取消；Worker 会话已清空");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker = this.createWorker();
  }

  /** Stop active workers while retaining the imported snapshot for resume. */
  pauseAndReset(): void {
    this.pauseRequested = true;
    for (const client of this.parallelClients) client.dispose();
    this.parallelClients.clear();
    this.worker.terminate();
    for (const pending of this.pending.values()) pending.reject(new WorkflowClientPausedError());
    this.pending.clear();
    this.worker = this.createWorker();
    if (this.snapshotBuffer !== null) {
      const snapshotCopy = this.snapshotBuffer.slice(0);
      this.snapshotRestore = this.call("importSnapshot", [snapshotCopy], [snapshotCopy]);
    }
  }

  /** Stop active calculation workers, clear their state, and retain the snapshot. */
  resetTeamCalculations(): void {
    this.pauseRequested = false;
    for (const client of this.parallelClients) client.dispose();
    this.parallelClients.clear();
    this.worker.terminate();
    const error = new Error("计算已重置");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker = this.createWorker();
    if (this.snapshotBuffer !== null) {
      const snapshotCopy = this.snapshotBuffer.slice(0);
      this.snapshotRestore = this.call("importSnapshot", [snapshotCopy], [snapshotCopy]);
    }
  }

  /** Stop an auxiliary worker without creating another one. */
  private dispose(): void {
    this.worker.terminate();
    this.snapshotBuffer = null;
    const error = new Error("计算 Worker 已关闭");
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
