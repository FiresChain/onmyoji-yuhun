import { calculateBaselineBundle, type DominanceThresholds } from "./baseline.js";
import { buildDecisionPlan, type DecisionPlan } from "./decision-plan.js";
import { calculateYuhunCapacity } from "./capacity.js";
import {
  decideSpeedCategories,
  FREQUENCY_BIAS_NOTICE,
  estimateSpeedCategoryFrequencies,
  type SpeedCategoryDecision,
  type SpeedDecisionReport
} from "./decision.js";
import {
  buildDualFilterDrafts,
  filterShareFromDraft,
  previewDualFilterShares,
  type DualFilterDrafts,
  type StaticRetentionPolicy
} from "./rules.js";
import { simulateSpeedValidation, type SpeedValidationReport } from "./simulate.js";
import {
  calculateTeamTargetBatch,
  estimateTeamCalculationWork,
  type ManualShikigamiCalculationInput,
  type TeamCalculationProgress,
  type TeamCalculationReportDTO,
  type TeamCalculationRequest,
  type TeamCalculationYuhunDTO
} from "./team-calculation.js";
import {
  SCATTERED_SPEED_TEMPLATE,
  ZHAOCAI_SPEED_TEMPLATE,
  type RiskTier,
  type YuhunTemplate
} from "./templates.js";
import { STAT_LABELS } from "./mappings.js";
import type { FilterCriteria, StatId } from "./types.js";
import { matchFilterShare } from "./matcher.js";
import { parseGameSnapshot, type SnapshotHeroBase, type YyxYuhun } from "./yyx.js";
import {
  buildYuhunDecisionRows,
  type AnalysisRuleInput,
  type YuhunDecisionRowDTO
} from "./yuhun-decision.js";

export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
export const MAX_SNAPSHOT_ITEMS = 50_000;
export const WORKFLOW_SCHEMA_VERSION = 1 as const;

export type WorkflowStage =
  | "snapshot"
  | "targets"
  | "policy"
  | "analysis"
  | "plan"
  | "simulation"
  | "reconciliation";

export interface WorkflowErrorDTO {
  readonly stage: WorkflowStage;
  readonly code: string;
  readonly path: string | null;
  readonly message: string;
}

export class WorkflowError extends Error {
  readonly dto: WorkflowErrorDTO;

  constructor(dto: WorkflowErrorDTO) {
    super(dto.message);
    this.name = "WorkflowError";
    this.dto = dto;
  }
}

export interface SnapshotSummaryDTO {
  readonly sha256: string;
  readonly total: number;
  readonly stars: Readonly<Record<string, number>>;
  readonly levels: Readonly<Record<string, number>>;
  readonly sixStarUnleveled: number;
  readonly initialSubStats: Readonly<Record<string, number>>;
  readonly locked: number;
  readonly garbage: number;
  readonly format?: "yyx" | "onmyoji-hub";
  readonly heroCount?: number;
  readonly importedAt: string;
}

export interface InventoryQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly search?: string;
  readonly level?: number;
  readonly star?: number;
  readonly garbage?: boolean;
}

export interface InventoryRowDTO {
  readonly row: number;
  readonly suit: string;
  readonly position: number;
  readonly star: number;
  readonly level: number;
  readonly mainStat: StatId;
  readonly mainValue: number;
  /** Boss yuhun's per-piece intrinsic property, displayed with the main stat. */
  readonly intrinsicStats: readonly InventoryStatDTO[];
  readonly subStats: readonly StatId[];
  readonly subStatValues: readonly InventoryStatDTO[];
  readonly initialSubStatCount: number | null;
  readonly locked: boolean;
  readonly garbage: boolean;
}

export interface InventoryStatDTO {
  readonly stat: StatId;
  readonly value: number;
}

export interface PageDTO<T> {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly rows: readonly T[];
}

export interface AnalyzeInput {
  readonly defaultDisposition?: "retain" | "discard";
  readonly templateIds: readonly ("zhaocai-speed" | "scattered-speed")[];
  readonly riskTier: RiskTier;
  readonly budgetPerTenThousand?: number;
  readonly rules?: readonly AnalysisRuleInput[];
  readonly teamReports?: readonly TeamCalculationReportDTO[];
  /** Enables privacy-safe phase/counter diagnostics for this analysis run. */
  readonly diagnostics?: boolean;
}

export interface AnalysisDiagnosticsDTO {
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
  readonly stages: readonly {
    readonly id: "baseline" | "frequency" | "category-decision" | "decision-rows";
    readonly elapsedMs: number;
  }[];
}

export interface BaselineSlotDTO {
  readonly position: number;
  readonly role: string;
  readonly suit: string | null;
  readonly speed: number;
}

export interface BaselineDTO {
  readonly templateId: string;
  readonly baseline: number | null;
  readonly slots: readonly BaselineSlotDTO[];
}

