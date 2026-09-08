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
  TeamCalculationWorkEstimate,
  YuhunDecisionFacetsDTO,
  YuhunDecisionQuery,
  YuhunDecisionRowDTO,
  WorkflowErrorDTO
} from "../../../src/browser.js";
import {
  teamCalculationConcurrency,
  type SchedulerDebugEvent,
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
  readonly debug?: (event: SchedulerDebugEvent) => void;
}

export type TeamCalculationNextRequests = (
  request: TeamCalculationRequest,
  report: TeamCalculationReportDTO
) => readonly TeamCalculationRequest[];

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
  readonly enqueuedAt: number;
  estimatedWork: number;
}

interface MutualSceneQueue {
  readonly tasks: ScheduledTeamTask[];
  readonly occupiedYuhunIds: Set<string>;
  readonly debugGroup: number;
}

interface TeamTaskQueues {
  readonly normal: ScheduledTeamTask[];
  readonly mutualByScene: Map<string, MutualSceneQueue>;
  readonly readyMutualSceneIds: string[];
  nextMutualDebugGroup: number;
}

function createTeamTaskQueues(requests: readonly TeamCalculationRequest[], estimates = new Map<string, number>()): TeamTaskQueues {
  const queues: TeamTaskQueues = {
    normal: [],
    mutualByScene: new Map<string, MutualSceneQueue>(),
    readyMutualSceneIds: [],
    nextMutualDebugGroup: 0
  };
  requests.forEach((request, targetIndex) => enqueueTeamTask(queues, request, targetIndex, estimates.get(request.id) ?? 0));
  queues.readyMutualSceneIds.push(...queues.mutualByScene.keys());
  return queues;
}

function enqueueTeamTask(queues: TeamTaskQueues, request: TeamCalculationRequest, targetIndex: number, estimatedWork = 0): ScheduledTeamTask {
  const mutualSceneId = request.sceneMutualExclusion === true && request.sceneId !== undefined ? request.sceneId : null;
  const task: ScheduledTeamTask = { request, targetIndex, mutualSceneId, enqueuedAt: schedulerNow(), estimatedWork };
  if (mutualSceneId === null) {
    queues.normal.push(task);
    return task;
  }
  const queue = queues.mutualByScene.get(mutualSceneId) ?? {
    tasks: [],
    occupiedYuhunIds: new Set<string>(),
    debugGroup: queues.nextMutualDebugGroup++
  };
  queue.tasks.push(task);
  queues.mutualByScene.set(mutualSceneId, queue);
  return task;
}

function schedulerNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function debugQueueState(queues: TeamTaskQueues, activeWorkers: number): Pick<SchedulerDebugEvent, "activeWorkers" | "normalQueueLength" | "mutualReadyQueueLength" | "pendingTaskCount"> {
  const pendingTaskCount = queues.normal.length + [...queues.mutualByScene.values()].reduce((sum, queue) => sum + queue.tasks.length, 0);
  return {
    activeWorkers,
    normalQueueLength: queues.normal.length,
    mutualReadyQueueLength: queues.readyMutualSceneIds.length,
    pendingTaskCount
  };
}

function initialRunnableTaskCount(requests: readonly TeamCalculationRequest[]): number {
  const queues = createTeamTaskQueues(requests);
  return queues.normal.length + queues.readyMutualSceneIds.length;
}

