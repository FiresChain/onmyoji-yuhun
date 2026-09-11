import type {
  AnalysisSummaryDTO,
  ImportChecklistDTO,
  InventoryRowDTO,
  ManualShikigamiCalculationInput,
  PageDTO,
  PlanSummaryDTO,
  SimulationSummaryDTO,
  SnapshotSummaryDTO,
  FilterCriteria,
  SpeedCategoryDecision,
  StatId,
  SubStatCount,
  StaticRetentionPolicy,
  TeamCalculationReportDTO,
  TeamCodeInspectionDTO,
  YuhunDecisionRowDTO
} from "../../src/browser.js";
import type { TargetDomain } from "./target-catalog.js";
import type { SavedPlan } from "./plan-library.js";

export interface SavedProjectV1 {
  readonly schemaVersion: 1;
  readonly kind: "onmyoji-yuhun-project";
  readonly containsAccountDerivedData: true;
  readonly doNotCommit: true;
  readonly savedAt: string;
  readonly snapshotSha256: string;
  readonly snapshotSummary: SnapshotSummaryDTO;
  readonly settings: {
    readonly templateIds: readonly string[];
    readonly riskTier: "tier0" | "tier1";
    readonly defaultDisposition?: "retain" | "discard";
    readonly desiredFreeSlots?: number;
    readonly budgetPerTenThousand: number;
    readonly staticPolicy: StaticRetentionPolicy;
  };
  readonly analysisSummary: AnalysisSummaryDTO | null;
}

export interface MobileHandoffV1 {
  readonly schemaVersion: 1;
  readonly kind: "onmyoji-yuhun-mobile-handoff";
  readonly containsAccountDerivedData: true;
  readonly doNotCommit: true;
  readonly createdAt: string;
  readonly snapshotSha256: string;
  readonly copyGatePassed: true;
  readonly aggregate: {
    readonly discardGroupCount: number;
    readonly rescueGroupCount: number;
    readonly finalNewDiscardCount: number;
  };
  readonly codes: { readonly discard: string | null; readonly rescue: string | null };
  readonly checklist: ImportChecklistDTO;
}

const DATABASE_NAME = "onmyoji-yuhun-workbench";
const STORE_NAME = "projects";
const SESSION_STORE_NAME = "sessions";
const SNAPSHOT_STORE_NAME = "snapshots";

export interface WorkbenchSessionTargetV1 {
  readonly id: string;
  readonly source: "team-code" | "manual";
  readonly code?: string;
  readonly manualTargets?: readonly ManualShikigamiCalculationInput[];
  readonly label: string;
  readonly sceneId: string;
  readonly sceneLabel: string;
  /** Added after schema v1; missing legacy values are restored from the label or 100. */
  readonly difficulty?: number | null;
  /** Smart mode always calculates this lineup before ordinary difficulty fallback. */
  readonly forceCalculate?: boolean;
  readonly enabled: boolean;
  readonly metricCount: number;
  readonly inspection: TeamCodeInspectionDTO | null;
  readonly builtIn?: boolean;
  /** Built-in and future R2-published targets are viewable but cannot be changed in place. */
  readonly locked?: boolean;
}

export interface WorkbenchSessionRuleV1 {
  readonly id: string;
  readonly pool: "discard" | "enhance";
  readonly label: string;
  readonly suits: readonly string[];
  readonly positions: readonly number[];
  readonly mainStats: readonly StatId[];
  readonly requiredSubStats: readonly StatId[];
  readonly subStatCounts?: readonly SubStatCount[];
  /** Legacy single-select value, migrated when restoring an existing session. */
  readonly subStatCount?: "any" | SubStatCount;
  readonly filter?: FilterCriteria;
  readonly source?: {
    readonly code: string;
    readonly groupIndex: number;
    readonly headerHex: string;
  };
  readonly enabled: boolean;
}