export interface AnalysisSummaryDTO {
  readonly templates: readonly YuhunTemplate[];
  readonly baselines: readonly BaselineDTO[];
  readonly thresholds: DominanceThresholds;
  readonly sampleSize: number;
  readonly categoryCount: number;
  readonly observedDiscardCount: number;
  readonly observedDiscardCoverage: number | null;
  readonly expectedMissesPerTenThousand: number;
  readonly tier0CategoryCount: number;
  readonly tier1CategoryCount: number;
  readonly reasonCounts: Readonly<Record<string, number>>;
  readonly frequencyBiasNotice: string;
  readonly inventoryCapacity: InventoryCapacityDTO;
  readonly markedDiscardProjection: CapacityProjectionDTO;
  readonly diagnostics?: AnalysisDiagnosticsDTO;
}

export interface InventoryCapacityDTO {
  readonly totalCount: number;
  readonly level15Count: number;
  readonly capacity: number;
  readonly freeSlots: number;
  readonly overCapacityCount: number;
}

export interface CapacityProjectionDTO {
  readonly before: InventoryCapacityDTO;
  readonly after: InventoryCapacityDTO;
  readonly discardCount: number;
}

export interface CleanupComparisonDTO {
  readonly markedCount: number;
  readonly planCleanupCount: number;
  readonly netDifference: number;
  readonly affectedCount: number;
  readonly missedMarkedCount: number;
  readonly extraCleanupCount: number;
}

export interface DecisionQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly disposition?: "discard" | "retain";
  readonly riskTier?: RiskTier | "none";
  readonly position?: number;
  readonly suitId?: number;
  readonly search?: string;
}

export interface YuhunDecisionQuery {
  readonly criteria?: FilterCriteria;
  readonly page?: number;
  readonly pageSize?: number;
  readonly disposition?: "discard" | "retain";
  readonly position?: number;
  readonly suits?: readonly string[];
  readonly positions?: readonly number[];
  readonly stars?: readonly number[];
  readonly levels?: readonly number[];
  readonly mainStats?: readonly StatId[];
  readonly subStats?: readonly StatId[];
  readonly dispositions?: readonly ("discard" | "retain")[];
  readonly reasons?: readonly string[];
  readonly reasonMode?: "or" | "and";
  readonly search?: string;
}

export interface YuhunDecisionFacetsDTO {
  readonly suits: readonly string[];
  readonly positions: readonly number[];
  readonly stars: readonly number[];
  readonly levels: readonly number[];
  readonly mainStats: readonly StatId[];
  readonly subStats: readonly StatId[];
  readonly dispositions: readonly ("discard" | "retain")[];
  readonly reasons: readonly string[];
}

export interface GeneratePlanInput {
  /** Header extracted by the private yuhun-code API. */
  readonly headerHex: string;
  readonly staticPolicy: StaticRetentionPolicy;
}

/** Drafts are sent to onmyoji-api for private binary encoding and are never persisted. */
export interface GeneratedPlanDTO {
  readonly summary: PlanSummaryDTO;
  readonly discardDraft: import("./types.js").YuhunFilterDraft | null;
  readonly rescueDraft: import("./types.js").YuhunFilterDraft | null;
}

export interface PreviewGroupDTO {
  readonly pool: "normal" | "new-garbage" | "historical-garbage" | "combined";
  readonly code: "D" | "E";
  readonly index: number;
  readonly name: string;
  readonly expected: number;
}

export interface PlanSummaryDTO {
  readonly discardCode: string | null;
  readonly rescueCode: string | null;
  readonly discardGroupCount: number;
  readonly rescueGroupCount: number;
  readonly roundtripWarnings: readonly string[];
  readonly headerSourceValid: true;
  readonly normalPoolCount: number;
  readonly initialGarbagePoolCount: number;
  readonly newDiscardCount: number;
  readonly rescuedFromNewDiscardCount: number;
  readonly incidentalRestoreCount: number;
  readonly finalNewDiscardCount: number;
  readonly capacityProjection: CapacityProjectionDTO | null;
  readonly cleanupComparison: CleanupComparisonDTO | null;
  readonly groups: readonly PreviewGroupDTO[];
}

export interface SimulationSummaryDTO {
  readonly report: SpeedValidationReport;
  readonly tier0Passed: boolean;
  readonly selectedTierPassed: boolean;
}

export interface ChecklistSectionDTO {
  readonly id: "discard-normal" | "rescue-new" | "rescue-history" | "rescue-combined";
  readonly title: string;
  readonly code: "D" | "E";
  readonly pool: PreviewGroupDTO["pool"];
  readonly groups: readonly PreviewGroupDTO[];
}

export interface ImportChecklistDTO {
  readonly sections: readonly ChecklistSectionDTO[];
  readonly expectedFinalDiscard: number;
  readonly incidentalRestoreWarning: number;
}