function takeNextTeamTask(queues: TeamTaskQueues): ScheduledTeamTask | null {
  // Prefer the largest search estimate so long calculations begin early and
  // short tasks fill the gaps. Mutual scenes contribute only their FIFO head:
  // their later lineups remain blocked until occupied yuhun is known.
  const bestNormal = queues.normal.reduce<ScheduledTeamTask | undefined>((best, task) => (
    best === undefined || task.estimatedWork > best.estimatedWork ||
    (task.estimatedWork === best.estimatedWork && task.targetIndex < best.targetIndex) ? task : best
  ), undefined);
  let bestMutual: ScheduledTeamTask | undefined;
  let bestMutualSceneId: string | undefined;
  for (const sceneId of queues.readyMutualSceneIds) {
    const task = queues.mutualByScene.get(sceneId)?.tasks[0];
    if (task !== undefined && (bestMutual === undefined || task.estimatedWork > bestMutual.estimatedWork ||
      (task.estimatedWork === bestMutual.estimatedWork && task.targetIndex < bestMutual.targetIndex))) {
      bestMutual = task;
      bestMutualSceneId = sceneId;
    }
  }
  if (bestNormal === undefined && bestMutual === undefined) return null;
  if (bestMutual === undefined || (bestNormal !== undefined && (bestNormal.estimatedWork > bestMutual.estimatedWork ||
    (bestNormal.estimatedWork === bestMutual.estimatedWork && bestNormal.targetIndex < bestMutual.targetIndex)))) {
    queues.normal.splice(queues.normal.indexOf(bestNormal!), 1);
    return bestNormal!;
  }
  queues.readyMutualSceneIds.splice(queues.readyMutualSceneIds.indexOf(bestMutualSceneId!), 1);
  return queues.mutualByScene.get(bestMutualSceneId!)!.tasks.shift()!;
}

function releaseMutualScene(queues: TeamTaskQueues, sceneId: string): void {
  const queue = queues.mutualByScene.get(sceneId);
  if (queue !== undefined && queue.tasks.length > 0 && !queues.readyMutualSceneIds.includes(sceneId)) queues.readyMutualSceneIds.push(sceneId);
}