export interface WorkbenchSessionV1 {
  readonly schemaVersion: 1;
  readonly kind: "onmyoji-yuhun-workbench-session";
  readonly containsAccountDerivedData: true;
  readonly doNotCommit: true;
  readonly savedAt: string;
  readonly snapshotSha256: string;
  readonly snapshotSummary: SnapshotSummaryDTO;
  readonly settings: SavedProjectV1["settings"] & { readonly existingFilterCode: string };
  readonly teamTargets: readonly WorkbenchSessionTargetV1[];
  readonly presetRules: readonly WorkbenchSessionRuleV1[];
  readonly inventory: PageDTO<InventoryRowDTO> | null;
  readonly analysis: AnalysisSummaryDTO | null;
  readonly decisions: PageDTO<SpeedCategoryDecision> | null;
  readonly yuhunDecisions?: PageDTO<YuhunDecisionRowDTO> | null;
  readonly teamCalculations: readonly TeamCalculationReportDTO[];
  /** Calculation progress is persisted so a paused run survives reloads. */
  readonly teamCalculationProgress?: Readonly<Record<string, {
    readonly targetId: string;
    readonly targetLabel: string;
    readonly status: "pending" | "running" | "completed" | "error";
    readonly completed: number;
    readonly total: number;
    readonly current: string | null;
    readonly currentShikigamiId?: number | null;
    readonly detail: string | null;
  }>>;
  readonly teamCalculationPaused?: boolean;
  readonly teamCalculationOptions?: {
    readonly mode?: "manual" | "smart";
    readonly sceneIds?: readonly string[];
    readonly difficultyDecreaseCount?: "auto" | number;
  } | null;
  readonly plan: PlanSummaryDTO | null;
  readonly simulation: SimulationSummaryDTO | null;
  readonly checklist: ImportChecklistDTO | null;
  readonly actuals: Readonly<Record<string, string>>;
  readonly gateState: Readonly<Record<string, boolean>>;
  readonly viewState: WorkbenchViewStateV1 | null;
}

export interface StoredWorkbenchSessionV1 {
  readonly session: WorkbenchSessionV1;
  readonly snapshotBuffer: ArrayBuffer;
}

export interface WorkbenchViewStateV1 {
  readonly catalog: readonly TargetDomain[];
  readonly selectedSceneIds: readonly string[];
  readonly focusedSceneId: string;
  readonly teamSelectionMode?: "manual" | "smart";
  readonly smartDifficultyDecreaseCount?: "auto" | number;
}

export interface SceneDataExportV1 {
  readonly schemaVersion: 1;
  readonly kind: "onmyoji-yuhun-scene-data-export";
  readonly containsAccountDerivedData: true;
  readonly doNotCommit: true;
  readonly exportedAt: string;
  readonly summary: {
    readonly domainCount: number;
    readonly categoryCount: number;
    readonly sceneCount: number;
    readonly targetCount: number;
    readonly unmappedTargetCount: number;
  };
  readonly catalog: readonly TargetDomain[];
  readonly targets: readonly WorkbenchSessionTargetV1[];
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持本地持久化"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 3);
    let blocked = false;
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(SESSION_STORE_NAME)) db.createObjectStore(SESSION_STORE_NAME);
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) db.createObjectStore(SNAPSHOT_STORE_NAME);
      if (!db.objectStoreNames.contains("plans")) db.createObjectStore("plans", { keyPath: "id" });
    });
    request.addEventListener("success", () => {
      if (blocked) { request.result.close(); return; }
      request.result.addEventListener("versionchange", () => request.result.close());
      resolve(request.result);
    });
    request.addEventListener("blocked", () => { blocked = true; reject(new Error("请关闭其他工作台标签页后重试")); });
    request.addEventListener("error", () => reject(request.error));
  });
}