export interface TeamCodeInspectionDTO {
  readonly slotCount: number;
  readonly gameSceneId: number | null;
  /** Root[4] team name, exposed only to the local import workflow. */
  readonly teamName: string | null;
  readonly occupiedSlots: number;
  readonly compressedBytes: number;
  readonly inflatedBytes: number;
  readonly entities: readonly {
    readonly index: number;
    readonly kind: "onmyoji" | "shikigami";
    readonly shikigamiId: number | null;
    readonly suitNames: readonly string[];
    /** null means the switch used an unknown value. */
    readonly yuhunConfigEnabled: boolean | null;
    readonly occupied: boolean;
    readonly hasConfig: boolean;
    readonly attributeRangeCount: number;
    readonly mainStatSlotCount: number;
  }[];
  readonly editableTargets: readonly ManualShikigamiCalculationInput[];
  readonly privateMetadataMasked: true;
  readonly participatesInCalculation: boolean;
}

function workflowFailure(stage: WorkflowStage, code: string, message: string, path: string | null = null): never {
  throw new WorkflowError({ stage, code, path, message });
}

function sanitizeError(stage: WorkflowStage, error: unknown): never {
  if (error instanceof WorkflowError) throw error;
  const candidate = error as { readonly code?: unknown; readonly message?: unknown };
  const code = typeof candidate?.code === "string" ? candidate.code : "INVALID_INPUT";
  const rawMessage = typeof candidate?.message === "string" ? candidate.message : "处理失败";
  const pathMatch = rawMessage.match(/(?: at |^)([a-zA-Z][\w.\[\]-]*)/);
  const redacted = rawMessage
    .replace(/[0-9a-f]{24,}/gi, "[已遮盖]")
    .replace(/((?:^|\s)(?:id|ID|equip_id|账号|御魂)[=:：\s]+)[A-Za-z0-9_-]{4,}/g, "$1[已遮盖]");
  workflowFailure(stage, code, redacted, pathMatch?.[1] ?? null);
}

function pageBounds(page = 1, pageSize = 25): { page: number; pageSize: number; start: number } {
  if (!Number.isSafeInteger(page) || page < 1) workflowFailure("analysis", "INVALID_PAGE", "页码必须大于 0", "page");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    workflowFailure("analysis", "INVALID_PAGE_SIZE", "每页数量必须在 1 到 100 之间", "pageSize");
  }
  return { page, pageSize, start: (page - 1) * pageSize };
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function inventoryCapacity(
  items: readonly YyxYuhun[],
  excludedIds: ReadonlySet<string> = new Set()
): InventoryCapacityDTO {
  let totalCount = 0;
  let level15Count = 0;
  for (const item of items) {
    if (item.star !== 6 || excludedIds.has(item.id)) continue;
    totalCount += 1;
    if (item.level === 15) level15Count += 1;
  }
  const capacity = calculateYuhunCapacity(level15Count);
  return {
    totalCount,
    level15Count,
    capacity,
    freeSlots: Math.max(0, capacity - totalCount),
    overCapacityCount: Math.max(0, totalCount - capacity)
  };
}

function snapshotSummary(
  items: readonly YyxYuhun[],
  sha256: string,
  format: NonNullable<SnapshotSummaryDTO["format"]>,
  heroCount: number
): SnapshotSummaryDTO {
  const stars: Record<string, number> = {};
  const levels: Record<string, number> = {};
  const initialSubStats: Record<string, number> = {};
  let sixStarUnleveled = 0;
  let locked = 0;
  let garbage = 0;
  for (const item of items) {
    increment(stars, String(item.star));
    increment(levels, String(item.level));
    if (item.star === 6 && item.level <= 2) {
      sixStarUnleveled += 1;
      increment(initialSubStats, String(Object.keys(item.initialSubStats ?? {}).length));
    }
    if (item.lock) locked += 1;
    if (item.garbage) garbage += 1;
  }
  return {
    sha256,
    total: items.length,
    stars,
    levels,
    sixStarUnleveled,
    initialSubStats,
    locked,
    garbage,
    format,
    heroCount,
    importedAt: new Date().toISOString()
  };
}

function templatesFor(input: AnalyzeInput): YuhunTemplate[] {
  if (!Array.isArray(input.templateIds) || input.templateIds.length === 0) {
    workflowFailure("targets", "NO_TEMPLATE", "至少启用一个目标模板", "templateIds");
  }
  const seen = new Set<string>();
  return input.templateIds.map((id) => {
    if (seen.has(id)) workflowFailure("targets", "DUPLICATE_TEMPLATE", "目标模板不能重复", "templateIds");
    seen.add(id);
    const template: YuhunTemplate = id === "zhaocai-speed"
      ? ZHAOCAI_SPEED_TEMPLATE
      : SCATTERED_SPEED_TEMPLATE;
    return { ...template, sets: template.sets.map((set) => ({ ...set, suitIds: [...set.suitIds] })), riskTier: input.riskTier };
  });
}