async function refreshMutualQueueHeadEstimate(
  client: WorkflowClient,
  queue: MutualSceneQueue
): Promise<{ readonly task: ScheduledTeamTask; readonly previousEstimatedWork: number } | null> {
  const next = queue.tasks[0];
  if (next === undefined) return null;
  const previousEstimatedWork = next.estimatedWork;
  const effectiveRequest: TeamCalculationRequest = {
    ...next.request,
    occupiedYuhunIds: [...new Set([...(next.request.occupiedYuhunIds ?? []), ...queue.occupiedYuhunIds])]
  };
  const estimate = (await client.estimateTeamCalculationWork([effectiveRequest]))[0];
  if (estimate !== undefined) next.estimatedWork = estimate.estimatedWork;
  return { task: next, previousEstimatedWork };
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
  private readonly parallelTaskWaiters = new Set<() => void>();
  private parallelSchedulerGeneration = 0;
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

  private wakeParallelTaskWaiters(limit = Number.POSITIVE_INFINITY): void {
    let remaining = limit;
    for (const wake of [...this.parallelTaskWaiters]) {
      if (remaining <= 0) break;
      this.parallelTaskWaiters.delete(wake);
      wake();
      remaining -= 1;
    }
  }

  private interruptParallelSchedulers(): void {
    this.parallelSchedulerGeneration += 1;
    this.wakeParallelTaskWaiters();
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

  estimateTeamCalculationWork(requests: readonly TeamCalculationRequest[]): Promise<readonly TeamCalculationWorkEstimate[]> {
    return this.call("estimateTeamCalculationWork", [requests]);
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
      return this.calculateTeamTargetsParallel(requests, onProgress, onReport, concurrency, schedule);
    }
    if (schedule?.debug !== undefined) return this.calculateTeamTargetsSingle(requests, onProgress, onReport, schedule);
    return this.call("calculateTeamTargets", [requests], [], onProgress, onReport);
  }

  async calculateTeamTargetsDynamically(
    initialRequests: readonly TeamCalculationRequest[],
    nextRequests: TeamCalculationNextRequests,
    onProgress?: (progress: WorkerProgress) => void,
    onReport?: (report: TeamCalculationReportDTO) => void,
    schedule?: TeamCalculationSchedule
  ): Promise<readonly TeamCalculationReportDTO[]> {
    this.pauseRequested = false;
    if (this.snapshotRestore !== null) {
      await this.snapshotRestore;
      this.snapshotRestore = null;
    }
    if (initialRequests.length === 0) return [];
    const snapshot = this.snapshotBuffer;
    if (snapshot === null) throw new Error("请先导入游戏快照");
    const requestedConcurrency = schedule?.workerCount ?? teamCalculationWorkerCount(initialRequests.length);
    return this.calculateTeamTargetsDynamicallyParallel(
      initialRequests,
      nextRequests,
      onProgress,
      onReport,
      Math.max(1, Math.floor(requestedConcurrency)),
      schedule,
      snapshot
    );
  }

  private async calculateTeamTargetsDynamicallyParallel(
    initialRequests: readonly TeamCalculationRequest[],
    nextRequests: TeamCalculationNextRequests,
    onProgress: ((progress: WorkerProgress) => void) | undefined,
    onReport: ((report: TeamCalculationReportDTO) => void) | undefined,
    requestedConcurrency: number,
    schedule: TeamCalculationSchedule | undefined,
    snapshot: ArrayBuffer
  ): Promise<readonly TeamCalculationReportDTO[]> {
    // Smart selection can reveal a follow-up lineup after any scene finishes.
    // Keep initialized workers alive while other scenes are still deciding
    // whether they need to add more work.
    const debug = schedule?.debug;
    const debugStartedAt = schedulerNow();
    const atMs = (timestamp = schedulerNow()): number => Math.max(0, timestamp - debugStartedAt);
    const reports: TeamCalculationReportDTO[] = [];
    const initialEstimates = await this.estimateTeamCalculationWork(initialRequests);
    const estimateByRequestId = new Map(initialEstimates.map((estimate) => [estimate.requestId, estimate.estimatedWork]));
    const queues = createTeamTaskQueues(initialRequests, estimateByRequestId);
    const concurrency = Math.min(
      Math.max(1, queues.normal.length + queues.readyMutualSceneIds.length),
      requestedConcurrency
    );
    const schedulerGeneration = this.parallelSchedulerGeneration;
    let nextTargetIndex = initialRequests.length;
    let activeWorkers = 0;
    let activeTaskCount = 0;

    const queueState = (): Pick<SchedulerDebugEvent, "activeWorkers" | "normalQueueLength" | "mutualReadyQueueLength" | "pendingTaskCount"> => debugQueueState(queues, activeWorkers);
    const emitQueued = (task: ScheduledTeamTask, timestamp = schedulerNow()): void => {
      const mutualQueue = task.mutualSceneId === null ? undefined : queues.mutualByScene.get(task.mutualSceneId);
      debug?.({
        atMs: atMs(timestamp),
        type: "task-queued",
        targetIndex: task.targetIndex,
        queueType: task.mutualSceneId === null ? "normal" : "mutual",
        sceneGroup: mutualQueue?.debugGroup,
        estimatedWork: task.estimatedWork,
        ...queueState()
      });
    };
    const runnableTaskCount = (): number => queues.normal.length + queues.readyMutualSceneIds.length;
    const assertSchedulerActive = (): void => {
      if (schedulerGeneration !== this.parallelSchedulerGeneration) throw new Error("计算已重置");
    };
    const takeTaskOrWait = async (workerId: number): Promise<ScheduledTeamTask | null> => {
      let idleRecorded = false;
      while (true) {
        assertSchedulerActive();
        const task = takeNextTeamTask(queues);
        if (task !== null) return task;
        if (!idleRecorded) {
          debug?.({ atMs: atMs(), type: "worker-idle", workerId, ...queueState() });
          idleRecorded = true;
        }
        if (activeTaskCount === 0) return null;
        await new Promise<void>((resolve) => this.parallelTaskWaiters.add(resolve));
      }
    };

    debug?.({ atMs: 0, type: "batch-start", ...queueState() });
    for (const task of [...queues.normal, ...[...queues.mutualByScene.values()].flatMap((queue) => queue.tasks)].sort((left, right) => left.targetIndex - right.targetIndex)) {
      emitQueued(task, debugStartedAt);
    }

    const runWorker = async (workerId: number): Promise<void> => {
      const client = new WorkflowClient();
      this.parallelClients.add(client);
      try {
        const snapshotCopy = snapshot.slice(0);
        await client.importSnapshot(snapshotCopy);
        debug?.({ atMs: atMs(), type: "worker-start", workerId, ...queueState() });
        while (true) {
          const task = await takeTaskOrWait(workerId);
          if (task === null) return;
          const { request, targetIndex, mutualSceneId } = task;
          const mutualQueue = mutualSceneId === null ? undefined : queues.mutualByScene.get(mutualSceneId);
          const startedAt = schedulerNow();
          activeTaskCount += 1;
          activeWorkers += 1;
          debug?.({
            atMs: atMs(startedAt),
            type: "task-start",
            workerId,
            targetIndex,
            queueType: mutualSceneId === null ? "normal" : "mutual",
            sceneGroup: mutualQueue?.debugGroup,
            estimatedWork: task.estimatedWork,
            queueWaitMs: Math.max(0, startedAt - task.enqueuedAt),
            ...queueState()
          });
          const effectiveRequest = mutualQueue === undefined
            ? request
            : {
              ...request,
              occupiedYuhunIds: [...new Set([...(request.occupiedYuhunIds ?? []), ...mutualQueue.occupiedYuhunIds])]
            };
          try {
            const result = await client.calculateTeamTargets([effectiveRequest], (progress) => {
              onProgress?.({
                ...progress,
                targetId: request.id,
                targetLabel: request.label,
                targetIndex,
                targetTotal: initialRequests.length
              });
            });
            const report = result[0];
            if (report === undefined) throw new Error(`阵容“${request.label}”没有返回计算结果`);
            reports.push(report);
            const completedAt = schedulerNow();
            activeWorkers = Math.max(0, activeWorkers - 1);
            debug?.({
              atMs: atMs(completedAt),
              type: "task-complete",
              workerId,
              targetIndex,
              queueType: mutualSceneId === null ? "normal" : "mutual",
              sceneGroup: mutualQueue?.debugGroup,
              estimatedWork: task.estimatedWork,
              runMs: Math.max(0, completedAt - startedAt),
              ...queueState()
            });
            if (mutualQueue !== undefined && mutualSceneId !== null) {
              for (const id of report.reservedYuhunIds ?? []) mutualQueue.occupiedYuhunIds.add(id);
            }
            onReport?.(report);

            const runnableBefore = runnableTaskCount();
            const followUps = nextRequests(request, report);
            const followUpEstimates = followUps.length === 0 ? [] : await this.estimateTeamCalculationWork(followUps);
            for (const [index, followUp] of followUps.entries()) {
              const estimate = followUpEstimates[index]?.estimatedWork ?? 0;
              emitQueued(enqueueTeamTask(queues, followUp, nextTargetIndex++, estimate), completedAt);
            }
            let mutualReleased = false;
            if (mutualSceneId !== null) {
              if (mutualQueue !== undefined) {
                const refreshed = await refreshMutualQueueHeadEstimate(client, mutualQueue);
                if (refreshed !== null && refreshed.previousEstimatedWork !== refreshed.task.estimatedWork) {
                  debug?.({
                    atMs: atMs(),
                    type: "task-reestimated",
                    targetIndex: refreshed.task.targetIndex,
                    queueType: "mutual",
                    sceneGroup: mutualQueue.debugGroup,
                    estimatedWork: refreshed.task.estimatedWork,
                    ...queueState()
                  });
                }
              }
              const wasReady = queues.readyMutualSceneIds.includes(mutualSceneId);
              releaseMutualScene(queues, mutualSceneId);
              mutualReleased = !wasReady && queues.readyMutualSceneIds.includes(mutualSceneId);
            }
            if (mutualReleased && mutualQueue !== undefined) {
              debug?.({
                atMs: atMs(completedAt),
                type: "mutual-release",
                workerId,
                targetIndex,
                queueType: "mutual",
                sceneGroup: mutualQueue.debugGroup,
                ...queueState()
              });
            }
            const newlyRunnable = Math.max(0, runnableTaskCount() - runnableBefore);
            activeTaskCount = Math.max(0, activeTaskCount - 1);
            // The completing worker immediately takes one available task; wake
            // only the additional waiting workers needed for the rest.
            this.wakeParallelTaskWaiters(Math.max(0, newlyRunnable - 1));
            if (activeTaskCount === 0 && runnableTaskCount() === 0) this.wakeParallelTaskWaiters();
          } catch (error) {
            activeWorkers = Math.max(0, activeWorkers - 1);
            activeTaskCount = Math.max(0, activeTaskCount - 1);
            this.wakeParallelTaskWaiters();
            throw error;
          }
        }
      } finally {
        this.parallelClients.delete(client);
        client.dispose();
      }
    };

    try {
      await Promise.all(Array.from({ length: concurrency }, (_, workerIndex) => runWorker(workerIndex + 1)));
    } catch (error) {
      this.interruptParallelSchedulers();
      for (const client of this.parallelClients) client.dispose();
      this.parallelClients.clear();
      if (this.pauseRequested) throw new WorkflowClientPausedError();
      throw error;
    }
    debug?.({ atMs: atMs(), type: "batch-complete", ...queueState() });
    return reports;
  }

  private async calculateTeamTargetsSingle(
    requests: readonly TeamCalculationRequest[],
    onProgress: ((progress: WorkerProgress) => void) | undefined,
    onReport: ((report: TeamCalculationReportDTO) => void) | undefined,
    schedule: TeamCalculationSchedule
  ): Promise<readonly TeamCalculationReportDTO[]> {
    const debug = schedule.debug;
    if (debug === undefined) return this.call("calculateTeamTargets", [requests], [], onProgress, onReport);

    const debugStartedAt = schedulerNow();
    const atMs = (timestamp = schedulerNow()): number => Math.max(0, timestamp - debugStartedAt);
    const queues = createTeamTaskQueues(requests);
    const tasks = [...queues.normal, ...[...queues.mutualByScene.values()].flatMap((queue) => queue.tasks)]
      .sort((left, right) => left.targetIndex - right.targetIndex);
    let nextTaskIndex = 0;
    let activeWorkers = 0;
    let taskStartedAt = 0;

    const queueState = (firstPendingIndex = nextTaskIndex): Pick<SchedulerDebugEvent, "activeWorkers" | "normalQueueLength" | "mutualReadyQueueLength" | "pendingTaskCount"> => {
      const pending = tasks.slice(firstPendingIndex);
      return {
        activeWorkers,
        normalQueueLength: pending.filter((task) => task.mutualSceneId === null).length,
        mutualReadyQueueLength: new Set(pending.flatMap((task) => task.mutualSceneId === null ? [] : [task.mutualSceneId])).size,
        pendingTaskCount: pending.length
      };
    };
    const emit = (event: Omit<SchedulerDebugEvent, "atMs">, timestamp?: number): void => {
      debug({ atMs: atMs(timestamp), ...event });
    };
    const startTask = (): void => {
      const task = tasks[nextTaskIndex];
      if (task === undefined) return;
      taskStartedAt = schedulerNow();
      activeWorkers = 1;
      const mutualQueue = task.mutualSceneId === null ? undefined : queues.mutualByScene.get(task.mutualSceneId);
      emit({
        type: "task-start",
        workerId: 1,
        targetIndex: task.targetIndex,
        queueType: task.mutualSceneId === null ? "normal" : "mutual",
        sceneGroup: mutualQueue?.debugGroup,
        queueWaitMs: Math.max(0, taskStartedAt - task.enqueuedAt),
        ...queueState(nextTaskIndex + 1)
      }, taskStartedAt);
    };

    emit({ type: "batch-start", ...queueState() }, debugStartedAt);
    for (const task of tasks) {
      const mutualQueue = task.mutualSceneId === null ? undefined : queues.mutualByScene.get(task.mutualSceneId);
      emit({
        type: "task-queued",
        targetIndex: task.targetIndex,
        queueType: task.mutualSceneId === null ? "normal" : "mutual",
        sceneGroup: mutualQueue?.debugGroup,
        ...queueState()
      }, debugStartedAt);
    }
    emit({ type: "worker-start", workerId: 1, ...queueState() });
    startTask();
    try {
      const reports = await this.call<readonly TeamCalculationReportDTO[]>("calculateTeamTargets", [requests], [], onProgress, (report) => {
        const task = tasks[nextTaskIndex];
        const completedAt = schedulerNow();
        if (task !== undefined) {
          const mutualQueue = task.mutualSceneId === null ? undefined : queues.mutualByScene.get(task.mutualSceneId);
          activeWorkers = 0;
          nextTaskIndex += 1;
          emit({
            type: "task-complete",
            workerId: 1,
            targetIndex: task.targetIndex,
            queueType: task.mutualSceneId === null ? "normal" : "mutual",
            sceneGroup: mutualQueue?.debugGroup,
            runMs: Math.max(0, completedAt - taskStartedAt),
            ...queueState()
          }, completedAt);
          if (mutualQueue !== undefined && task.mutualSceneId !== null && tasks.slice(nextTaskIndex).some((pending) => pending.mutualSceneId === task.mutualSceneId)) {
            emit({
              type: "mutual-release",
              workerId: 1,
              targetIndex: task.targetIndex,
              queueType: "mutual",
              sceneGroup: mutualQueue.debugGroup,
              ...queueState()
            }, completedAt);
          }
          startTask();
        }
        onReport?.(report);
      });
      activeWorkers = 0;
      emit({ type: "worker-idle", workerId: 1, ...queueState() });
      emit({ type: "batch-complete", ...queueState() });
      return reports;
    } catch (error) {
      activeWorkers = 0;
      throw error;
    }
  }

  private async calculateTeamTargetsParallel(
    requests: readonly TeamCalculationRequest[],
    onProgress?: (progress: WorkerProgress) => void,
    onReport?: (report: TeamCalculationReportDTO) => void,
    requestedConcurrency = teamCalculationWorkerCount(requests.length),
    schedule?: TeamCalculationSchedule
  ): Promise<readonly TeamCalculationReportDTO[]> {
    const snapshot = this.snapshotBuffer;
    if (snapshot === null) return this.call("calculateTeamTargets", [requests], [], onProgress, onReport);

    // Independent lineups use a workload-priority queue. Each mutual-exclusion
    // scene contributes only its FIFO head and releases the next lineup after
    // the previous report has contributed occupied pieces.
    const debug = schedule?.debug;
    const debugStartedAt = schedulerNow();
    const atMs = (timestamp = schedulerNow()): number => Math.max(0, timestamp - debugStartedAt);
    const reports = new Array<TeamCalculationReportDTO>(requests.length);
    const estimates = await this.estimateTeamCalculationWork(requests);
    const estimateByRequestId = new Map(estimates.map((estimate) => [estimate.requestId, estimate.estimatedWork]));
    const queues = createTeamTaskQueues(requests, estimateByRequestId);
    const concurrency = Math.min(
      Math.max(1, queues.normal.length + queues.readyMutualSceneIds.length),
      Math.max(1, Math.floor(requestedConcurrency))
    );
    debug?.({
      atMs: 0,
      type: "batch-start",
      ...debugQueueState(queues, 0)
    });
    for (const task of [...queues.normal, ...[...queues.mutualByScene.values()].flatMap((queue) => queue.tasks)].sort((left, right) => left.targetIndex - right.targetIndex)) {
      debug?.({
        atMs: 0,
        type: "task-queued",
        targetIndex: task.targetIndex,
        queueType: task.mutualSceneId === null ? "normal" : "mutual",
        sceneGroup: task.mutualSceneId === null ? undefined : queues.mutualByScene.get(task.mutualSceneId)?.debugGroup,
        estimatedWork: task.estimatedWork,
        ...debugQueueState(queues, 0)
      });
    }
    let activeWorkers = 0;
    const runWorker = async (workerId: number): Promise<void> => {
      const client = new WorkflowClient();
      this.parallelClients.add(client);
      try {
        const snapshotCopy = snapshot.slice(0);
        await client.importSnapshot(snapshotCopy);
        debug?.({ atMs: atMs(), type: "worker-start", workerId, ...debugQueueState(queues, activeWorkers) });
        while (true) {
          const task = takeNextTeamTask(queues);
          if (task === null) {
            debug?.({ atMs: atMs(), type: "worker-idle", workerId, ...debugQueueState(queues, activeWorkers) });
            return;
          }
          const { request, targetIndex, mutualSceneId } = task;
          const mutualQueue = mutualSceneId === null ? undefined : queues.mutualByScene.get(mutualSceneId);
          const queuedAt = task.enqueuedAt;
          const startedAt = schedulerNow();
          activeWorkers += 1;
          debug?.({
            atMs: atMs(startedAt),
            type: "task-start",
            workerId,
            targetIndex,
            queueType: mutualSceneId === null ? "normal" : "mutual",
            sceneGroup: mutualQueue?.debugGroup,
            estimatedWork: task.estimatedWork,
            queueWaitMs: Math.max(0, startedAt - queuedAt),
            ...debugQueueState(queues, activeWorkers)
          });
          const effectiveRequest = mutualQueue === undefined
            ? request
            : {
              ...request,
              occupiedYuhunIds: [...new Set([...(request.occupiedYuhunIds ?? []), ...mutualQueue.occupiedYuhunIds])]
            };
          try {
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
            const completedAt = schedulerNow();
            activeWorkers = Math.max(0, activeWorkers - 1);
            debug?.({
              atMs: atMs(completedAt),
              type: "task-complete",
              workerId,
              targetIndex,
              queueType: mutualSceneId === null ? "normal" : "mutual",
              sceneGroup: mutualQueue?.debugGroup,
              estimatedWork: task.estimatedWork,
              runMs: Math.max(0, completedAt - startedAt),
              ...debugQueueState(queues, activeWorkers)
            });
            if (mutualQueue !== undefined && mutualSceneId !== null) {
              for (const id of report.reservedYuhunIds ?? []) mutualQueue.occupiedYuhunIds.add(id);
              const refreshed = await refreshMutualQueueHeadEstimate(client, mutualQueue);
              if (refreshed !== null && refreshed.previousEstimatedWork !== refreshed.task.estimatedWork) {
                debug?.({
                  atMs: atMs(),
                  type: "task-reestimated",
                  targetIndex: refreshed.task.targetIndex,
                  queueType: "mutual",
                  sceneGroup: mutualQueue.debugGroup,
                  estimatedWork: refreshed.task.estimatedWork,
                  ...debugQueueState(queues, activeWorkers)
                });
              }
              const releasedNextTask = mutualQueue.tasks.length > 0;
              releaseMutualScene(queues, mutualSceneId);
              if (releasedNextTask) {
                debug?.({
                  atMs: atMs(completedAt),
                  type: "mutual-release",
                  workerId,
                  targetIndex,
                  queueType: "mutual",
                  sceneGroup: mutualQueue.debugGroup,
                  ...debugQueueState(queues, activeWorkers)
                });
              }
            }
          } catch (error) {
            activeWorkers = Math.max(0, activeWorkers - 1);
            throw error;
          }
        }
      } finally {
        this.parallelClients.delete(client);
        client.dispose();
      }
    };
    try {
      await Promise.all(Array.from({ length: concurrency }, (_, workerIndex) => runWorker(workerIndex + 1)));
    } catch (error) {
      for (const client of this.parallelClients) client.dispose();
      this.parallelClients.clear();
      if (this.pauseRequested) throw new WorkflowClientPausedError();
      throw error;
    }
    debug?.({ atMs: atMs(), type: "batch-complete", ...debugQueueState(queues, activeWorkers) });
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
    this.interruptParallelSchedulers();
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
    this.interruptParallelSchedulers();
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
    this.interruptParallelSchedulers();
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