export async function loadSavedPlans(): Promise<SavedPlan[]> {
  const db = await database();
  try {
    return await new Promise<SavedPlan[]>((resolve, reject) => {
      const transaction = db.transaction("plans", "readonly");
      const request = transaction.objectStore("plans").getAll();
      transaction.addEventListener("complete", () => resolve((request.result as SavedPlan[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
      transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("读取方案失败")));
    });
  } finally { db.close(); }
}

export async function persistSavedPlan(plan: SavedPlan): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("plans", "readwrite");
      transaction.objectStore("plans").put(plan);
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("保存方案失败")));
    });
  } finally { db.close(); }
}

export async function deleteSavedPlan(id: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("plans", "readwrite");
      transaction.objectStore("plans").delete(id);
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("删除方案失败")));
    });
  } finally { db.close(); }
}

export async function saveProject(project: SavedProjectV1): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(project, "current");
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  db.close();
}

export async function loadProject(): Promise<SavedProjectV1 | null> {
  const db = await database();
  const result = await new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get("current");
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
  db.close();
  if (result === undefined) return null;
  if (typeof result !== "object" || result === null || Array.isArray(result)) throw new Error("本地项目格式无效");
  const project = result as Partial<SavedProjectV1>;
  if (project.schemaVersion !== 1 || project.kind !== "onmyoji-yuhun-project" || project.doNotCommit !== true || project.settings === undefined) {
    throw new Error("本地项目版本或隐私标记无效");
  }
  assertProjectPrivacy(project as SavedProjectV1);
  return project as SavedProjectV1;
}

export async function deleteLocalProject(): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete("current");
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  db.close();
}

export async function saveWorkbenchSession(session: WorkbenchSessionV1, snapshotBuffer?: ArrayBuffer): Promise<void> {
  assertWorkbenchSessionPrivacy(session);
  if (snapshotBuffer !== undefined && (!(snapshotBuffer instanceof ArrayBuffer) || snapshotBuffer.byteLength === 0)) {
    throw new Error("自动保存会话缺少快照数据");
  }
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([SESSION_STORE_NAME, SNAPSHOT_STORE_NAME], "readwrite");
    transaction.objectStore(SESSION_STORE_NAME).put(session, "current");
    if (snapshotBuffer !== undefined) transaction.objectStore(SNAPSHOT_STORE_NAME).put(snapshotBuffer, "current");
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  db.close();
}

export async function loadWorkbenchSession(): Promise<StoredWorkbenchSessionV1 | null> {
  const db = await database();
  const result = await new Promise<{ session: unknown; snapshot: unknown }>((resolve, reject) => {
    const transaction = db.transaction([SESSION_STORE_NAME, SNAPSHOT_STORE_NAME], "readonly");
    const sessionRequest = transaction.objectStore(SESSION_STORE_NAME).get("current");
    const snapshotRequest = transaction.objectStore(SNAPSHOT_STORE_NAME).get("current");
    let session: unknown;
    let snapshot: unknown;
    sessionRequest.addEventListener("success", () => { session = sessionRequest.result; });
    snapshotRequest.addEventListener("success", () => { snapshot = snapshotRequest.result; });
    transaction.addEventListener("complete", () => resolve({ session, snapshot }));
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  db.close();
  if (result.session === undefined) return null;
  if (!isWorkbenchSession(result.session) || !(result.snapshot instanceof ArrayBuffer) || result.snapshot.byteLength === 0) {
    throw new Error("本地工作台会话格式无效");
  }
  assertWorkbenchSessionPrivacy(result.session);
  return { session: result.session, snapshotBuffer: result.snapshot };
}

export async function deleteWorkbenchSession(): Promise<void> {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([SESSION_STORE_NAME, SNAPSHOT_STORE_NAME], "readwrite");
    transaction.objectStore(SESSION_STORE_NAME).delete("current");
    transaction.objectStore(SNAPSHOT_STORE_NAME).delete("current");
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
  });
  db.close();
}

function isWorkbenchSession(value: unknown): value is WorkbenchSessionV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<WorkbenchSessionV1>;
  return candidate.schemaVersion === 1 &&
    candidate.kind === "onmyoji-yuhun-workbench-session" &&
    candidate.containsAccountDerivedData === true &&
    candidate.doNotCommit === true &&
    typeof candidate.snapshotSha256 === "string" &&
    candidate.snapshotSummary !== undefined &&
    candidate.settings !== undefined &&
    Array.isArray(candidate.teamTargets) &&
    Array.isArray(candidate.presetRules);
}