function mergeThresholds(parts: readonly DominanceThresholds[]): DominanceThresholds {
  return Object.assign({}, ...parts);
}

function previewGroups(
  plan: DecisionPlan,
  items: readonly YyxYuhun[],
  markedDiscardIds: ReadonlySet<string>
): {
  summary: PlanSummaryDTO;
  checklist: ImportChecklistDTO;
} {
  const preview = previewDualFilterShares({
    discardShare: plan.discardDraft === null ? null : filterShareFromDraft(plan.discardDraft),
    rescueShare: plan.rescueDraft === null ? null : filterShareFromDraft(plan.rescueDraft),
    items
  });
  const groups: PreviewGroupDTO[] = [];
  for (const group of preview.discardMatch?.groups ?? []) {
    groups.push({ pool: "normal", code: "D", index: group.groupIndex, name: group.name, expected: group.matchedIds.length });
  }
  const appendRescue = (pool: PreviewGroupDTO["pool"], matches: typeof preview.rescueMatch): void => {
    for (const group of matches?.groups ?? []) {
      groups.push({ pool, code: "E", index: group.groupIndex, name: group.name, expected: group.matchedIds.length });
    }
  };
  appendRescue("new-garbage", preview.rescueFromNewDiscardMatch);
  appendRescue("historical-garbage", preview.incidentalRestoreMatch);
  appendRescue("combined", preview.rescueMatch);
  const finalDiscardIds = new Set(preview.finalNewDiscardIds);
  const capacityProjection: CapacityProjectionDTO = {
    before: inventoryCapacity(items),
    after: inventoryCapacity(items, finalDiscardIds),
    discardCount: finalDiscardIds.size
  };
  const missedMarkedCount = [...markedDiscardIds].filter((id) => !finalDiscardIds.has(id)).length;
  const extraCleanupCount = [...finalDiscardIds].filter((id) => !markedDiscardIds.has(id)).length;
  const cleanupComparison: CleanupComparisonDTO = {
    markedCount: markedDiscardIds.size,
    planCleanupCount: finalDiscardIds.size,
    netDifference: finalDiscardIds.size - markedDiscardIds.size,
    affectedCount: missedMarkedCount + extraCleanupCount,
    missedMarkedCount,
    extraCleanupCount
  };
  const sections: ChecklistSectionDTO[] = [
    { id: "discard-normal", title: "D · 正常池", code: "D", pool: "normal", groups: groups.filter((group) => group.pool === "normal") },
    { id: "rescue-new", title: "E · 新弃置池", code: "E", pool: "new-garbage", groups: groups.filter((group) => group.pool === "new-garbage") },
    { id: "rescue-history", title: "E · 历史弃置池", code: "E", pool: "historical-garbage", groups: groups.filter((group) => group.pool === "historical-garbage") },
    { id: "rescue-combined", title: "E · 合并池", code: "E", pool: "combined", groups: groups.filter((group) => group.pool === "combined") }
  ];
  return {
    summary: {
      discardCode: null,
      rescueCode: null,
      discardGroupCount: plan.manifest.discardGroupCount,
      rescueGroupCount: plan.manifest.rescueGroupCount,
      roundtripWarnings: [],
      headerSourceValid: true,
      normalPoolCount: preview.normalPoolCount,
      initialGarbagePoolCount: preview.initialGarbagePoolCount,
      newDiscardCount: preview.newDiscardIds.length,
      rescuedFromNewDiscardCount: preview.rescuedFromNewDiscardIds.length,
      incidentalRestoreCount: preview.incidentalRestoreIds.length,
      finalNewDiscardCount: preview.finalNewDiscardIds.length,
      capacityProjection,
      cleanupComparison,
      groups
    },
    checklist: {
      sections,
      expectedFinalDiscard: preview.finalNewDiscardIds.length,
      incidentalRestoreWarning: preview.incidentalRestoreIds.length
    }
  };
}

export class YuhunWorkflow {
  private items: YyxYuhun[] | null = null;
  private heroBases: ReadonlyMap<number, SnapshotHeroBase> = new Map();
  private summary: SnapshotSummaryDTO | null = null;
  private analysisKey: string | null = null;
  private analysis: AnalysisSummaryDTO | null = null;
  private yuhunDecisions: readonly YuhunDecisionRowDTO[] | null = null;
  private markedDiscardIds: ReadonlySet<string> | null = null;
  private decision: SpeedDecisionReport | null = null;
  private decisionInput: Parameters<typeof decideSpeedCategories>[0] | null = null;
  private draftPlan: DecisionPlan | null = null;
  private planInput: Parameters<typeof buildDualFilterDrafts>[0] | null = null;
  private planSummary: PlanSummaryDTO | null = null;
  private checklist: ImportChecklistDTO | null = null;
  private simulation: SimulationSummaryDTO | null = null;
  private frequencyCache: ReturnType<typeof estimateSpeedCategoryFrequencies> | null = null;
  private readonly baselineCache = new Map<string, ReturnType<typeof calculateBaselineBundle>[number]>();
  private readonly decisionCache = new Map<string, SpeedDecisionReport>();
  private readonly planCache = new Map<string, {
    readonly plan: DecisionPlan;
    readonly summary: PlanSummaryDTO;
    readonly checklist: ImportChecklistDTO;
  }>();

