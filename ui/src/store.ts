import { computed, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import type {
  AnalysisSummaryDTO,
  AnalysisRuleInput,
  GeneratedPlanDTO,
  ImportChecklistDTO,
  InventoryRowDTO,
  PageDTO,
  PlanSummaryDTO,
  SimulationSummaryDTO,
  SnapshotSummaryDTO,
  SpeedCategoryDecision,
  StatId,
  SubStatCount,
  StaticRetentionPolicy,
  ManualShikigamiCalculationInput,
  FilterCriteria,
  TeamCalculationReportDTO,
  TeamCalculationRequest,
  TeamCalculationYuhunDTO,
  TeamCodeInspectionDTO,
  YuhunDecisionFacetsDTO,
  YuhunDecisionRowDTO,
  WorkflowErrorDTO
} from "../../src/browser.js";
import {
  assertProjectPrivacy,
  buildHandoff,
  buildSceneDataExport,
  copyText,
  deleteWorkbenchSession,
  deleteLocalProject,
  downloadCsv,
  downloadJson,
  loadWorkbenchSession,
  loadProject,
  parseHandoff,
  saveProject,
  saveWorkbenchSession,
  type MobileHandoffV1,
  type SavedProjectV1,
  type SceneDataExportV1,
  type WorkbenchSessionV1,
  type WorkbenchViewStateV1
} from "./persistence.js";
import { filterShareFromDraft } from "../../src/browser.js";
import { findTargetScene, localCatalogOverlay, mergePublishedCatalog, targetScenePaths, TARGET_CATALOG, type TargetDomain } from "./target-catalog.js";
import { WorkflowClient, WorkflowClientError, WorkflowClientPausedError, resolveTeamCalculationSchedule, type WorkerProgress } from "./worker/client.js";
import {
  appendPerformanceRecord,
  capturePerformanceDevice,
  clearPerformanceHistory,
  appendSchedulerDebugEvent,
  beginSchedulerDebugLog,
  clearSchedulerDebugLog,
  getSchedulerDebugLog,
  loadCustomWorkerCount,
  loadCalculationResourceProfile,
  loadPerformanceBenchmark,
  loadPerformanceHistory,
  loadSchedulerDebugEnabled,
  newPerformanceId,
  saveCalculationResourceProfile,
  saveCustomWorkerCount,
  saveSchedulerDebugEnabled,
  schedulerInfo,
  type CalculationResourceProfile,
  type PerformanceOperation,
  type PerformanceRecord,
  type PerformanceSchedulerInfo,
  type PerformanceStageTiming,
  type PerformanceTargetTiming,
  type AnalysisDiagnosticSummary,
  type SchedulerDebugEvent,
  type SchedulerDebugLog
} from "./performance.js";
import { TEAM_CALCULATION_ALGORITHM_VERSION, TEAM_CALCULATION_SEARCH_DEFAULTS } from "../../src/browser.js";
import { ensurePerformanceBenchmark } from "./hardware-benchmark.js";
import { uploadPerformanceRecord, uploadTeamTarget } from "./telemetry.js";
import { decodeTeamCode, decodeYuhunCode, encodeYuhunDraft } from "./onmyoji-api.js";

export interface ImportedTeamTarget {
  readonly id: string;
  readonly source: "team-code" | "manual";
  readonly code?: string;
  readonly manualTargets?: readonly ManualShikigamiCalculationInput[];
  readonly label: string;
  readonly sceneId: string;
  readonly sceneLabel: string;
  /** Relative difficulty used to order and progressively relax team targets. */
  readonly difficulty: number | null;
  /** Smart mode calculates this lineup before ordinary difficulty fallback. */
  readonly forceCalculate?: boolean;
  readonly enabled: boolean;
  readonly metricCount: number;
  readonly inspection: TeamCodeInspectionDTO | null;
  readonly builtIn?: boolean;
  readonly locked?: boolean;
}

export type TeamCalculationRunStatus = "pending" | "running" | "completed" | "error";

export interface TeamCalculationProgressState {
  readonly targetId: string;
  readonly targetLabel: string;
  readonly status: TeamCalculationRunStatus;
  readonly completed: number;
  readonly total: number;
  readonly current: string | null;
  readonly currentShikigamiId?: number | null;
  readonly detail: string | null;
}

export interface TeamCalculationRunOptions {
  readonly mode?: "manual" | "smart";
  readonly sceneIds?: readonly string[];
  readonly difficultyDecreaseCount?: "auto" | number;
}

export interface SmartTeamTargetGroup {
  readonly sceneId: string;
  readonly targets: readonly ImportedTeamTarget[];
}

export function buildSmartTeamTargetGroups(
  targets: readonly ImportedTeamTarget[],
  sceneIds: readonly string[],
  difficultyDecreaseCount: "auto" | number
): SmartTeamTargetGroup[] {
  const attemptLimit = difficultyDecreaseCount === "auto"
    ? Number.POSITIVE_INFINITY
    : Math.max(1, difficultyDecreaseCount);
  return [...new Set(sceneIds)].flatMap((sceneId) => {
    const candidates = targets
      .map((target, index) => ({ target, index }))
      .filter(({ target }) => target.sceneId === sceneId)
      .sort((left, right) => {
        const leftForced = left.target.forceCalculate === true;
        const rightForced = right.target.forceCalculate === true;
        if (leftForced !== rightForced) return leftForced ? -1 : 1;
        if (leftForced) return left.index - right.index;
        const leftDifficulty = left.target.difficulty ?? -Infinity;
        const rightDifficulty = right.target.difficulty ?? -Infinity;
        return rightDifficulty - leftDifficulty || left.index - right.index;
      });
    const forced = candidates.filter(({ target }) => target.forceCalculate === true);
    const ordinary = candidates.filter(({ target }) => target.forceCalculate !== true).slice(0, attemptLimit);
    const ordered = [...forced, ...ordinary]
      .map(({ target }) => target);
    return ordered.length === 0 ? [] : [{ sceneId, targets: ordered }];
  });
}

export function teamCalculationMeetsTargetScore(report: TeamCalculationReportDTO): boolean {
  const activeEntities = report.entities.filter((entity) => entity.status !== "disabled");
  return activeEntities.length > 0 && activeEntities.every((entity) => {
    if (entity.status !== "success" || entity.score === null) return false;
    const targetScore = entity.targetScoreRaw;
    const roundedScore = Math.round((entity.score + Number.EPSILON) * 100) / 100;
    return targetScore === null || targetScore === undefined
      ? true
      : typeof targetScore === "number" && Number.isFinite(targetScore) && roundedScore >= targetScore;
  });
}

export function teamDifficultyFromLabel(label: string): number | null {
  const match = label.match(/(?:^|[^0-9])([0-9]{1,3})\s*s(?![a-z])/i);
  if (match === null) return null;
  const seconds = Number(match[1]);
  return Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 99 ? 100 - seconds : null;
}

export type PresetRulePool = "discard" | "enhance";

export interface PresetRuleInput {
  readonly pool: PresetRulePool;
  readonly label: string;
  readonly suits: readonly string[];
  readonly positions: readonly number[];
  readonly mainStats: readonly StatId[];
  readonly requiredSubStats: readonly StatId[];
  readonly subStatCounts: readonly SubStatCount[];
  /** Full filter-code criteria retained for imported rules. */
  readonly filter?: FilterCriteria;
  readonly source?: PresetRuleSource;
}

export interface PresetRule extends PresetRuleInput {
  readonly id: string;
  readonly enabled: boolean;
}

const DEFAULT_POLICY: StaticRetentionPolicy = {
  id: "technical-draft-v1",
  confirmed: true,
  protectedSuitIds: [],
  retainInitialCountsBelowFour: false,
  retainedMainStats: [],
  retainedIntrinsicStats: [],
  fourLineSubStatCombinations: []
};

function builtInTeamTargets(): ImportedTeamTarget[] {
  // Published lineups are loaded from the R2 snapshot on the targets page.
  // Never ship a fallback team code in the public application bundle.
  return [];
}

export interface PresetRuleSource {
  readonly code: string;
  readonly groupIndex: number;
  readonly headerHex: string;
}

function messageFor(error: unknown): WorkflowErrorDTO {
  if (error instanceof WorkflowClientError) return error.dto;
  return {
    stage: "analysis",
    code: "UI_FAILURE",
    path: null,
    message: error instanceof Error ? error.message : "操作失败"
  };
}

export const useWorkbenchStore = defineStore("workbench", () => {
  const client = new WorkflowClient();
  const performanceHistory = ref<readonly PerformanceRecord[]>(loadPerformanceHistory());
  const teamCalculationResourceProfile = ref<CalculationResourceProfile>(loadCalculationResourceProfile());
  const customTeamCalculationWorkerCount = ref<number | null>(loadCustomWorkerCount());
  const teamCalculationSchedulerDebugEnabled = ref(loadSchedulerDebugEnabled());
  const teamCalculationSchedulerDebugLog = ref<SchedulerDebugLog | null>(getSchedulerDebugLog());
  const snapshot = ref<SnapshotSummaryDTO | null>(null);
  const analysis = ref<AnalysisSummaryDTO | null>(null);
  const inventory = ref<PageDTO<InventoryRowDTO> | null>(null);
  const decisions = ref<PageDTO<SpeedCategoryDecision> | null>(null);
  const yuhunDecisions = ref<PageDTO<YuhunDecisionRowDTO> | null>(null);
  const yuhunDecisionFacets = ref<YuhunDecisionFacetsDTO | null>(null);
  const teamTargets = ref<ImportedTeamTarget[]>(builtInTeamTargets());
  const teamCalculations = shallowRef<readonly TeamCalculationReportDTO[]>([]);
  const teamCalculationProgress = ref<Record<string, TeamCalculationProgressState>>({});
  const presetRules = ref<PresetRule[]>([]);
  const plan = ref<PlanSummaryDTO | null>(null);
  const simulation = ref<SimulationSummaryDTO | null>(null);
  const checklist = ref<ImportChecklistDTO | null>(null);
  const mobileHandoff = ref<MobileHandoffV1 | null>(null);
  const gateState = ref<Readonly<Record<string, boolean>>>({});
  const actuals = ref<Record<string, string>>({});
  const targetViewState = ref<WorkbenchViewStateV1 | null>(null);
  const targetCatalog = ref<readonly TargetDomain[]>(TARGET_CATALOG);
  const sceneDataImportRevision = ref(0);
  const templateIds = ref<Array<"zhaocai-speed" | "scattered-speed">>(["zhaocai-speed", "scattered-speed"]);
  const riskTier = ref<"tier0" | "tier1">("tier1");
  const defaultDisposition = ref<"retain" | "discard">("retain");
  const budgetPerTenThousand = ref(1);
  const staticPolicy = ref<StaticRetentionPolicy>({ ...DEFAULT_POLICY });
  const existingFilterCode = ref("");
  const busy = ref<string | null>(null);
  const progress = ref<WorkerProgress | null>(null);
  const error = ref<WorkflowErrorDTO | null>(null);
  const notice = ref<string | null>(null);
  const teamCalculationPaused = ref(false);
  const restoring = ref(false);
  const restoreCompleted = ref(false);
  let rawSnapshotBuffer: ArrayBuffer | null = null;
  let snapshotNeedsPersist = false;
  let sessionReady = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persistQueue: Promise<void> = Promise.resolve();
  let persistenceWarningShown = false;
  let nextTeamTargetId = 1;
  let nextPresetRuleId = 1;
  let lastTeamCalculationOptions: TeamCalculationRunOptions = {};
  let resumingTeamCalculation = false;
  let teamCalculationGeneration = 0;
  let analysisGeneration = 0;

  function now(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }

  async function preparePerformanceBenchmark(): Promise<void> {
    if (loadPerformanceBenchmark() !== null) return;
    busy.value = "正在运行每日性能测试（约 4 秒）";
    try {
      await ensurePerformanceBenchmark();
    } catch (reason) {
      console.warn("[onmyoji-yuhun][performance] 每日性能测试失败，本次计算继续", reason instanceof Error ? reason.message : reason);
    }
  }

  function scheduleTeamCalculation(requests: readonly TeamCalculationRequest[]) {
    return resolveTeamCalculationSchedule(
      requests,
      teamCalculationResourceProfile.value,
      loadPerformanceBenchmark(),
      undefined,
      typeof customTeamCalculationWorkerCount.value === "number" ? customTeamCalculationWorkerCount.value : null
    );
  }

  function setTeamCalculationResourceProfile(profile: CalculationResourceProfile): void {
    teamCalculationResourceProfile.value = profile;
    saveCalculationResourceProfile(profile);
  }

  function setCustomTeamCalculationWorkerCount(value: number | null): void {
    customTeamCalculationWorkerCount.value = value;
    saveCustomWorkerCount(value);
  }

  function setTeamCalculationSchedulerDebugEnabled(enabled: boolean): void {
    teamCalculationSchedulerDebugEnabled.value = enabled;
    saveSchedulerDebugEnabled(enabled);
  }

  function startTeamCalculationSchedulerDebug(requestCount: number, schedule: ReturnType<typeof scheduleTeamCalculation>): ((event: SchedulerDebugEvent) => void) | undefined {
    if (!teamCalculationSchedulerDebugEnabled.value) return undefined;
    beginSchedulerDebugLog(teamCalculationResourceProfile.value, schedule.workerCount, requestCount);
    teamCalculationSchedulerDebugLog.value = getSchedulerDebugLog();
    const logStartedAt = now();
    let firstEvent = true;
    return (event: SchedulerDebugEvent): void => {
      appendSchedulerDebugEvent({ ...event, atMs: firstEvent ? 0 : Math.max(0, now() - logStartedAt) });
      firstEvent = false;
      teamCalculationSchedulerDebugLog.value = getSchedulerDebugLog();
    };
  }

  function clearTeamCalculationSchedulerDebugLog(): void {
    clearSchedulerDebugLog();
    teamCalculationSchedulerDebugLog.value = null;
  }

  function recordPerformance(input: {
    operation: PerformanceOperation;
    itemCount: number | null;
    targetCount: number | null;
    metricCount: number | null;
    categoryCount?: number | null;
    sampleSize?: number | null;
    elapsedMs: number;
    stages: readonly PerformanceStageTiming[];
    reports?: readonly TeamCalculationReportDTO[];
    algorithmId: string;
    algorithmParameters?: Readonly<Record<string, string | number | boolean>>;
    workerCount?: number;
    scheduler?: PerformanceSchedulerInfo;
    analysisDiagnostics?: AnalysisDiagnosticSummary;
  }): PerformanceRecord {
    const reports = input.reports ?? [];
    const entities = reports.flatMap((report) => report.entities);
    const device = capturePerformanceDevice();
    const targets: PerformanceTargetTiming[] = entities.map((entity) => ({
      index: entity.entityIndex,
      elapsedMs: Math.max(0, entity.elapsedMs ?? 0),
      candidateCount: entity.candidateCount,
      candidateCombinations: entity.candidateCombinations,
      evaluatedCombinations: entity.evaluatedCombinations,
      exact: entity.exact,
      stageTimings: (entity.stageTimings ?? []).map((stage) => ({ name: stage.id, elapsedMs: stage.elapsedMs }))
    }));
    const targetElapsed = targets.reduce((sum, target) => sum + target.elapsedMs, 0);
    const searchElapsedMs = reports.flatMap((report) => report.entities).reduce((sum, entity) => sum + (entity.stageTimings ?? []).filter((stage) => stage.id === "combination-search").reduce((stageSum, stage) => stageSum + stage.elapsedMs, 0), 0);
    const criticalPathMs = reports.reduce((max, report) => Math.max(max, report.elapsedMs ?? 0), 0);
    const metricDistribution = entities.reduce<Record<string, number>>((counts, entity) => {
      const key = entity.metricId === null ? "unknown" : String(entity.metricId);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});
    const workloadKey = [
      `items:${input.itemCount ?? "unknown"}`,
      `targets:${input.targetCount ?? "unknown"}`,
      `metrics:${Object.entries(metricDistribution).sort(([left], [right]) => left.localeCompare(right)).map(([key, count]) => `${key}x${count}`).join(",") || "none"}`,
      `categories:${input.categoryCount ?? "none"}`,
      `samples:${input.sampleSize ?? "none"}`
    ].join("|");
    const stages = input.stages.length > 0
      ? input.stages
      : [{ name: "calculateTarget（目标计算合计）", elapsedMs: targetElapsed }];
    const scheduler = input.scheduler ?? schedulerInfo(input.workerCount ?? 1);
    const record: PerformanceRecord = {
      schemaVersion: 4,
      kind: "onmyoji-yuhun-performance",
      id: newPerformanceId(),
      recordedAt: new Date().toISOString(),
      operation: input.operation,
      itemCount: input.itemCount,
      targetCount: input.targetCount,
      metricCount: input.metricCount,
      categoryCount: input.categoryCount ?? null,
      sampleSize: input.sampleSize ?? null,
      candidateCount: entities.reduce((sum, entity) => sum + entity.candidateCount, 0),
      candidateCombinations: entities.reduce((sum, entity) => sum + entity.candidateCombinations, 0),
      evaluatedCombinations: entities.reduce((sum, entity) => sum + entity.evaluatedCombinations, 0),
      successfulCount: entities.filter((entity) => entity.status === "success").length,
      noMatchCount: entities.filter((entity) => entity.status === "no-match").length,
      unsupportedCount: entities.filter((entity) => entity.status === "unsupported").length,
      disabledCount: entities.filter((entity) => entity.status === "disabled").length,
      exactCount: entities.filter((entity) => entity.exact === true).length,
      approximateCount: entities.filter((entity) => entity.exact === false).length,
      elapsedMs: Math.max(0, input.elapsedMs),
      stages,
      targets,
      device,
      benchmark: loadPerformanceBenchmark(),
      uploadState: "local-only",
      algorithm: {
        id: input.algorithmId,
        runtime: "typescript",
        parameters: {
          ...input.algorithmParameters
        },
        workerCount: scheduler.workerCount
      },
      scheduler,
      app: {
        version: import.meta.env.VITE_APP_VERSION ?? "0.1.0",
        buildId: import.meta.env.VITE_BUILD_ID ?? null
      },
      evaluatedPerSecond: searchElapsedMs > 0 ? entities.reduce((sum, entity) => sum + entity.evaluatedCombinations, 0) / (searchElapsedMs / 1000) : null,
      endToEndEvaluatedPerSecond: input.elapsedMs > 0 ? entities.reduce((sum, entity) => sum + entity.evaluatedCombinations, 0) / (input.elapsedMs / 1000) : null,
      pruningRate: entities.reduce((sum, entity) => sum + entity.candidateCombinations, 0) > 0
        ? Math.max(0, Math.min(1, 1 - entities.reduce((sum, entity) => sum + entity.evaluatedCombinations, 0) / entities.reduce((sum, entity) => sum + entity.candidateCombinations, 0)))
        : null,
      searchElapsedMs,
      targetElapsedMs: targetElapsed,
      criticalPathMs,
      overheadMs: Math.max(0, input.elapsedMs - criticalPathMs),
      workloadKey,
      metricDistribution,
      ...(input.analysisDiagnostics === undefined ? {} : { analysisDiagnostics: input.analysisDiagnostics })
    };
    performanceHistory.value = appendPerformanceRecord(record);
    void uploadPerformanceRecord(record);
    // Deliberately log aggregates only. Raw snapshot data stays private.
    console.debug("[onmyoji-yuhun][performance]", record);
    return record;
  }

  function clearPerformanceRecords(): void {
    clearPerformanceHistory();
    performanceHistory.value = [];
  }

  const enabledTeamTargets = computed(() => teamTargets.value.filter((target) => target.enabled));
  const enabledTeamMetricCount = computed(() => enabledTeamTargets.value.reduce((sum, target) => sum + target.metricCount, 0));
  const enabledPresetRules = computed(() => presetRules.value.filter((rule) => rule.enabled));

  function analysisRules(): AnalysisRuleInput[] {
    return enabledPresetRules.value.map((rule) => {
      const fallbackSubStats = rule.requiredSubStats.map((stat) => ({ stat, requirement: "include" as const }));
      return {
        id: rule.id,
        pool: rule.pool,
        label: rule.label,
        criteria: rule.filter ?? {
          types: [...rule.suits],
          positions: [...rule.positions],
          stars: [],
          mainStats: [...rule.mainStats],
          subStats: fallbackSubStats,
          subStatCounts: [...rule.subStatCounts],
          levelRanges: [],
          intrinsicStats: [],
          unknownTypeBits: [],
          unknownOptionBits: []
        }
      } satisfies AnalysisRuleInput;
    });
  }

  function teamCalculationFor(id: string): TeamCalculationReportDTO | null {
    return teamCalculations.value.find((report) => report.id === id) ?? null;
  }

  function teamCalculationProgressFor(id: string): TeamCalculationProgressState | null {
    return teamCalculationProgress.value[id] ?? null;
  }

  function initializeTeamCalculationProgress(requests: readonly TeamCalculationRequest[]): void {
    teamCalculationProgress.value = Object.fromEntries(requests.map((request) => [request.id, {
      targetId: request.id,
      targetLabel: request.label,
      status: "pending" as const,
      completed: 0,
      total: 0,
      current: null,
      currentShikigamiId: null,
      detail: null
    } satisfies TeamCalculationProgressState]));
  }

  function markTeamCalculationPending(requests: readonly TeamCalculationRequest[]): void {
    if (requests.length === 0) return;
    const next = { ...teamCalculationProgress.value };
    for (const request of requests) {
      if (next[request.id] !== undefined) continue;
      next[request.id] = {
        targetId: request.id,
        targetLabel: request.label,
        status: "pending",
        completed: 0,
        total: 0,
        current: null,
        currentShikigamiId: null,
        detail: null
      };
    }
    teamCalculationProgress.value = next;
  }

  function updateTeamCalculationProgress(value: WorkerProgress): void {
    if (value.phase !== "team-calculation" || value.targetId === undefined) return;
    const targetId = value.targetId;
    const previous = teamCalculationProgress.value[targetId];
    const targetLabel = value.targetLabel ?? previous?.targetLabel ?? targetId;
    const completed = value.completed;
    const total = value.total;
    teamCalculationProgress.value = {
      ...teamCalculationProgress.value,
      [targetId]: {
        targetId,
        targetLabel,
        // A progress event completes one member, not the whole lineup. The
        // per-lineup report callback is the completion boundary.
        status: "running",
        completed,
        total,
        current: value.current ?? previous?.current ?? null,
        currentShikigamiId: value.currentShikigamiId ?? previous?.currentShikigamiId ?? null,
        detail: value.detail ?? previous?.detail ?? null
      }
    };
  }

  function markTeamCalculationResultsCompleted(reports: readonly TeamCalculationReportDTO[]): void {
    if (reports.length === 0) return;
    const completed = { ...teamCalculationProgress.value };
    for (const report of reports) {
      const previous = completed[report.id];
      completed[report.id] = {
        targetId: report.id,
        targetLabel: previous?.targetLabel ?? report.label,
        status: report.entities.some((entity) => entity.status === "unsupported") ? "error" : "completed",
        completed: report.entities.length,
        total: report.entities.length,
        current: report.entities.at(-1)?.shikigamiName ?? previous?.current ?? null,
        currentShikigamiId: report.entities.at(-1)?.shikigamiId ?? previous?.currentShikigamiId ?? null,
        detail: "已完成"
      };
    }
    teamCalculationProgress.value = completed;
  }

  function markTeamCalculationPendingAfterPause(): void {
    const next = Object.fromEntries(Object.entries(teamCalculationProgress.value).map(([id, entry]) => [id, {
      ...entry,
      status: entry.status === "running" ? "pending" as const : entry.status,
      detail: entry.status === "running" ? "等待继续" : entry.detail
    }])) as Record<string, TeamCalculationProgressState>;
    teamCalculationProgress.value = next;
  }

  const copyAllowed = computed(() => {
    const required = [
      "snapshotValid",
      "targetsAndThresholdsValid",
      "staticPolicyConfirmed",
      "headerSourceValid",
      "groupLimitValid",
      "roundtripValid",
      "previewComplete",
      "retainedItemsProtected"
    ];
    return plan.value !== null && required.every((key) => gateState.value[key] === true);
  });

  const reconciliationComplete = computed(() => {
    if (checklist.value === null) return false;
    const groups = checklist.value.sections.flatMap((section) => section.groups.map((group) => ({ section: section.id, group })));
    return groups.length > 0 && groups.every(({ section, group }) => Number(actuals.value[`${section}:${group.index}`]) === group.expected);
  });

  function begin(label: string): void {
    busy.value = label;
    progress.value = null;
    error.value = null;
    notice.value = null;
  }

  function fail(reason: unknown): void {
    error.value = messageFor(reason);
  }

  function requireTeamDifficulty(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
      throw new Error("阵容难度必须是 1 至 100 的整数");
    }
    return value;
  }

  function optionalTeamDifficulty(value: number | null | undefined): number | null {
    if (value === null || value === undefined) return null;
    return requireTeamDifficulty(value);
  }

  function makeWorkbenchSession(): WorkbenchSessionV1 | null {
    if (snapshot.value === null || rawSnapshotBuffer === null) return null;
    return JSON.parse(JSON.stringify({
      schemaVersion: 1,
      kind: "onmyoji-yuhun-workbench-session",
      containsAccountDerivedData: true,
      doNotCommit: true,
      savedAt: new Date().toISOString(),
      snapshotSha256: snapshot.value.sha256,
      snapshotSummary: snapshot.value,
      settings: {
        templateIds: templateIds.value,
        defaultDisposition: defaultDisposition.value,
        riskTier: riskTier.value,
        budgetPerTenThousand: budgetPerTenThousand.value,
        staticPolicy: staticPolicy.value,
        existingFilterCode: existingFilterCode.value
      },
      teamTargets: teamTargets.value,
      presetRules: presetRules.value,
      inventory: inventory.value,
      analysis: analysis.value,
      decisions: decisions.value,
      yuhunDecisions: yuhunDecisions.value,
      teamCalculations: teamCalculations.value,
      teamCalculationProgress: teamCalculationProgress.value,
      teamCalculationPaused: teamCalculationPaused.value || busy.value === "正在计算阵容御魂搭配" || busy.value === "计算已暂停",
      teamCalculationOptions: lastTeamCalculationOptions,
      plan: plan.value,
      simulation: simulation.value,
      checklist: checklist.value,
      actuals: actuals.value,
      gateState: gateState.value,
      viewState: targetViewState.value
    })) as WorkbenchSessionV1;
  }

  function persistSessionNow(): Promise<void> {
    const session = makeWorkbenchSession();
    if (!session || !sessionReady || rawSnapshotBuffer === null) return Promise.resolve();
    const snapshotToPersist = snapshotNeedsPersist ? rawSnapshotBuffer : undefined;
    const write = async (): Promise<void> => {
      try {
        await saveWorkbenchSession(session, snapshotToPersist);
        if (rawSnapshotBuffer === snapshotToPersist) snapshotNeedsPersist = false;
        persistenceWarningShown = false;
      } catch (reason) {
        if (!persistenceWarningShown) {
          persistenceWarningShown = true;
          notice.value = `本地自动保存失败：${reason instanceof Error ? reason.message : "浏览器未允许本地存储"}`;
        }
      }
    };
    persistQueue = persistQueue.then(write, write);
    return persistQueue;
  }

  function scheduleSessionPersist(): void {
    if (!sessionReady || snapshot.value === null || rawSnapshotBuffer === null) return;
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persistSessionNow();
    }, 120);
  }

  watch(
    [snapshot, templateIds, riskTier, defaultDisposition, budgetPerTenThousand, staticPolicy, existingFilterCode, teamTargets, presetRules, inventory, analysis, decisions, yuhunDecisions, teamCalculations, teamCalculationProgress, teamCalculationPaused, plan, simulation, checklist, actuals, gateState, targetViewState],
    scheduleSessionPersist,
    { deep: true }
  );

  async function importSnapshot(file: File): Promise<void> {
    begin("正在解析快照");
    try {
      const buffer = await file.arrayBuffer();
      const persistedBuffer = buffer.slice(0);
      const imported = await client.importSnapshot(buffer);
      rawSnapshotBuffer = persistedBuffer;
      snapshotNeedsPersist = true;
      snapshot.value = imported;
      teamCalculations.value = [];
      teamCalculationProgress.value = {};
      teamCalculationPaused.value = false;
      lastTeamCalculationOptions = {};
      resumingTeamCalculation = false;
      analysis.value = null;
      yuhunDecisions.value = null;
      yuhunDecisionFacets.value = null;
      plan.value = null;
      simulation.value = null;
      checklist.value = null;
      staticPolicy.value = { ...staticPolicy.value, confirmed: true };
      inventory.value = await client.queryInventory({ page: 1, pageSize: 25 });
      gateState.value = await client.getGateState();
      notice.value = `已导入 ${snapshot.value.total.toLocaleString()} 件御魂，文件名与账号字段未保留`;
    } catch (reason) {
      fail(reason);
    } finally {
      busy.value = null;
    }
  }

  async function restoreLocalSession(): Promise<void> {
    if (restoring.value || restoreCompleted.value) return;
    restoring.value = true;
    sessionReady = false;
    busy.value = "正在恢复本地工作台";
    error.value = null;
    notice.value = null;
    try {
      const stored = await loadWorkbenchSession();
      if (stored === null) return;
      const restoredSnapshot = await client.importSnapshot(stored.snapshotBuffer.slice(0));
      if (restoredSnapshot.sha256 !== stored.session.snapshotSha256) {
        throw new Error("本地会话快照校验失败，请重新导入快照");
      }
      rawSnapshotBuffer = stored.snapshotBuffer.slice(0);
      snapshotNeedsPersist = false;
      snapshot.value = restoredSnapshot;
      templateIds.value = stored.session.settings.templateIds.filter((id): id is "zhaocai-speed" | "scattered-speed" => id === "zhaocai-speed" || id === "scattered-speed");
      riskTier.value = stored.session.settings.riskTier;
      defaultDisposition.value = stored.session.settings.defaultDisposition ?? "retain";
      budgetPerTenThousand.value = stored.session.settings.budgetPerTenThousand;
      staticPolicy.value = { ...stored.session.settings.staticPolicy };
      existingFilterCode.value = stored.session.settings.existingFilterCode;
      teamTargets.value = stored.session.teamTargets.map((target) => {
        const difficulty = target.difficulty;
        return {
          ...target,
          difficulty: difficulty === null || (typeof difficulty === "number" && Number.isSafeInteger(difficulty) && difficulty >= 1 && difficulty <= 100)
            ? difficulty
            : target.forceCalculate === true ? null : teamDifficultyFromLabel(target.label) ?? 100,
          forceCalculate: target.forceCalculate === true,
          locked: target.locked ?? target.builtIn === true
        };
      });
      nextTeamTargetId = Math.max(1, ...teamTargets.value.map((target) => Number(target.id.match(/(?:team-target|manual-target)-(\d+)$/)?.[1] ?? 0) + 1));
      presetRules.value = stored.session.presetRules.map((rule) => {
        const { subStatCount: legacySubStatCount, ...rest } = rule;
        const subStatCounts = rule.subStatCounts ?? (
          legacySubStatCount === undefined || legacySubStatCount === "any" ? [] : [legacySubStatCount]
        );
        return {
          ...rest,
          mainStats: [...rule.mainStats],
          requiredSubStats: [...rule.requiredSubStats],
          subStatCounts: [...subStatCounts]
        };
      });
      nextPresetRuleId = Math.max(1, ...presetRules.value.map((rule) => Number(rule.id.match(/preset-(?:discard|enhance)-(\d+)$/)?.[1] ?? 0) + 1));
      // Inventory rows are derived from the restored snapshot. Re-querying also
      // upgrades sessions saved before rows included displayed stat values.
      inventory.value = await client.queryInventory({ page: 1, pageSize: 25 });
      teamCalculations.value = stored.session.teamCalculations;
      teamCalculationProgress.value = stored.session.teamCalculationProgress === undefined
        ? {}
        : JSON.parse(JSON.stringify(stored.session.teamCalculationProgress)) as Record<string, TeamCalculationProgressState>;
      markTeamCalculationPendingAfterPause();
      markTeamCalculationResultsCompleted(teamCalculations.value);
      lastTeamCalculationOptions = stored.session.teamCalculationOptions === null || stored.session.teamCalculationOptions === undefined
        ? {}
        : JSON.parse(JSON.stringify(stored.session.teamCalculationOptions)) as TeamCalculationRunOptions;
      teamCalculationPaused.value = stored.session.teamCalculationPaused === true || Object.values(teamCalculationProgress.value).some((entry) => entry.status === "pending");
      if (stored.session.analysis !== null) {
        analysis.value = await client.analyze({
          defaultDisposition: defaultDisposition.value,
          templateIds: templateIds.value,
          riskTier: riskTier.value,
          budgetPerTenThousand: riskTier.value === "tier0" ? 0 : budgetPerTenThousand.value,
          rules: analysisRules(),
          teamReports: teamCalculations.value
        });
        decisions.value = await client.queryDecisions({
          page: stored.session.decisions?.page ?? 1,
          pageSize: stored.session.decisions?.pageSize ?? 30
        });
        yuhunDecisions.value = await client.queryYuhunDecisions({
          page: stored.session.yuhunDecisions?.page ?? 1,
          pageSize: stored.session.yuhunDecisions?.pageSize ?? 30
        });
        yuhunDecisionFacets.value = await client.queryYuhunDecisionFacets();
      } else {
        analysis.value = stored.session.analysis;
        decisions.value = stored.session.decisions;
        yuhunDecisions.value = stored.session.yuhunDecisions ?? null;
        yuhunDecisionFacets.value = null;
      }
      plan.value = null;
      simulation.value = null;
      checklist.value = null;
      actuals.value = { ...stored.session.actuals };
      gateState.value = await client.getGateState();
      targetViewState.value = stored.session.viewState === null || stored.session.viewState === undefined
        ? null
        : JSON.parse(JSON.stringify(stored.session.viewState)) as WorkbenchViewStateV1;
      targetCatalog.value = mergePublishedCatalog(TARGET_CATALOG, targetViewState.value?.catalog);
      notice.value = "已恢复上次工作台会话；数据仅保存在本机浏览器";
    } catch (reason) {
      rawSnapshotBuffer = null;
      fail(reason);
    } finally {
      sessionReady = true;
      restoring.value = false;
      restoreCompleted.value = true;
      busy.value = null;
    }
  }

  async function loadInventory(page = 1, filters: { search?: string; level?: number; star?: number; garbage?: boolean } = {}): Promise<void> {
    try {
      inventory.value = await client.queryInventory({ page, pageSize: 25, ...filters });
    } catch (reason) {
      fail(reason);
    }
  }

  function queryYuhunDetails(ids: readonly string[]): Promise<readonly TeamCalculationYuhunDTO[]> {
    return client.queryYuhunDetails(ids);
  }

  async function runAnalysis(): Promise<void> {
    const generation = analysisGeneration;
    begin("正在准备计算");
    await preparePerformanceBenchmark();
    begin("正在计算 baseline 与 3,920 类别");
    const startedAt = now();
    const stages: PerformanceStageTiming[] = [];
    const analysisWorkerCount = 1;
    const analysisScheduler = schedulerInfo(1);
    // A report is emitted only after a whole lineup has finished. Capture the
    // current completed reports once so analysis is strictly read-only with
    // respect to the target-calculation state.
    const performanceReports: readonly TeamCalculationReportDTO[] = [...teamCalculations.value];
    try {
      const analysisStartedAt = now();
      const nextAnalysis = await client.analyze({
        defaultDisposition: defaultDisposition.value,
        templateIds: templateIds.value,
        riskTier: riskTier.value,
        budgetPerTenThousand: riskTier.value === "tier0" ? 0 : budgetPerTenThousand.value,
        rules: analysisRules(),
        teamReports: performanceReports,
        diagnostics: teamCalculationSchedulerDebugEnabled.value
      }, (value) => { progress.value = value; });
      if (generation !== analysisGeneration) return;
      stages.push({ name: "analyze（Worker 与传输）", elapsedMs: Math.max(0, now() - analysisStartedAt) });
      const resultQueryStartedAt = now();
      const [nextDecisions, nextYuhunDecisions, nextYuhunDecisionFacets, nextGateState] = await Promise.all([
        client.queryDecisions({ page: 1, pageSize: 30 }),
        client.queryYuhunDecisions({ page: 1, pageSize: 30 }),
        client.queryYuhunDecisionFacets(),
        client.getGateState()
      ]);
      if (generation !== analysisGeneration) return;
      analysis.value = nextAnalysis;
      decisions.value = nextDecisions;
      yuhunDecisions.value = nextYuhunDecisions;
      yuhunDecisionFacets.value = nextYuhunDecisionFacets;
      plan.value = null;
      simulation.value = null;
      checklist.value = null;
      gateState.value = nextGateState;
      stages.push({ name: "analyze（结果查询）", elapsedMs: Math.max(0, now() - resultQueryStartedAt) });
      const performanceRecord = recordPerformance({
        operation: "analysis",
        itemCount: snapshot.value?.total ?? null,
        targetCount: performanceReports.length,
        metricCount: performanceReports.reduce((sum, report) => sum + report.entities.length, 0),
        categoryCount: nextAnalysis.categoryCount,
        elapsedMs: now() - startedAt,
        stages,
        reports: performanceReports,
        algorithmId: "workflow-analysis-v1",
        algorithmParameters: {
          teamAlgorithm: TEAM_CALCULATION_ALGORITHM_VERSION,
          templateCount: templateIds.value.length,
          ruleCount: enabledPresetRules.value.length,
          riskTier: riskTier.value,
          budgetPerTenThousand: riskTier.value === "tier0" ? 0 : budgetPerTenThousand.value,
          teamCalculationIncluded: performanceReports.length > 0
        },
        workerCount: analysisWorkerCount,
        scheduler: analysisScheduler,
        ...(nextAnalysis.diagnostics === undefined ? {} : {
          analysisDiagnostics: {
            ...nextAnalysis.diagnostics,
            stages: nextAnalysis.diagnostics.stages.map((stage) => ({ name: stage.id, elapsedMs: stage.elapsedMs }))
          }
        })
      });
      notice.value = performanceReports.length > 0
        ? `分析完成；已基于 ${performanceReports.length} 条已完成阵容的保存搭配生成御魂潜力，不会改写阵容计算结果（耗时 ${Math.round(performanceRecord.elapsedMs)} ms，实际评估 ${performanceRecord.evaluatedCombinations.toLocaleString()} 组）`
        : `分析完成；规则命中与 baseline 决策已合并到单件御魂结果（耗时 ${Math.round(performanceRecord.elapsedMs)} ms）`;
    } catch (reason) {
      fail(reason);
    } finally {
      busy.value = null;
      progress.value = null;
    }
  }

  async function loadDecisions(page = 1, filters: { disposition?: "discard" | "retain"; riskTier?: "tier0" | "tier1" | "none"; position?: number; search?: string } = {}): Promise<void> {
    try {
      decisions.value = await client.queryDecisions({ page, pageSize: 30, ...filters });
    } catch (reason) {
      fail(reason);
    }
  }

  async function loadYuhunDecisions(page = 1, filters: {
    criteria?: FilterCriteria;
    disposition?: "discard" | "retain";
    position?: number;
    suits?: readonly string[];
    positions?: readonly number[];
    stars?: readonly number[];
    levels?: readonly number[];
    mainStats?: readonly StatId[];
    subStats?: readonly StatId[];
    dispositions?: readonly ("discard" | "retain")[];
    reasons?: readonly string[];
    reasonMode?: "or" | "and";
    search?: string;
  } = {}): Promise<void> {
    try {
      yuhunDecisions.value = await client.queryYuhunDecisions({ page, pageSize: 30, ...filters });
    } catch (reason) {
      fail(reason);
    }
  }

  async function loadYuhunDecisionFacets(): Promise<void> {
    try {
      yuhunDecisionFacets.value = await client.queryYuhunDecisionFacets();
    } catch (reason) {
      fail(reason);
    }
  }

  function invalidateAnalysisResults(): void {
    analysisGeneration += 1;
    analysis.value = null;
    decisions.value = null;
    yuhunDecisions.value = null;
    yuhunDecisionFacets.value = null;
    plan.value = null;
    simulation.value = null;
    checklist.value = null;
    gateState.value = {};
  }

  function invalidateTeamCalculationResults(): void {
    teamCalculationGeneration += 1;
    resumingTeamCalculation = false;
    teamCalculationPaused.value = false;
    lastTeamCalculationOptions = {};
    teamCalculations.value = [];
    teamCalculationProgress.value = {};
    invalidateAnalysisResults();
  }

  function teamCalculationRequests(): TeamCalculationRequest[] {
    return enabledTeamTargets.value.map((target) => teamCalculationRequestFor(target));
  }

  function teamCalculationRequestFor(target: ImportedTeamTarget, occupiedYuhunIds: readonly string[] = []): TeamCalculationRequest {
    const scene = findTargetScene(target.sceneId, targetCatalog.value);
    const metadata = {
      sceneId: target.sceneId,
      sceneMutualExclusion: scene?.mutualExclusion === true,
      occupiedYuhunIds
    };
    return {
      id: target.id,
      label: target.label,
      manualTargets: target.source === "team-code"
        ? target.inspection?.editableTargets ?? []
        : target.manualTargets ?? [],
      ...metadata
    };
  }

  async function calculateTeamTargets(options: TeamCalculationRunOptions = {}): Promise<void> {
    if (snapshot.value === null) {
      error.value = { stage: "snapshot", code: "SNAPSHOT_REQUIRED", path: null, message: "请先导入游戏快照" };
      return;
    }
    const generation = teamCalculationGeneration;
    const resume = resumingTeamCalculation;
    resumingTeamCalculation = false;
    lastTeamCalculationOptions = options;
    const smartMode = options.mode === "smart";
    const selectedSceneIds = new Set(options.sceneIds ?? []);
    const manualTargets = enabledTeamTargets.value
      .filter((target) => selectedSceneIds.has(target.sceneId));
    if (!smartMode && manualTargets.length === 0) {
      error.value = { stage: "targets", code: "NO_TEAM_TARGET", path: "sceneIds", message: "请至少选中一个场景，并在其中启用一条阵容" };
      return;
    }
    if (smartMode && teamTargets.value.length === 0) {
      error.value = { stage: "targets", code: "NO_TEAM_TARGET", path: "teamTargets", message: "请至少导入一条阵容或手动搭配目标" };
      return;
    }
    const manualRequests = manualTargets.map((target) => teamCalculationRequestFor(target));
    const smartGroups = smartMode
      ? buildSmartTeamTargetGroups(teamTargets.value, options.sceneIds ?? [], options.difficultyDecreaseCount ?? "auto")
      : [];
    if (smartMode && smartGroups.length === 0) {
      error.value = { stage: "targets", code: "NO_TEAM_TARGET", path: "sceneIds", message: "所选场景中没有可计算的阵容" };
      return;
    }
    const initialRequests = smartMode
      ? smartGroups.map((group) => teamCalculationRequestFor(group.targets[0]!))
      : manualRequests;
    const requests = resume
      ? initialRequests.filter((request) => teamCalculationFor(request.id) === null)
      : initialRequests;
    if (!resume) {
      teamCalculations.value = [];
      initializeTeamCalculationProgress(smartMode
        ? initialRequests
        : requests);
    }
    teamCalculationPaused.value = false;
    begin("正在准备计算");
    await preparePerformanceBenchmark();
    if (generation !== teamCalculationGeneration) return;
    begin("正在计算阵容御魂搭配");
    const startedAt = now();
    try {
      const runTargetIds = new Set((smartMode
        ? smartGroups.flatMap((group) => group.targets)
        : manualTargets).map((target) => target.id));
      const reports: TeamCalculationReportDTO[] = resume
        ? teamCalculations.value.filter((report) => runTargetIds.has(report.id))
        : [];
      let teamSchedule = scheduleTeamCalculation(requests);
      const upsertReport = (report: TeamCalculationReportDTO): void => {
        const index = reports.findIndex((item) => item.id === report.id);
        if (index === -1) reports.push(report);
        else reports[index] = report;
      };
      const onProgress = (value: WorkerProgress): void => {
        if (generation !== teamCalculationGeneration) return;
        progress.value = value;
        updateTeamCalculationProgress(value);
      };
      const onReport = (report: TeamCalculationReportDTO): void => {
        if (generation !== teamCalculationGeneration) return;
        upsertReport(report);
        teamCalculations.value = [...teamCalculations.value.filter((item) => item.id !== report.id), report];
        markTeamCalculationResultsCompleted([report]);
        void persistSessionNow();
      };
      if (!smartMode) {
        const debug = startTeamCalculationSchedulerDebug(requests.length, teamSchedule);
        const initialScheduleWithDebug = debug === undefined ? teamSchedule : { ...teamSchedule, debug };
        const result = await client.calculateTeamTargets(requests, onProgress, onReport, initialScheduleWithDebug);
        for (const report of result) upsertReport(report);
      } else {
        const nextSmartIndex = (group: SmartTeamTargetGroup): number | null => {
          const completed = new Map(reports.map((report) => [report.id, report]));
          const forcedIndices = group.targets
            .map((target, index) => ({ target, index }))
            .filter(({ target }) => target.forceCalculate === true);
          for (const { target, index } of forcedIndices) {
            if (!completed.has(target.id)) return index;
          }
          for (const [index, target] of group.targets.entries()) {
            if (target.forceCalculate === true) continue;
            const report = completed.get(target.id);
            if (report === undefined) return index;
            if (teamCalculationMeetsTargetScore(report)) return null;
          }
          return null;
        };
        const smartRequestFor = (group: SmartTeamTargetGroup, index: number): TeamCalculationRequest => {
          const target = group.targets[index]!;
          const sceneMutualExclusion = findTargetScene(target.sceneId, targetCatalog.value)?.mutualExclusion === true;
          const occupied = sceneMutualExclusion
            ? reports
              .filter((report) => group.targets.some((candidate) => candidate.id === report.id))
              .flatMap((report) => report.reservedYuhunIds ?? [])
            : [];
          return teamCalculationRequestFor(target, occupied);
        };
        const groupByTargetId = new Map(smartGroups.flatMap((group) => group.targets.map((target) => [target.id, group] as const)));
        const initialSmartRequests = smartGroups.flatMap((group) => {
          const index = nextSmartIndex(group);
          return index === null ? [] : [smartRequestFor(group, index)];
        });
        teamSchedule = scheduleTeamCalculation(initialSmartRequests);
        const debug = initialSmartRequests.length === 0
          ? undefined
          : startTeamCalculationSchedulerDebug(smartGroups.reduce((count, group) => count + group.targets.length, 0), teamSchedule);
        const initialScheduleWithDebug = debug === undefined ? teamSchedule : { ...teamSchedule, debug };
        markTeamCalculationPending(initialSmartRequests);
        const smartReports = await client.calculateTeamTargetsDynamically(
          initialSmartRequests,
          (request) => {
            if (generation !== teamCalculationGeneration) return [];
            const group = groupByTargetId.get(request.id);
            if (group === undefined) return [];
            const index = nextSmartIndex(group);
            if (index === null) return [];
            const next = smartRequestFor(group, index);
            markTeamCalculationPending([next]);
            return [next];
          },
          onProgress,
          onReport,
          initialScheduleWithDebug
        );
        for (const report of smartReports) upsertReport(report);
      }
      if (generation !== teamCalculationGeneration) return;
      teamCalculations.value = reports;
      markTeamCalculationResultsCompleted(teamCalculations.value);
      const performanceRecord = recordPerformance({
        operation: "team-calculation",
        itemCount: snapshot.value.total,
        targetCount: teamCalculations.value.length,
        metricCount: teamCalculations.value.reduce((sum, report) => sum + report.entities.length, 0),
        elapsedMs: now() - startedAt,
        stages: [{ name: "calculateTeamTargets（阵容计算）", elapsedMs: now() - startedAt }],
        reports: teamCalculations.value,
        algorithmId: TEAM_CALCULATION_ALGORITHM_VERSION,
        algorithmParameters: {
          maxCombinations: TEAM_CALCULATION_SEARCH_DEFAULTS.maxCombinations,
          beamWidth: TEAM_CALCULATION_SEARCH_DEFAULTS.beamWidth,
          candidateLimitPerPosition: TEAM_CALCULATION_SEARCH_DEFAULTS.candidateLimitPerPosition,
          topN: "20-or-100"
        },
        workerCount: teamSchedule.workerCount,
        scheduler: schedulerInfo(teamSchedule.workerCount, teamSchedule.resourceAllocation)
      });
      const entities = teamCalculations.value.flatMap((report) => report.entities);
      const success = entities.filter((entity) => entity.status === "success").length;
      const approximate = entities.filter((entity) => entity.status === "success" && entity.exact === false).length;
      notice.value = `完成 ${success} 个式神目标${approximate > 0 ? `，其中 ${approximate} 个为近似最优` : ""}；已按阵容顺序分配御魂（耗时 ${Math.round(performanceRecord.elapsedMs)} ms，评估 ${performanceRecord.evaluatedCombinations.toLocaleString()} 组）`;
    } catch (reason) {
      if (generation !== teamCalculationGeneration) return;
      if (reason instanceof WorkflowClientPausedError) {
        teamCalculationPaused.value = true;
        busy.value = "计算已暂停";
        notice.value = "阵容计算已暂停；点击继续计算可从未完成阵容重新开始";
        return;
      }
      fail(reason);
    } finally {
      if (generation === teamCalculationGeneration && !teamCalculationPaused.value) busy.value = null;
    }
  }

  function pauseTeamCalculation(): void {
    if (busy.value !== "正在计算阵容御魂搭配") return;
    client.pauseAndReset();
    markTeamCalculationPendingAfterPause();
    teamCalculationPaused.value = true;
    busy.value = "计算已暂停";
    progress.value = null;
    void persistSessionNow();
  }

  function resumeTeamCalculation(): void {
    if (!teamCalculationPaused.value) return;
    teamCalculationPaused.value = false;
    resumingTeamCalculation = true;
    void calculateTeamTargets(lastTeamCalculationOptions);
  }

  function teamCalculationOptionsForResume(): TeamCalculationRunOptions {
    return JSON.parse(JSON.stringify(lastTeamCalculationOptions)) as TeamCalculationRunOptions;
  }

  function resetTeamCalculations(): void {
    client.resetTeamCalculations();
    invalidateTeamCalculationResults();
    progress.value = null;
    if (busy.value === "正在准备计算" || busy.value === "正在计算阵容御魂搭配" || busy.value === "计算已暂停") {
      busy.value = null;
    }
    notice.value = "已重置阵容计算结果；快照、目标与策略保持不变";
    scheduleSessionPersist();
  }

  async function inspectTeamTarget(code: string): Promise<TeamCodeInspectionDTO | null> {
    begin("正在导入阵容目标");
    try {
      const normalizedCode = code.trim();
      if (teamTargets.value.some((target) => target.code === normalizedCode)) throw new Error("这条阵容码已经导入");
      return await decodeTeamCode(normalizedCode);
    } catch (reason) {
      fail(reason);
      return null;
    } finally {
      busy.value = null;
    }
  }

  async function inspectStoredTeamTarget(id: string): Promise<TeamCodeInspectionDTO | null> {
    const target = teamTargets.value.find((item) => item.id === id);
    if (target === undefined || target.source !== "team-code" || target.code === undefined) return null;
    if (
      target.inspection !== null
      && target.inspection.editableTargets !== undefined
      && target.inspection.entities.every((entity) => "yuhunConfigEnabled" in entity)
      && target.inspection.editableTargets.every((item) => "yuhunConfigEnabled" in item)
    ) return target.inspection;
    try {
      const inspection = await decodeTeamCode(target.code);
      teamTargets.value = teamTargets.value.map((item) => item.id === id ? { ...item, inspection } : item);
      return inspection;
    } catch (reason) {
      fail(reason);
      return null;
    }
  }

  function addInspectedTeamTarget(code: string, inspection: TeamCodeInspectionDTO, sceneId: string, label: string, sceneLabel: string, difficulty: number | null, forceCalculate = false): boolean {
    try {
      const normalizedCode = code.trim();
      if (teamTargets.value.some((target) => target.code === normalizedCode)) throw new Error("这条阵容码已经导入");
      const resolvedSceneLabel = sceneLabel.trim();
      if (resolvedSceneLabel === "") throw new Error("请选择有效的三级场景分组");
      const metricCount = inspection.entities.filter((entity) =>
        entity.kind === "shikigami" && entity.hasConfig && entity.yuhunConfigEnabled !== false
      ).length;
      if (metricCount === 0) throw new Error("阵容码中没有可作为计算目标的式神御魂配置");
      const normalizedDifficulty = forceCalculate ? optionalTeamDifficulty(difficulty) : requireTeamDifficulty(difficulty as number);
      const defaultIndex = teamTargets.value.filter((target) => target.sceneId === sceneId).length + 1;
      const normalizedLabel = label.trim() || `${resolvedSceneLabel} · 阵容 ${defaultIndex}`;
      teamTargets.value = [...teamTargets.value, {
        id: `team-target-${nextTeamTargetId++}`,
        source: "team-code",
        code: normalizedCode,
        label: normalizedLabel.slice(0, 80),
        sceneId,
        sceneLabel: resolvedSceneLabel.slice(0, 80),
        difficulty: normalizedDifficulty,
        forceCalculate,
        enabled: true,
        metricCount,
        inspection
      }];
      void uploadTeamTarget({ code: normalizedCode, label: normalizedLabel.slice(0, 80), sceneId, sceneLabel: resolvedSceneLabel.slice(0, 80), difficulty: normalizedDifficulty, metricCount });
      invalidateTeamCalculationResults();
      notice.value = `已导入 ${metricCount} 个式神指标并选入目标集`;
      return true;
    } catch (reason) {
      fail(reason);
      return false;
    }
  }

  async function importYuhunFilterCode(code: string): Promise<number> {
    begin("正在导入御魂方案");
    try {
      const normalizedCode = code.trim().replace(/\s+/g, "");
      if (normalizedCode.length === 0) throw new Error("御魂码不能为空");
      if (presetRules.value.some((rule) => rule.source?.code === normalizedCode)) {
        throw new Error("这条御魂码已经导入");
      }

      const share = await decodeYuhunCode(normalizedCode);
      if (share.planKind !== "discard" && share.planKind !== "enhance") {
        throw new Error(`御魂码包含未知方案类型：${share.planKindValue}`);
      }
      if (share.groups.length === 0) throw new Error("御魂码不包含条件组");
      const pool: PresetRulePool = share.planKind;

      const imported = share.groups.map((group, groupIndex) => {
        const criteria = JSON.parse(JSON.stringify(group.criteria)) as FilterCriteria;
        const includedSubStats = criteria.subStats
          .filter((filter) => filter.requirement === "include")
          .map((filter) => filter.stat);
        return {
          id: `preset-${share.planKind}-${nextPresetRuleId++}`,
          pool,
          label: group.name.trim().slice(0, 80) || `导入条件组 ${groupIndex + 1}`,
          suits: [...criteria.types],
          positions: [...criteria.positions].sort((left, right) => left - right),
          mainStats: [...criteria.mainStats],
          requiredSubStats: [...new Set(includedSubStats)],
          subStatCounts: [...criteria.subStatCounts],
          enabled: true,
          filter: criteria,
          source: { code: normalizedCode, groupIndex, headerHex: share.headerHex }
        } satisfies PresetRule;
      });

      presetRules.value = [...presetRules.value, ...imported];
      invalidateAnalysisResults();
      const warningSuffix = share.warnings.length > 0 ? `，${share.warnings.length} 条未知字段已保留` : "";
      notice.value = `已导入 ${imported.length} 条${share.planKind === "discard" ? "弃置" : "强化"}方案${warningSuffix}`;
      return imported.length;
    } catch (reason) {
      fail(reason);
      return 0;
    } finally {
      busy.value = null;
    }
  }

  function saveManualTeamTarget(
    manualTargets: readonly ManualShikigamiCalculationInput[],
    sceneId: string,
    label: string,
    sceneLabel: string | null = null,
    difficulty: number | null = null,
    forceCalculate = false
  ): boolean {
    try {
      const scene = findTargetScene(sceneId);
      const resolvedSceneLabel = sceneLabel?.trim() || scene?.sceneLabel;
      if (resolvedSceneLabel === undefined) throw new Error("请选择有效的具体场景");
      if (manualTargets.length === 0) throw new Error("请至少添加一个式神");
      const metricCount = manualTargets.filter((target) => target.yuhunConfigEnabled !== false).length;
      if (metricCount === 0) throw new Error("请至少让一个式神参与御魂计算");
      const defaultIndex = teamTargets.value.filter((target) => target.sceneId === sceneId).length + 1;
      const normalizedLabel = label.trim() || `${resolvedSceneLabel} · 手动搭配 ${defaultIndex}`;
      const inferredDifficulty = difficulty ?? teamDifficultyFromLabel(normalizedLabel) ?? 100;
      const normalizedDifficulty = forceCalculate ? optionalTeamDifficulty(difficulty) : requireTeamDifficulty(inferredDifficulty);
      teamTargets.value = [...teamTargets.value, {
        id: `manual-target-${nextTeamTargetId++}`,
        source: "manual",
        manualTargets: JSON.parse(JSON.stringify(manualTargets)) as ManualShikigamiCalculationInput[],
        label: normalizedLabel.slice(0, 80),
        sceneId,
        sceneLabel: resolvedSceneLabel.slice(0, 80),
        difficulty: normalizedDifficulty,
        forceCalculate,
        enabled: true,
        metricCount,
        inspection: null
      }];
      void uploadTeamTarget({ code: `manual:${JSON.stringify(manualTargets)}`, label: normalizedLabel.slice(0, 80), sceneId, sceneLabel: resolvedSceneLabel.slice(0, 80), difficulty: normalizedDifficulty, metricCount });
      invalidateTeamCalculationResults();
      notice.value = `已保存 ${manualTargets.length} 个阵容式神，其中 ${metricCount} 个参与御魂计算`;
      return true;
    } catch (reason) {
      fail(reason);
      return false;
    }
  }

  function saveEditedTeamTarget(
    id: string,
    manualTargets: readonly ManualShikigamiCalculationInput[],
    label: string,
    difficulty: number | null,
    forceCalculate = false
  ): string | null {
    try {
      const source = teamTargets.value.find((target) => target.id === id);
      if (source === undefined) throw new Error("阵容不存在或已经删除");
      if (manualTargets.length === 0) throw new Error("请至少添加一个式神");
      const copiedTargets = JSON.parse(JSON.stringify(manualTargets)) as ManualShikigamiCalculationInput[];
      const metricCount = copiedTargets.filter((target) => target.yuhunConfigEnabled !== false).length;
      if (metricCount === 0) throw new Error("请至少让一个式神参与御魂计算");
      const normalizedLabel = label.trim();
      if (normalizedLabel === "") throw new Error("阵容名称不能为空");
      const normalizedDifficulty = forceCalculate ? optionalTeamDifficulty(difficulty) : requireTeamDifficulty(difficulty as number);

      if (source.locked === true || source.builtIn === true) {
        const copiedId = `manual-target-${nextTeamTargetId++}`;
        teamTargets.value = [...teamTargets.value, {
          id: copiedId,
          source: "manual",
          manualTargets: copiedTargets,
          label: normalizedLabel.slice(0, 80),
          sceneId: source.sceneId,
          sceneLabel: source.sceneLabel,
          difficulty: normalizedDifficulty,
          forceCalculate,
          enabled: true,
          metricCount,
          inspection: null,
          locked: false
        }];
        invalidateTeamCalculationResults();
        notice.value = `已复制并保存为本地阵容“${normalizedLabel.slice(0, 80)}”`;
        return copiedId;
      }

      teamTargets.value = teamTargets.value.map((target) => target.id === id ? {
        id: target.id,
        source: "manual",
        manualTargets: copiedTargets,
        label: normalizedLabel.slice(0, 80),
        sceneId: target.sceneId,
        sceneLabel: target.sceneLabel,
        difficulty: normalizedDifficulty,
        forceCalculate,
        enabled: target.enabled,
        metricCount,
        inspection: null,
        locked: false
      } : target);
      invalidateTeamCalculationResults();
      notice.value = `已保存本地阵容“${normalizedLabel.slice(0, 80)}”`;
      return id;
    } catch (reason) {
      fail(reason);
      return null;
    }
  }

  function setTeamTargetEnabled(id: string, enabled: boolean): void {
    const target = teamTargets.value.find((item) => item.id === id);
    if (target === undefined || target.enabled === enabled) return;
    teamTargets.value = teamTargets.value.map((item) => item.id === id ? { ...item, enabled } : item);
    invalidateTeamCalculationResults();
  }

  function setTeamTargetGroupEnabled(sceneId: string, enabled: boolean): void {
    if (!teamTargets.value.some((target) => target.sceneId === sceneId && target.enabled !== enabled)) return;
    teamTargets.value = teamTargets.value.map((target) => target.sceneId === sceneId ? { ...target, enabled } : target);
    invalidateTeamCalculationResults();
  }

  function moveTeamTarget(id: string, sceneId: string, sceneLabel: string | null = null): void {
    const resolvedSceneLabel = sceneLabel?.trim() || findTargetScene(sceneId)?.sceneLabel;
    if (resolvedSceneLabel === undefined) throw new Error("目标分组不存在");
    teamTargets.value = teamTargets.value.map((target) => target.id === id ? { ...target, sceneId, sceneLabel: resolvedSceneLabel.slice(0, 80) } : target);
    invalidateTeamCalculationResults();
  }

  function removeTeamTarget(id: string): void {
    if (teamTargets.value.some((target) => target.id === id && (target.locked === true || target.builtIn === true))) return;
    const next = teamTargets.value.filter((target) => target.id !== id);
    if (next.length === teamTargets.value.length) return;
    teamTargets.value = next;
    invalidateTeamCalculationResults();
  }

  function savePresetRule(input: PresetRuleInput, id: string | null = null): void {
    const label = input.label.trim();
    const suits = [...new Set(input.suits.map((value) => value.trim()).filter(Boolean))];
    const positions = [...new Set(input.positions)].sort((left, right) => left - right);
    const mainStats = [...new Set(input.mainStats)];
    const requiredSubStats = [...new Set(input.requiredSubStats)];
    const countOrder: readonly SubStatCount[] = ["lessThan2", "2", "3", "4"];
    const subStatCounts = countOrder.filter((count) => input.subStatCounts.includes(count));
    if (input.pool !== "discard" && input.pool !== "enhance") throw new Error("预置规则池无效");
    if (label.length === 0) throw new Error("预置规则名称不能为空");
    const conditionValues = input.filter === undefined
      ? [suits, positions, mainStats, requiredSubStats, subStatCounts]
      : Object.values(input.filter);
    if (conditionValues.every((values) => values.length === 0)) throw new Error("请至少设置一项筛选条件；御魂套装可以不限");
    if (positions.some((position) => !Number.isInteger(position) || position < 1 || position > 6)) throw new Error("预置规则位置无效");
    const normalized = {
      pool: input.pool,
      label: label.slice(0, 80),
      suits,
      positions,
      mainStats,
      requiredSubStats,
      subStatCounts,
      ...(input.filter === undefined ? {} : { filter: JSON.parse(JSON.stringify(input.filter)) as FilterCriteria }),
      ...(input.source === undefined ? {} : { source: { ...input.source } })
    };
    if (id === null) {
      presetRules.value = [...presetRules.value, {
        id: `preset-${input.pool}-${nextPresetRuleId++}`,
        enabled: true,
        ...normalized
      }];
    } else {
      if (!presetRules.value.some((rule) => rule.id === id)) throw new Error("预置规则不存在");
      presetRules.value = presetRules.value.map((rule) => rule.id === id ? { ...rule, ...normalized } : rule);
    }
    invalidateAnalysisResults();
    notice.value = `${input.pool === "discard" ? "弃置" : "强化"}规则已保存并默认启用`;
  }

  function setPresetRuleEnabled(id: string, enabled: boolean): void {
    const rule = presetRules.value.find((item) => item.id === id);
    if (rule === undefined || rule.enabled === enabled) return;
    presetRules.value = presetRules.value.map((item) => item.id === id ? { ...item, enabled } : item);
    invalidateAnalysisResults();
  }

  function setPresetRulePoolEnabled(pool: PresetRulePool, enabled: boolean): void {
    if (!presetRules.value.some((rule) => rule.pool === pool && rule.enabled !== enabled)) return;
    presetRules.value = presetRules.value.map((rule) => rule.pool === pool ? { ...rule, enabled } : rule);
    invalidateAnalysisResults();
  }

  function removePresetRule(id: string): void {
    const next = presetRules.value.filter((rule) => rule.id !== id);
    if (next.length === presetRules.value.length) return;
    presetRules.value = next;
    invalidateAnalysisResults();
  }

  function invalidatePolicy(next: StaticRetentionPolicy): void {
    staticPolicy.value = { ...next, confirmed: false };
    plan.value = null;
    simulation.value = null;
    checklist.value = null;
    gateState.value = {};
  }

  function setDefaultDisposition(next: "retain" | "discard"): void {
    if (defaultDisposition.value === next) return;
    defaultDisposition.value = next;
    invalidateAnalysisResults();
  }

  function setRiskTier(next: "tier0" | "tier1"): void {
    if (riskTier.value === next) return;
    riskTier.value = next;
    invalidateAnalysisResults();
  }

  function setTemplateIds(next: Array<"zhaocai-speed" | "scattered-speed">): void {
    if (JSON.stringify(templateIds.value) === JSON.stringify(next)) return;
    templateIds.value = next;
    invalidateAnalysisResults();
  }

  function invalidateHeader(): void {
    plan.value = null;
    simulation.value = null;
    checklist.value = null;
    gateState.value = {};
  }

  function confirmPolicy(): void {
    staticPolicy.value = { ...staticPolicy.value, confirmed: true };
    notice.value = "当前策略版本已人工确认；再次修改会自动失效";
  }

  async function generatePlan(): Promise<void> {
    begin("正在生成并预演 D/E");
    plan.value = null;
    gateState.value = {};
    try {
      const source = await decodeYuhunCode(existingFilterCode.value.trim());
      if (source.warnings.length > 0) throw new Error("现有筛选码包含无法忽略的解析警告");
      const generated: GeneratedPlanDTO = await client.generatePlan({ headerHex: source.headerHex, staticPolicy: staticPolicy.value });
      const [discard, rescue] = await Promise.all([
        generated.discardDraft === null ? Promise.resolve(null) : encodeYuhunDraft(generated.discardDraft),
        generated.rescueDraft === null ? Promise.resolve(null) : encodeYuhunDraft(generated.rescueDraft)
      ]);
      const invalid = [discard, rescue].find((entry) => entry !== null && entry.share.warnings.length > 0);
      if (invalid !== undefined) throw new Error("服务生成的御魂码包含无法忽略的解析警告");
      for (const [draft, encoded] of [[generated.discardDraft, discard], [generated.rescueDraft, rescue]] as const) {
        if (!draft || !encoded) continue;
        const decoded = await decodeYuhunCode(encoded.yuhunCode);
        const expected = filterShareFromDraft(draft);
        const canonical = (share: typeof decoded) => filterShareFromDraft({ headerHex: share.headerHex, planKind: share.planKind === "discard" ? "discard" : "enhance", groups: share.groups.map(group => ({ name: group.name, criteria: group.criteria })) });
        if (decoded.warnings.length || decoded.planKind !== expected.planKind || JSON.stringify(canonical(decoded)) !== JSON.stringify(expected)) throw new Error("编码往返不一致，不能使用本次双码");
      }
      plan.value = {
        ...generated.summary,
        discardCode: discard?.yuhunCode ?? null,
        rescueCode: rescue?.yuhunCode ?? null
      };
      checklist.value = await client.buildImportChecklist();
      simulation.value = null;
      actuals.value = {};
      gateState.value = await client.getGateState();
      notice.value = "双码已完成编码往返和当前库存保留保护验证；请按预演数量在游戏中核对";
    } catch (reason) {
      fail(reason);
    } finally {
      busy.value = null;
    }
  }

  async function runSimulation(): Promise<void> {
    begin("正在准备计算");
    await preparePerformanceBenchmark();
    begin("正在运行 100,000 件验证模拟");
    const startedAt = now();
    try {
      simulation.value = await client.runSimulation(100_000, 1, (value) => { progress.value = value; });
      gateState.value = await client.getGateState();
      const performanceRecord = recordPerformance({
        operation: "simulation",
        itemCount: snapshot.value?.total ?? null,
        targetCount: enabledTeamTargets.value.length,
        metricCount: enabledTeamMetricCount.value,
        sampleSize: 100_000,
        elapsedMs: now() - startedAt,
        stages: [{ name: "runSimulation（验证模拟）", elapsedMs: now() - startedAt }],
        algorithmId: "speed-validation-v1",
        algorithmParameters: { sampleSize: 100_000, seed: 1 },
        workerCount: 1
      });
      notice.value = `Tier 0 完整证明与当前档位模拟已通过（耗时 ${Math.round(performanceRecord.elapsedMs)} ms，样本 ${performanceRecord.sampleSize?.toLocaleString() ?? "-"}）`;
    } catch (reason) {
      fail(reason);
    } finally {
      busy.value = null;
      progress.value = null;
    }
  }

  async function cancelSimulation(): Promise<void> {
    client.cancelAndReset();
    sessionReady = false;
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try { await deleteWorkbenchSession(); } catch { /* local persistence is best effort */ }
    rawSnapshotBuffer = null;
    snapshotNeedsPersist = false;
    snapshot.value = null;
    analysis.value = null;
    inventory.value = null;
    decisions.value = null;
    yuhunDecisions.value = null;
    yuhunDecisionFacets.value = null;
    teamCalculations.value = [];
    teamCalculationProgress.value = {};
    plan.value = null;
    simulation.value = null;
    checklist.value = null;
    busy.value = null;
    progress.value = null;
    gateState.value = {};
    targetViewState.value = null;
    targetCatalog.value = TARGET_CATALOG;
    sessionReady = true;
    restoreCompleted.value = true;
    notice.value = "计算已取消，Worker 已重建；请重新导入快照";
  }

  function setTargetViewState(
    catalog: WorkbenchViewStateV1["catalog"],
    selectedSceneIds: readonly string[],
    focusedSceneId: string,
    fullCatalog: readonly TargetDomain[] = catalog
  ): void {
    targetViewState.value = JSON.parse(JSON.stringify({ catalog, selectedSceneIds, focusedSceneId })) as WorkbenchViewStateV1;
    targetCatalog.value = JSON.parse(JSON.stringify(fullCatalog)) as readonly TargetDomain[];
  }

  async function copyCode(kind: "discard" | "rescue"): Promise<void> {
    if (!copyAllowed.value || plan.value === null) throw new Error("严格门禁尚未全部通过");
    const value = kind === "discard" ? plan.value.discardCode : plan.value.rescueCode;
    if (value === null) throw new Error("当前方案没有可复制的码");
    const method = await copyText(value);
    notice.value = method === "clipboard" ? "已复制到剪贴板" : "已通过兼容模式复制";
  }

  function downloadCode(kind: "discard" | "rescue"): void {
    if (!copyAllowed.value || plan.value === null) throw new Error("严格门禁尚未全部通过");
    const code = kind === "discard" ? plan.value.discardCode : plan.value.rescueCode;
    if (code === null) throw new Error("当前方案没有可下载的码");
    downloadJson(`yuhun-${kind}.private.json`, {
      schemaVersion: 1,
      kind: "onmyoji-yuhun-filter-code",
      code,
      containsAccountDerivedData: true,
      doNotCommit: true
    });
  }

  function makeProject(): SavedProjectV1 {
    if (snapshot.value === null) throw new Error("没有可保存的快照摘要");
    const project: SavedProjectV1 = {
      schemaVersion: 1,
      kind: "onmyoji-yuhun-project",
      containsAccountDerivedData: true,
      doNotCommit: true,
      savedAt: new Date().toISOString(),
      snapshotSha256: snapshot.value.sha256,
      snapshotSummary: snapshot.value,
      settings: {
        templateIds: templateIds.value,
        riskTier: riskTier.value,
        budgetPerTenThousand: budgetPerTenThousand.value,
        staticPolicy: staticPolicy.value,
        defaultDisposition: defaultDisposition.value
      },
      analysisSummary: analysis.value
    };
    assertProjectPrivacy(project);
    return project;
  }

  async function saveLocal(): Promise<void> {
    await saveProject(makeProject());
    notice.value = "本地项目已保存；不包含原始快照、ID、Header、阵容码或 D/E 码";
  }

  async function loadLocal(): Promise<void> {
    const project = await loadProject();
    if (project === null) throw new Error("没有已保存的本地项目");
    templateIds.value = project.settings.templateIds.filter((id): id is "zhaocai-speed" | "scattered-speed" => id === "zhaocai-speed" || id === "scattered-speed");
    riskTier.value = project.settings.riskTier;
    defaultDisposition.value = project.settings.defaultDisposition ?? "retain";
    budgetPerTenThousand.value = project.settings.budgetPerTenThousand;
    staticPolicy.value = project.settings.staticPolicy;
    staticPolicy.value = { ...staticPolicy.value, confirmed: true };
    teamTargets.value = builtInTeamTargets();
    nextTeamTargetId = 1;
    presetRules.value = [];
    nextPresetRuleId = 1;
    invalidateTeamCalculationResults();
    notice.value = "已恢复项目设置与摘要；原始快照未持久化，请重新导入同一快照继续计算";
  }

  function exportProject(): void {
    downloadJson("yuhun-project.private.json", makeProject());
  }

  function exportSceneData(): void {
    const exportedAt = new Date();
    const payload = buildSceneDataExport(targetCatalog.value, teamTargets.value, exportedAt);
    downloadJson(
      `onmyoji-yuhun-scenes-${exportedAt.toISOString().slice(0, 10)}.private.json`,
      payload
    );
    notice.value = `已导出 ${payload.summary.sceneCount} 个关卡、${payload.summary.targetCount} 条阵容数据`;
  }

  function importSceneData(payload: SceneDataExportV1): void {
    const importedCatalog = JSON.parse(JSON.stringify(payload.catalog)) as readonly TargetDomain[];
    const importedTargets = JSON.parse(JSON.stringify(payload.targets)).map((target: ImportedTeamTarget) => ({
      ...target,
      difficulty: target.difficulty === null
        ? null
        : target.difficulty ?? (target.forceCalculate === true ? null : teamDifficultyFromLabel(target.label) ?? 100),
      forceCalculate: target.forceCalculate === true,
      locked: target.locked ?? target.builtIn === true
    })) as ImportedTeamTarget[];
    const availableSceneIds = new Set(targetScenePaths(importedCatalog).map((scene) => scene.sceneId));
    const selectedSceneIds = [...new Set(importedTargets.map((target) => target.sceneId))]
      .filter((sceneId) => availableSceneIds.has(sceneId));
    const focusedSceneId = selectedSceneIds[0] ?? targetScenePaths(importedCatalog)[0]?.sceneId ?? "";

    targetCatalog.value = importedCatalog;
    targetViewState.value = {
      catalog: localCatalogOverlay(importedCatalog),
      selectedSceneIds,
      focusedSceneId
    };
    teamTargets.value = importedTargets;
    nextTeamTargetId = Math.max(1, ...teamTargets.value.map((target) => Number(target.id.match(/(?:team-target|manual-target)-(\d+)$/)?.[1] ?? 0) + 1));
    sceneDataImportRevision.value += 1;
    invalidateTeamCalculationResults();
    notice.value = `已导入 ${payload.summary.sceneCount} 个关卡、${payload.summary.targetCount} 条阵容数据`;
  }

  function loadPublishedTeamTargets(rawTargets: readonly Record<string, unknown>[]): void {
    const targets = rawTargets.flatMap((raw, index) => {
      const code = typeof raw.code === "string" ? raw.code : "";
      const label = typeof raw.label === "string" ? raw.label : `R2 阵容 ${index + 1}`;
      const sceneId = typeof raw.sceneId === "string" ? raw.sceneId : "";
      if (code === "" || sceneId === "") return [];
      return [{
        id: typeof raw.id === "string" ? raw.id : `published-team-${index + 1}`,
        source: "team-code" as const,
        code,
        label: label.slice(0, 80),
        sceneId,
        sceneLabel: typeof raw.sceneLabel === "string" ? raw.sceneLabel.slice(0, 80) : sceneId,
        difficulty: typeof raw.difficulty === "number" ? raw.difficulty : null,
        enabled: raw.enabled !== false,
        metricCount: typeof raw.metricCount === "number" ? raw.metricCount : 0,
        inspection: (raw.inspection && typeof raw.inspection === "object" ? raw.inspection : null) as TeamCodeInspectionDTO | null,
        builtIn: true,
        locked: true
      } satisfies ImportedTeamTarget];
    });
    if (targets.length === 0) return;
    const existing = teamTargets.value;
    if (existing.length === 0) {
      teamTargets.value = targets;
      return;
    }
    const existingById = new Map(existing.map((target) => [target.id, target]));
    const existingByCode = new Map(existing.flatMap((target) => target.code === undefined ? [] : [[target.code, target] as const]));
    const merged = targets.map((published) => {
      const previous = existingById.get(published.id) ?? (published.code === undefined ? undefined : existingByCode.get(published.code));
      return previous === undefined ? published : {
        ...published,
        id: previous.id,
        enabled: previous.enabled,
        inspection: previous.inspection ?? published.inspection
      };
    });
    const publishedIds = new Set(merged.map((target) => target.id));
    teamTargets.value = [...merged, ...existing.filter((target) => !publishedIds.has(target.id))];
  }

  function exportHandoff(): void {
    if (!copyAllowed.value) throw new Error("严格复制门禁尚未全部通过");
    if (snapshot.value === null || plan.value === null || checklist.value === null) throw new Error("请先生成双码与对账清单");
    downloadJson("yuhun-mobile-handoff.private.json", buildHandoff(snapshot.value, plan.value, checklist.value));
  }

  async function importHandoff(file: File): Promise<void> {
    const value = parseHandoff(JSON.parse(await file.text()) as unknown);
    mobileHandoff.value = value;
    checklist.value = value.checklist;
    plan.value = {
      discardCode: value.codes.discard,
      rescueCode: value.codes.rescue,
      discardGroupCount: value.aggregate.discardGroupCount,
      rescueGroupCount: value.aggregate.rescueGroupCount,
      roundtripWarnings: [],
      headerSourceValid: true,
      normalPoolCount: 0,
      initialGarbagePoolCount: 0,
      newDiscardCount: 0,
      rescuedFromNewDiscardCount: 0,
      incidentalRestoreCount: value.checklist.incidentalRestoreWarning,
      finalNewDiscardCount: value.aggregate.finalNewDiscardCount,
      capacityProjection: null,
      cleanupComparison: null,
      groups: value.checklist.sections.flatMap((section) => section.groups)
    };
    gateState.value = {
      snapshotValid: true, targetsAndThresholdsValid: true, staticPolicyConfirmed: true,
      headerSourceValid: true, groupLimitValid: true, roundtripValid: true,
      previewComplete: true, tier0ProofPassed: true, selectedTierSimulationPassed: true
    };
    notice.value = "手机交接包已载入；只提供码与对账，不恢复桌面分析会话";
  }

  async function exportDecisionsCsv(): Promise<void> {
    const rows: SpeedCategoryDecision[] = [];
    let page = 1;
    while (true) {
      const result = await client.queryDecisions({ page, pageSize: 100 });
      rows.push(...result.rows);
      if (rows.length >= result.total) break;
      page += 1;
    }
    downloadCsv("yuhun-decisions.private.csv", ["key", "suitId", "position", "initialCount", "hasSpeed", "mainSpeed", "count", "disposition", "riskTier", "reason", "upperBound", "threshold", "riskPer10000"], rows.map((row) => [
      row.key, row.suitId, row.category.position, row.category.initialCount, row.category.initialSpeedPresent, row.category.mainStatIsSpeed,
      row.count, row.disposition, row.riskTier, row.reason, row.subStatUpperBound, row.minimumThreshold, row.riskPerTenThousand
    ]));
  }

  function exportReconciliationCsv(): void {
    if (checklist.value === null) throw new Error("没有对账清单");
    downloadCsv("yuhun-reconciliation.private.csv", ["section", "code", "pool", "group", "expected", "actual", "delta"], checklist.value.sections.flatMap((section) => section.groups.map((group) => {
      const actual = actuals.value[`${section.id}:${group.index}`] ?? "";
      return [section.title, group.code, group.pool, group.name, group.expected, actual, actual === "" ? "" : Number(actual) - group.expected];
    })));
  }

  async function clearSession(): Promise<void> {
    sessionReady = false;
    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    try { await deleteWorkbenchSession(); } catch { /* local persistence is best effort */ }
    await client.resetSession();
    rawSnapshotBuffer = null;
    snapshotNeedsPersist = false;
    snapshot.value = null;
    analysis.value = null;
    inventory.value = null;
    decisions.value = null;
    yuhunDecisions.value = null;
    yuhunDecisionFacets.value = null;
    teamTargets.value = builtInTeamTargets();
    teamCalculations.value = [];
    teamCalculationProgress.value = {};
    nextTeamTargetId = 1;
    presetRules.value = [];
    nextPresetRuleId = 1;
    plan.value = null;
    simulation.value = null;
    checklist.value = null;
    mobileHandoff.value = null;
    actuals.value = {};
    gateState.value = {};
    targetViewState.value = null;
    targetCatalog.value = TARGET_CATALOG;
    staticPolicy.value = { ...DEFAULT_POLICY };
    defaultDisposition.value = "retain";
    sessionReady = true;
    restoreCompleted.value = true;
    notice.value = "内存会话和本机自动保存已清空";
  }

  async function deleteProject(): Promise<void> {
    await deleteLocalProject();
    notice.value = "本地项目已删除";
  }

  return {
    snapshot, analysis, inventory, decisions, yuhunDecisions, yuhunDecisionFacets, teamTargets, teamCalculations, teamCalculationProgress, enabledTeamTargets, enabledTeamMetricCount,
    presetRules, enabledPresetRules,
    plan, simulation, checklist, mobileHandoff,
    gateState, actuals, targetViewState, targetCatalog, sceneDataImportRevision, templateIds, riskTier, budgetPerTenThousand, staticPolicy, existingFilterCode,
    busy, restoring, restoreCompleted, progress, error, notice, teamCalculationPaused, copyAllowed, reconciliationComplete,
    performanceHistory, teamCalculationResourceProfile, customTeamCalculationWorkerCount, teamCalculationSchedulerDebugEnabled, teamCalculationSchedulerDebugLog,
    importSnapshot, loadInventory, queryYuhunDetails, runAnalysis, loadDecisions, loadYuhunDecisions, loadYuhunDecisionFacets, importYuhunFilterCode, saveManualTeamTarget, saveEditedTeamTarget,
    restoreLocalSession, calculateTeamTargets, pauseTeamCalculation, resumeTeamCalculation, resetTeamCalculations, teamCalculationOptionsForResume, teamCalculationFor, teamCalculationProgressFor, inspectTeamTarget, inspectStoredTeamTarget, addInspectedTeamTarget,
    setTeamTargetEnabled, setTeamTargetGroupEnabled, moveTeamTarget, removeTeamTarget,
    savePresetRule, setPresetRuleEnabled, setPresetRulePoolEnabled, removePresetRule,
    invalidatePolicy, confirmPolicy, setTeamCalculationResourceProfile, setCustomTeamCalculationWorkerCount, setTeamCalculationSchedulerDebugEnabled, clearTeamCalculationSchedulerDebugLog,
    defaultDisposition, setDefaultDisposition, setRiskTier, setTargetViewState, setTemplateIds, invalidateHeader,
    generatePlan, runSimulation, cancelSimulation, copyCode, downloadCode, saveLocal, loadLocal, exportProject, exportSceneData, importSceneData, exportHandoff,
    importHandoff, exportDecisionsCsv, exportReconciliationCsv, clearSession, deleteProject, clearPerformanceRecords, loadPublishedTeamTargets
  };
});