export function assertWorkbenchSessionPrivacy(session: WorkbenchSessionV1): void {
  if (session.containsAccountDerivedData !== true || session.doNotCommit !== true) {
    throw new Error("本地工作台会话缺少私有数据标记");
  }
}

export function assertProjectPrivacy(project: SavedProjectV1): void {
  const serialized = JSON.stringify(project);
  const forbidden = ["hero_equips", "headerHex", "discardCode", "rescueCode", "#TA#", "templateDrafts", "pendingConfirmations"];
  const matched = forbidden.find((token) => serialized.includes(token));
  if (matched !== undefined) throw new Error(`项目文件包含禁止字段：${matched}`);
}

export function buildHandoff(snapshot: SnapshotSummaryDTO, plan: PlanSummaryDTO, checklist: ImportChecklistDTO): MobileHandoffV1 {
  return {
    schemaVersion: 1,
    kind: "onmyoji-yuhun-mobile-handoff",
    containsAccountDerivedData: true,
    doNotCommit: true,
    createdAt: new Date().toISOString(),
    snapshotSha256: snapshot.sha256,
    copyGatePassed: true,
    aggregate: {
      discardGroupCount: plan.discardGroupCount,
      rescueGroupCount: plan.rescueGroupCount,
      finalNewDiscardCount: plan.finalNewDiscardCount
    },
    codes: { discard: plan.discardCode, rescue: plan.rescueCode },
    checklist
  };
}

export function parseHandoff(value: unknown): MobileHandoffV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("交接包格式无效");
  const candidate = value as Partial<MobileHandoffV1>;
  if (candidate.schemaVersion !== 1 || candidate.kind !== "onmyoji-yuhun-mobile-handoff" || candidate.doNotCommit !== true) {
    throw new Error("交接包版本或隐私标记无效");
  }
  if (candidate.copyGatePassed !== true || typeof candidate.snapshotSha256 !== "string" || candidate.snapshotSha256.length !== 64 || candidate.codes === undefined || candidate.checklist === undefined) {
    throw new Error("交接包缺少必要字段");
  }
  return candidate as MobileHandoffV1;
}

export function buildSceneDataExport(
  catalog: readonly TargetDomain[],
  targets: readonly WorkbenchSessionTargetV1[],
  exportedAt = new Date()
): SceneDataExportV1 {
  const clonedCatalog = JSON.parse(JSON.stringify(catalog)) as readonly TargetDomain[];
  const clonedTargets = JSON.parse(JSON.stringify(targets)) as readonly WorkbenchSessionTargetV1[];
  const categories = clonedCatalog.flatMap((domain) => domain.categories);
  const scenes = categories.flatMap((category) => category.scenes);
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  return {
    schemaVersion: 1,
    kind: "onmyoji-yuhun-scene-data-export",
    containsAccountDerivedData: true,
    doNotCommit: true,
    exportedAt: exportedAt.toISOString(),
    summary: {
      domainCount: clonedCatalog.length,
      categoryCount: categories.length,
      sceneCount: scenes.length,
      targetCount: clonedTargets.length,
      unmappedTargetCount: clonedTargets.filter((target) => !sceneIds.has(target.sceneId)).length
    },
    catalog: clonedCatalog,
    targets: clonedTargets
  };
}