  importSnapshot(json: unknown, sha256: string): SnapshotSummaryDTO {
    try {
      if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sha256)) {
        workflowFailure("snapshot", "INVALID_SHA256", "快照 SHA-256 必须是 64 位十六进制文本", "sha256");
      }
      const parsed = parseGameSnapshot(json);
      if (parsed.items.length > MAX_SNAPSHOT_ITEMS) {
        workflowFailure("snapshot", "ITEM_LIMIT_EXCEEDED", `快照御魂数量超过 ${MAX_SNAPSHOT_ITEMS} 件限制`, "data.hero_equips");
      }
      this.resetSession();
      this.items = [...parsed.items];
      this.heroBases = parsed.heroBases;
      this.summary = snapshotSummary(parsed.items, sha256, parsed.format, parsed.heroBases.size);
      return this.summary;
    } catch (error) {
      return sanitizeError("snapshot", error);
    }
  }

  analyze(input: AnalyzeInput): AnalysisSummaryDTO {
    if (this.items === null) workflowFailure("snapshot", "SNAPSHOT_REQUIRED", "请先导入 yyx 快照");
    const key = JSON.stringify(input);
    if (key === this.analysisKey && this.analysis !== null) return this.analysis;
    try {
      const templates: YuhunTemplate[] = [];
      const diagnosticsEnabled = input.diagnostics === true;
      const diagnosticStages: AnalysisDiagnosticsDTO["stages"][number][] = [];
      const diagnosticStage = (id: AnalysisDiagnosticsDTO["stages"][number]["id"], startedAt: number) => { if (diagnosticsEnabled) diagnosticStages.push({ id, elapsedMs: performanceNow() - startedAt }); };
      const performanceNow = () => performance.now();
      const level15 = this.items.filter(item => item.star === 6 && item.level === 15);
      const thresholds: DominanceThresholds = {};
      const frequencies = { sampleSize: this.items.filter(item => item.star === 6 && item.level === 0).length, categories: [] as { count: number }[] };
      const decision: SpeedDecisionReport = { sampleSize: frequencies.sampleSize, biasNotice: FREQUENCY_BIAS_NOTICE, budgetPerTenThousand: 0, expectedMissesPerTenThousand: 0, observedDiscardCount: 0, observedDiscardCoverage: null, tier0DiscardedCategoryCount: 0, tier1DiscardedCategoryCount: 0, categories: [] };
      const reasonCounts: Record<string, number> = {};
      const baselines: BaselineDTO[] = [];
      const decisionRowsStartedAt = performanceNow();
      const yuhunDecisions = buildYuhunDecisionRows(
        this.items,
        input.rules ?? [],
        input.teamReports ?? [],
        input.defaultDisposition ?? "retain"
      );
      diagnosticStage("decision-rows", decisionRowsStartedAt);
      for (const row of yuhunDecisions) for (const tag of row.reasonTags ?? [row.reason]) increment(reasonCounts, tag);
      const markedDiscardIds = new Set(
        yuhunDecisions.flatMap((row, index) =>
          row.disposition === "discard" && this.items![index]!.star === 6 && this.items![index]!.level === 0 && !this.items![index]!.lock && !this.items![index]!.garbage
            ? [this.items![index]!.id]
            : []
        )
      );
      this.analysis = {
        templates,
        baselines,
        thresholds,
        sampleSize: decision.sampleSize,
        categoryCount: decision.categories.length,
        observedDiscardCount: decision.observedDiscardCount,
        observedDiscardCoverage: decision.observedDiscardCoverage,
        expectedMissesPerTenThousand: decision.expectedMissesPerTenThousand,
        tier0CategoryCount: decision.tier0DiscardedCategoryCount,
        tier1CategoryCount: decision.tier1DiscardedCategoryCount,
        reasonCounts,
        frequencyBiasNotice: "按当前库存及单件决策生成，不使用速度分类或风险档位。",
        inventoryCapacity: inventoryCapacity(this.items),
        markedDiscardProjection: {
          before: inventoryCapacity(this.items),
          after: inventoryCapacity(this.items, markedDiscardIds),
          discardCount: markedDiscardIds.size
        },
        ...(diagnosticsEnabled ? {
          diagnostics: {
            itemCount: this.items.length,
            level15Count: level15.length,
            level0SampleCount: frequencies.sampleSize,
            templateCount: templates.length,
            categoryCount: decision.categories.length,
            observedCategoryCount: frequencies.categories.filter((category) => category.count > 0).length,
            ruleCount: input.rules?.length ?? 0,
            teamReportCount: input.teamReports?.length ?? 0,
            teamEntityCount: (input.teamReports ?? []).reduce((sum, report) => sum + report.entities.length, 0),
            potentialEvidenceCount: (input.teamReports ?? []).reduce((sum, report) => sum + report.entities.reduce((entitySum, entity) => entitySum + (entity.potentialEvidence?.length ?? entity.potentialYuhunIds?.length ?? 0), 0), 0),
            potentialYuhunCount: new Set((input.teamReports ?? []).flatMap((report) => report.entities.flatMap((entity) => entity.potentialYuhunIds ?? entity.potentialEvidence?.map((entry) => entry.yuhunId) ?? []))).size,
            tier1CandidateCount: decision.tier1SelectionDiagnostics?.candidateCount ?? 0,
            tier1MaximumCoverage: decision.tier1SelectionDiagnostics?.maximumCoverage ?? 0,
            tier1TransitionCount: decision.tier1SelectionDiagnostics?.transitionCount ?? 0,
            tier1UpdatedStateCount: decision.tier1SelectionDiagnostics?.updatedStateCount ?? 0,
            stages: diagnosticStages
          }
        } : {})
      };
      this.yuhunDecisions = yuhunDecisions;
      this.markedDiscardIds = markedDiscardIds;
      this.analysisKey = key;
      this.decision = decision;
      this.decisionInput = null;
      this.draftPlan = null;
      this.planInput = null;
      this.planSummary = null;
      this.checklist = null;
      this.simulation = null;
      return this.analysis;
    } catch (error) {
      return sanitizeError("analysis", error);
    }
  }

  queryInventory(query: InventoryQuery = {}): PageDTO<InventoryRowDTO> {
    if (this.items === null) workflowFailure("snapshot", "SNAPSHOT_REQUIRED", "请先导入 yyx 快照");
    const { page, pageSize, start } = pageBounds(query.page, query.pageSize);
    const search = query.search?.trim().toLocaleLowerCase() ?? "";
    const filtered = this.items.filter((item) =>
      (query.level === undefined || item.level === query.level) &&
      (query.star === undefined || item.star === query.star) &&
      (query.garbage === undefined || item.garbage === query.garbage) &&
      (search === "" || item.name.toLocaleLowerCase().includes(search))
    );
    const statEntries = (stats: Partial<Record<StatId, number>>): InventoryStatDTO[] => (
      Object.entries(stats).map(([stat, value]) => ({ stat: stat as StatId, value }))
    );
    const rows = filtered.slice(start, start + pageSize).map((item) => ({
      row: this.items!.indexOf(item) + 1,
      suit: item.name,
      position: item.position,
      star: item.star,
      level: item.level,
      mainStat: item.mainStat,
      mainValue: item.mainValue,
      intrinsicStats: statEntries(item.intrinsicStats),
      subStats: Object.keys(item.subStats) as StatId[],
      subStatValues: statEntries(item.subStats),
      initialSubStatCount: item.initialSubStats === null ? null : Object.keys(item.initialSubStats).length,
      locked: item.lock,
      garbage: item.garbage
    }));
    return { page, pageSize, total: filtered.length, rows };
  }

  queryYuhunDetails(ids: readonly string[]): readonly TeamCalculationYuhunDTO[] {
    if (this.items === null) workflowFailure("snapshot", "SNAPSHOT_REQUIRED", "请先导入 yyx 快照");
    const requested = new Set(ids);
    const statEntries = (stats: Partial<Record<StatId, number>>) => Object.entries(stats).map(([stat, value]) => ({ stat: stat as StatId, value }));
    return this.items.filter((item) => requested.has(item.id)).map((item) => ({
      yuhunId: item.id,
      position: item.position,
      suit: item.name,
      mainStat: item.mainStat,
      mainStatLabel: STAT_LABELS[item.mainStat],
      mainValue: item.mainValue,
      level: item.level,
      star: item.star,
      subStats: statEntries(item.subStats),
      intrinsicStats: statEntries(item.intrinsicStats)
    }));
  }

  queryDecisions(query: DecisionQuery = {}): PageDTO<SpeedCategoryDecision> {
    if (this.decision === null) workflowFailure("analysis", "ANALYSIS_REQUIRED", "请先运行账号分析");
    const { page, pageSize, start } = pageBounds(query.page, query.pageSize);
    const search = query.search?.trim().toLocaleLowerCase() ?? "";
    const filtered = this.decision.categories.filter((entry) =>
      (query.disposition === undefined || entry.disposition === query.disposition) &&
      (query.riskTier === undefined || (query.riskTier === "none" ? entry.riskTier === null : entry.riskTier === query.riskTier)) &&
      (query.position === undefined || entry.category.position === query.position) &&
      (query.suitId === undefined || entry.suitId === query.suitId) &&
      (search === "" || entry.key.toLocaleLowerCase().includes(search) || entry.reason.toLocaleLowerCase().includes(search))
    );
    return { page, pageSize, total: filtered.length, rows: filtered.slice(start, start + pageSize) };
  }

  generatePlan(input: GeneratePlanInput): GeneratedPlanDTO {
    if (this.items === null || this.markedDiscardIds === null) workflowFailure("plan", "ANALYSIS_REQUIRED", "请先完成账号分析");
    try {
      const planInput = { headerHex: input.headerHex };
      const planKey = JSON.stringify({ planInput, analysisKey: this.analysisKey });
      const cached = this.planCache.get(planKey);
      const plan = cached?.plan ?? buildDecisionPlan(this.items, this.markedDiscardIds, input.headerHex);
      const preview = cached === undefined
        ? previewGroups(plan, this.items, this.markedDiscardIds)
        : { summary: cached.summary, checklist: cached.checklist };
      if (cached === undefined) {
        this.planCache.set(planKey, { plan, summary: preview.summary, checklist: preview.checklist });
      }
      this.draftPlan = plan;
      this.planInput = null;
      this.planSummary = preview.summary;
      this.checklist = preview.checklist;
      this.simulation = null;
      return {
        summary: preview.summary,
        discardDraft: plan.discardDraft,
        rescueDraft: plan.rescueDraft
      };
    } catch (error) {
      return sanitizeError("plan", error);
    }
  }

  runSimulation(
    sampleSize = 100_000,
    seed = 1,
    onProgress?: (completed: number, total: number) => void
  ): SimulationSummaryDTO {
    if (this.items === null || this.planInput === null) workflowFailure("simulation", "PLAN_REQUIRED", "请先生成并预演 D/E 双码");
    try {
      const report = simulateSpeedValidation({
        planInput: this.planInput,
        sourceItems: this.items,
        sampleSize,
        seed,
        ...(onProgress === undefined ? {} : { onProgress })
      });
      this.simulation = {
        report,
        tier0Passed: report.tier0MissCount === 0,
        selectedTierPassed: report.exactBudgetSatisfied && report.planDiscardIsDecisionDiscardSubset
      };
      return this.simulation;
    } catch (error) {
      return sanitizeError("simulation", error);
    }
  }

  buildImportChecklist(): ImportChecklistDTO {
    if (this.checklist === null) workflowFailure("reconciliation", "PLAN_REQUIRED", "请先生成并预演 D/E 双码");
    return this.checklist;
  }

  queryYuhunDecisions(query: YuhunDecisionQuery = {}): PageDTO<YuhunDecisionRowDTO> {
    if (this.yuhunDecisions === null) workflowFailure("analysis", "ANALYSIS_REQUIRED", "请先运行账号分析");
    const criteria = query.criteria;
    const matched = criteria && Object.values(criteria).some(values => values.length > 0)
      ? new Set(matchFilterShare({ format: "onmyoji-yuhun-filter", schemaVersion: 1, headerHex: "", planKind: "discard", planKindValue: 0, warnings: [], groups: [{ name: "筛选", raw: { typeMaskHex: "", optionMaskHex: "" }, criteria }] }, this.items ?? []).groups[0]?.matchedIds ?? [])
      : null;
    const { page, pageSize, start } = pageBounds(query.page, query.pageSize);
    const search = query.search?.trim().toLocaleLowerCase() ?? "";
    const suits = query.suits === undefined ? null : new Set(query.suits);
    const positions = query.positions === undefined ? null : new Set(query.positions);
    const stars = query.stars === undefined ? null : new Set(query.stars);
    const levels = query.levels === undefined ? null : new Set(query.levels);
    const mainStats = query.mainStats === undefined ? null : new Set(query.mainStats);
    const subStats = query.subStats === undefined ? null : new Set(query.subStats);
    const dispositions = query.dispositions === undefined ? null : new Set(query.dispositions);
    const reasons = query.reasons === undefined ? null : new Set(query.reasons);
    const filtered = this.yuhunDecisions.filter((entry) =>
      (matched === null || matched.has(this.items?.[entry.row - 1]?.id ?? "")) &&
      (query.disposition === undefined || entry.disposition === query.disposition) &&
      (query.position === undefined || entry.position === query.position) &&
      (suits === null || suits.has(entry.suit)) &&
      (positions === null || positions.has(entry.position)) &&
      (stars === null || stars.has(entry.star)) &&
      (levels === null || levels.has(entry.level)) &&
      (mainStats === null || mainStats.has(entry.mainStat)) &&
      (subStats === null || entry.subStats.some((stat) => subStats.has(stat))) &&
      (dispositions === null || dispositions.has(entry.disposition)) &&
      (reasons === null || (reasons.size > 0 && (query.reasonMode === "and"
        ? [...reasons].every((tag) => (entry.reasonTags ?? [entry.reason]).includes(tag))
        : (entry.reasonTags ?? [entry.reason]).some((tag) => reasons.has(tag))))) &&
      (search === "" || entry.suit.toLocaleLowerCase().includes(search) || (entry.reasonTags ?? [entry.reason]).some((tag) => tag.toLocaleLowerCase().includes(search)))
    );
    return { page, pageSize, total: filtered.length, rows: filtered.slice(start, start + pageSize) };
  }

  queryYuhunDecisionFacets(): YuhunDecisionFacetsDTO {
    if (this.yuhunDecisions === null) workflowFailure("analysis", "ANALYSIS_REQUIRED", "请先运行账号分析");
    const suits = new Set<string>();
    const positions = new Set<number>();
    const stars = new Set<number>();
    const levels = new Set<number>();
    const mainStats = new Set<StatId>();
    const subStats = new Set<StatId>();
    const dispositions = new Set<"discard" | "retain">();
    const reasons = new Set<string>();
    for (const entry of this.yuhunDecisions) {
      suits.add(entry.suit);
      positions.add(entry.position);
      stars.add(entry.star);
      levels.add(entry.level);
      mainStats.add(entry.mainStat);
      for (const stat of entry.subStats) subStats.add(stat);
      dispositions.add(entry.disposition);
      for (const tag of entry.reasonTags ?? [entry.reason]) reasons.add(tag);
    }
    return {
      suits: [...suits].sort((left, right) => left.localeCompare(right)),
      positions: [...positions].sort((left, right) => left - right),
      stars: [...stars].sort((left, right) => left - right),
      levels: [...levels].sort((left, right) => left - right),
      mainStats: [...mainStats].sort(),
      subStats: [...subStats].sort(),
      dispositions: [...dispositions].sort(),
      reasons: [...reasons].sort((left, right) => left.localeCompare(right))
    };
  }

  calculateTeamTargets(
    requests: readonly TeamCalculationRequest[],
    onProgress?: (progress: TeamCalculationProgress) => void,
    onReport?: (report: TeamCalculationReportDTO) => void
  ): readonly TeamCalculationReportDTO[] {
    if (this.items === null) workflowFailure("snapshot", "SNAPSHOT_REQUIRED", "请先导入游戏快照");
    if (this.heroBases.size === 0) {
      workflowFailure("targets", "HERO_BASES_REQUIRED", "快照中没有可用于计算的式神面板", "heroes");
    }
    if (!Array.isArray(requests) || requests.length === 0) {
      workflowFailure("targets", "NO_TEAM_TARGET", "至少启用一个阵容或手动搭配目标", "requests");
    }
    try {
      return calculateTeamTargetBatch(requests, this.items, this.heroBases, onProgress, onReport);
    } catch (error) {
      return sanitizeError("targets", error);
    }
  }

  estimateTeamCalculationWork(requests: readonly TeamCalculationRequest[]) {
    if (this.items === null) workflowFailure("snapshot", "SNAPSHOT_REQUIRED", "请先导入游戏快照");
    if (!Array.isArray(requests) || requests.length === 0) {
      workflowFailure("targets", "NO_TEAM_TARGET", "至少启用一个阵容或手动搭配目标", "requests");
    }
    return requests.map((request) => estimateTeamCalculationWork(request, this.items!));
  }

  getGateState(): Readonly<Record<string, boolean>> {
    return {
      snapshotValid: this.summary !== null,
      targetsAndThresholdsValid: this.analysis !== null,
      staticPolicyConfirmed: this.draftPlan?.manifest.policy.confirmed === true,
      headerSourceValid: this.planSummary?.headerSourceValid === true,
      groupLimitValid: this.planSummary !== null && this.planSummary.discardGroupCount <= 60 && this.planSummary.rescueGroupCount <= 60,
      roundtripValid: this.planSummary?.roundtripWarnings.length === 0,
      previewComplete: this.planSummary !== null,
      retainedItemsProtected: this.planSummary?.cleanupComparison?.extraCleanupCount === 0,
    };
  }

  resetSession(): void {
    this.items = null;
    this.heroBases = new Map();
    this.summary = null;
    this.analysisKey = null;
    this.analysis = null;
    this.yuhunDecisions = null;
    this.markedDiscardIds = null;
    this.decision = null;
    this.decisionInput = null;
    this.draftPlan = null;
    this.planInput = null;
    this.planSummary = null;
    this.checklist = null;
    this.simulation = null;
    this.frequencyCache = null;
    this.baselineCache.clear();
    this.decisionCache.clear();
    this.planCache.clear();
  }
}

export function createWorkflow(): YuhunWorkflow {
  return new YuhunWorkflow();
}