export function parseSceneDataExport(value: unknown): SceneDataExportV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("关卡数据文件格式无效");
  const candidate = value as Partial<SceneDataExportV1>;
  if (
    candidate.schemaVersion !== 1
    || candidate.kind !== "onmyoji-yuhun-scene-data-export"
    || candidate.containsAccountDerivedData !== true
    || candidate.doNotCommit !== true
    || typeof candidate.exportedAt !== "string"
    || Number.isNaN(new Date(candidate.exportedAt).getTime())
    || typeof candidate.summary !== "object"
    || candidate.summary === null
    || !Array.isArray(candidate.catalog)
    || !Array.isArray(candidate.targets)
  ) {
    throw new Error("关卡数据文件版本或隐私标记无效");
  }

  const ids = new Set<string>();
  for (const [domainIndex, domain] of candidate.catalog.entries()) {
    if (typeof domain?.id !== "string" || domain.id === "" || typeof domain.label !== "string" || !Array.isArray(domain.categories)) {
      throw new Error(`关卡目录 catalog[${domainIndex}] 无效`);
    }
    if (ids.has(domain.id)) throw new Error(`关卡目录包含重复 ID：${domain.id}`);
    ids.add(domain.id);
    for (const [categoryIndex, category] of domain.categories.entries()) {
      if (typeof category?.id !== "string" || category.id === "" || typeof category.label !== "string" || !Array.isArray(category.scenes)) {
        throw new Error(`关卡目录 catalog[${domainIndex}].categories[${categoryIndex}] 无效`);
      }
      if (ids.has(category.id)) throw new Error(`关卡目录包含重复 ID：${category.id}`);
      ids.add(category.id);
      for (const [sceneIndex, scene] of category.scenes.entries()) {
        if (
          typeof scene?.id !== "string"
          || scene.id === ""
          || typeof scene.label !== "string"
          || (scene.mutualExclusion !== undefined && typeof scene.mutualExclusion !== "boolean")
          || (scene.gameSceneId !== undefined && scene.gameSceneId !== null && !Number.isSafeInteger(scene.gameSceneId))
          || (scene.gameSceneIdOverride !== undefined && scene.gameSceneIdOverride !== null && !Number.isSafeInteger(scene.gameSceneIdOverride))
        ) {
          throw new Error(`关卡目录 catalog[${domainIndex}].categories[${categoryIndex}].scenes[${sceneIndex}] 无效`);
        }
        if (ids.has(scene.id)) throw new Error(`关卡目录包含重复 ID：${scene.id}`);
        ids.add(scene.id);
      }
    }
  }

  const targetIds = new Set<string>();
  for (const [index, target] of candidate.targets.entries()) {
    if (
      typeof target?.id !== "string"
      || target.id === ""
      || (target.source !== "team-code" && target.source !== "manual")
      || typeof target.label !== "string"
      || typeof target.sceneId !== "string"
      || typeof target.sceneLabel !== "string"
      || typeof target.enabled !== "boolean"
      || (target.forceCalculate !== undefined && typeof target.forceCalculate !== "boolean")
      || !Number.isSafeInteger(target.metricCount)
      || target.metricCount < 0
      || (target.difficulty !== undefined && target.difficulty !== null && (!Number.isSafeInteger(target.difficulty) || target.difficulty < 1 || target.difficulty > 100))
      || (target.source === "team-code" && typeof target.code !== "string")
      || (target.source === "manual" && !Array.isArray(target.manualTargets))
    ) {
      throw new Error(`阵容数据 targets[${index}] 无效`);
    }
    if (targetIds.has(target.id)) throw new Error(`阵容数据包含重复 ID：${target.id}`);
    targetIds.add(target.id);
  }

  return buildSceneDataExport(candidate.catalog, candidate.targets, new Date(candidate.exportedAt));
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildCsvText(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const escape = (value: unknown): string => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    "# containsAccountDerivedData: true",
    "# doNotCommit: true",
    headers.map(escape).join(","),
    ...rows.map((row) => row.map(escape).join(","))
  ].join("\r\n");
}

export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly unknown[])[]): void {
  const body = buildCsvText(headers, rows);
  const blob = new Blob(["\ufeff", body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function copyText(value: string): Promise<"clipboard" | "selection"> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(value);
    return "clipboard";
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("浏览器未允许复制，请手动选择码文本");
  return "selection";
}
