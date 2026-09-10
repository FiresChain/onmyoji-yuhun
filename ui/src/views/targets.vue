<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Check,
  Calculator,
  Circle,
  ChevronRight,
  CircleHelp,
  Clipboard,
  ClipboardPaste,
  Edit3,
  Eye,
  GitCompareArrows,
  FolderTree,
  GripVertical,
  ImageUp,
  Import,
  LoaderCircle,
  Lock,
  Minus,
  Plus,
  Pencil,
  Pause,
  Play,
  RotateCcw,
  Search,
  Save,
  ScanQrCode,
  Sparkles,
  TriangleAlert,
  Trash2,
  X
} from "@lucide/vue";
import {
  STAT_LABELS,
  YUHUN_TYPES,
  type FilterCriteria,
  type IntrinsicStatId,
  type ManualShikigamiCalculationInput,
  type Panel,
  type StatId,
  type SubStatCount,
  type SubStatRequirement,
  type TeamCalculationEntityDTO,
  type TeamCalculationPieceDTO,
  type TeamCalculationYuhunDTO,
  type YuhunPotentialPieceDTO,
  type YuhunPotentialTarget,
  type TeamCodeInspectionDTO
} from "../../../src/browser.js";
import {
  TARGET_CATALOG,
  canonicalSceneId,
  fetchPublishedSceneData,
  findTargetScenesByGameSceneId,
  isCustomCatalogId,
  localCatalogOverlay,
  mergePublishedCatalog,
  type TargetCategory,
  type TargetDomain,
  type TargetScene,
  type TargetScenePath
} from "../target-catalog.js";
import { teamCalculationMeetsTargetScore, teamDifficultyFromLabel, useWorkbenchStore, type ImportedTeamTarget, type PresetRule, type PresetRulePool } from "../store.js";
import {
  decodeTeamCodeFromQrImage,
  readTeamCodeFromClipboard,
  decodeYuhunCodeFromQrImage,
  readYuhunCodeFromClipboard
} from "../team-code-qr.js";
import { copyText } from "../persistence.js";
import { formatTeamCalculationError } from "../team-calculation-errors.js";
import ManualTargetEditor from "../components/ManualTargetEditor.vue";
import PotentialComparison from "../components/PotentialComparison.vue";
import YuhunSuitPicker from "../components/YuhunSuitPicker.vue";
import RuleOptionGroup from "../components/RuleOptionGroup.vue";
import YuhunConditionEditor from "../components/YuhunConditionEditor.vue";
import { emptyYuhunFilter } from "../yuhun-filter.js";
import {
  YUHUN_CATEGORY_OPTIONS,
  shikigamiByHeroId,
  shikigamiImage,
  yuhunCategory,
  yuhunImage,
  yuhunPlaceholder,
  type YuhunCategory
} from "../manual-target-config.js";

interface EditableTargetScene extends Omit<TargetScene, "label"> {
  label: string;
}

interface EditableTargetCategory extends Omit<TargetCategory, "label" | "scenes"> {
  label: string;
  scenes: EditableTargetScene[];
}

interface EditableTargetDomain extends Omit<TargetDomain, "label" | "categories"> {
  label: string;
  categories: EditableTargetCategory[];
}

type EditableScenePath = TargetScenePath;

const OTHER_SCENE_ID = "system-other-scene";
const TEAM_DELETE_CONFIRMATION_KEY = "onmyoji-yuhun-team-delete-confirmation-date";
const TEAM_SCENE_MISMATCH_CONFIRMATION_KEY = "onmyoji-yuhun-team-scene-mismatch-confirmation-date";
const OTHER_TARGET_DOMAIN: EditableTargetDomain = {
  id: "system-other-domain",
  label: "其他",
  categories: [{
    id: "system-other-category",
    label: "其他",
    scenes: [{ id: OTHER_SCENE_ID, label: "其他", gameSceneId: null }]
  }]
};

function cloneCatalog(source: readonly EditableTargetDomain[]): EditableTargetDomain[] {
  return source.map((domain) => ({
    ...domain,
    categories: domain.categories.map((category) => ({
      ...category,
      scenes: category.scenes.map((scene) => ({ ...scene }))
    }))
  }));
}

const store = useWorkbenchStore();
const catalog = ref<EditableTargetDomain[]>([...TARGET_CATALOG, OTHER_TARGET_DOMAIN].map((domain) => ({
  ...domain,
  categories: domain.categories.map((category) => ({
    ...category,
    scenes: category.scenes.map((scene) => ({ ...scene }))
  }))
})));
const catalogLoading = ref(false);
const expandedDomainIds = ref<string[]>([TARGET_CATALOG[0]!.id]);
const activeCategoryId = ref<string | null>(null);
const scenePopoverStyle = ref<Record<string, string>>({});
const initialSceneId = "scene-87";
const selectedSceneIds = ref<string[]>([initialSceneId]);
const focusedSceneId = ref(selectedSceneIds.value[0]!);
const teamSelectionMode = ref<"manual" | "smart">("manual");
const smartDifficultyDecreaseCount = ref<"auto" | number>("auto");
const smartHelpOpen = ref(false);
const teamCalculationFilter = ref<"all" | "enabled" | "disabled" | "completed" | "running" | "pending" | "error">("all");
const teamProgressCarouselIndex = ref(0);
const potentialComparisonTargets = ref<readonly YuhunPotentialTarget[] | null>(null);
const potentialComparisonTitle = ref("");
const potentialComparisonCompact = ref(false);
const calculationDetailTargetId = ref<string | null>(null);
const calculationDetailEntityIndex = ref<number | null>(null);
const calculationDetailPosition = ref(1);
const calculationDetailPieces = ref<ReadonlyMap<string, TeamCalculationYuhunDTO>>(new Map());
const calculationDetailCandidateId = ref<string | null>(null);
const calculationDetailCandidatePage = ref(1);
let teamProgressRotationTimer: ReturnType<typeof setInterval> | null = null;

const importOpen = ref(false);
const importMode = ref<"code" | "manual">("code");
const importSceneId = ref(selectedSceneIds.value[0]!);
const importLabel = ref("");
const importDifficulty = ref<number | "">("");
const importStoredDifficulty = ref<number | "">("");
const importForceCalculate = ref(false);
const importDifficultyManuallyEdited = ref(false);
const autoSelectedImportLabel = ref(false);
const importLabelManuallyEdited = ref(false);
const importCode = ref("");
const qrImageInput = ref<HTMLInputElement | null>(null);
const qrBusy = ref<"image" | "clipboard" | null>(null);
const qrMessage = ref("");
const qrFailed = ref(false);
const importSubmitError = ref("");
const importSceneNotice = ref("");
const manualSceneGameId = ref("");
const pendingSceneInspection = ref<TeamCodeInspectionDTO | null>(null);
const pendingSceneInspectionCode = ref("");
const awaitingSceneConfirmation = ref(false);
const autoSelectedImportScene = ref(false);
const manualConfiguredCount = ref(0);
const manualDrafts = ref<readonly ManualShikigamiCalculationInput[]>([]);
const targetDetailId = ref<string | null>(null);
const targetDetailLoading = ref(false);
const targetDetailEditing = ref(false);
const targetDetailLabel = ref("");
const targetDetailDifficulty = ref<number | "">("");
const targetDetailStoredDifficulty = ref<number | "">("");
const targetDetailForceCalculate = ref(false);
const targetDetailInitialTargets = ref<readonly ManualShikigamiCalculationInput[]>([]);
const targetDetailDrafts = ref<readonly ManualShikigamiCalculationInput[]>([]);
const targetDetailConfiguredCount = ref(0);
const targetDetailEditorKey = ref(0);
let viewStateReady = false;
let viewMounted = false;
let catalogInitializationStarted = false;
let importInspectionSequence = 0;

watch(() => store.restoreCompleted, (completed) => {
  if (completed) void initializeCatalogAfterRestore();
}, { immediate: true });

watch([catalog, selectedSceneIds, focusedSceneId], () => {
  if (viewStateReady) store.setTargetViewState(localCatalogOverlay(catalog.value), selectedSceneIds.value, focusedSceneId.value, catalog.value);
}, { deep: true });

watch(() => store.sceneDataImportRevision, (revision) => {
  if (revision === 0) return;
  catalog.value = cloneCatalog(store.targetCatalog as readonly EditableTargetDomain[]);
  selectedSceneIds.value = [...(store.targetViewState?.selectedSceneIds ?? [])];
  focusedSceneId.value = store.targetViewState?.focusedSceneId ?? scenePaths.value[0]?.sceneId ?? "";
  updateNextCustomCatalogId();
});

type CatalogNodeLevel = "domain" | "category" | "scene";
interface CatalogDraft {
  readonly level: CatalogNodeLevel;
  readonly id: string | null;
  label: string;
  gameSceneId: string;
}
interface CatalogDragState {
  readonly level: CatalogNodeLevel;
  readonly parentId: string | null;
  readonly id: string;
}
interface CatalogDeleteRequest {
  readonly level: CatalogNodeLevel;
  readonly id: string;
  readonly label: string;
  readonly categoryCount: number;
  readonly sceneCount: number;
  readonly targetCount: number;
  readonly sceneIds: readonly string[];
}

interface TeamTargetDeleteRequest {
  readonly id: string;
  readonly label: string;
}

interface TeamSceneMismatchRequest {
  readonly code: string;
  readonly inspection: TeamCodeInspectionDTO;
  readonly sceneId: string;
  readonly sceneLabel: string;
  readonly selectedScenePath: string;
  readonly codeScenePaths: readonly string[];
  readonly teamLabel: string;
  readonly difficulty: number | null;
  readonly forceCalculate: boolean;
}

interface TeamSceneIdAssignmentRequest {
  readonly gameSceneId: number;
  readonly importRequest: TeamSceneMismatchRequest;
}

const catalogManagerOpen = ref(false);
const managerDomainId = ref<string | null>(TARGET_CATALOG[0]!.id);
const managerCategoryId = ref<string | null>(TARGET_CATALOG[0]!.categories[0]!.id);
const managerSceneId = ref<string | null>(TARGET_CATALOG[0]!.categories[0]!.scenes[0]!.id);
const catalogDraft = ref<CatalogDraft | null>(null);
const catalogDraftInput = ref<HTMLInputElement | null>(null);
const catalogDrag = ref<CatalogDragState | null>(null);
const pendingCatalogDelete = ref<CatalogDeleteRequest | null>(null);
const pendingTeamTargetDelete = ref<TeamTargetDeleteRequest | null>(null);
const teamDeleteDoNotAskToday = ref(false);
const pendingTeamSceneMismatch = ref<TeamSceneMismatchRequest | null>(null);
const teamSceneMismatchDoNotAskToday = ref(false);
const pendingTeamSceneIdAssignment = ref<TeamSceneIdAssignmentRequest | null>(null);
let nextCustomCatalogId = 1;

const ruleOpen = ref(false);
const ruleCriteria = ref<FilterCriteria>(emptyYuhunFilter());
const editingRuleId = ref<string | null>(null);
const rulePool = ref<PresetRulePool>("enhance");
const ruleLabel = ref("");
const ruleSuits = ref<string[]>([]);
const rulePositions = ref<number[]>([]);
const ruleMainStats = ref<StatId[]>([]);
const ruleSubStatRequirements = ref<Partial<Record<StatId, SubStatRequirement>>>({});
const ruleSubStatCounts = ref<SubStatCount[]>([]);
const ruleLevelRanges = ref<Array<"0-2" | "3-5" | "6-8" | "9-11" | "12-14" | "15">>([]);
const ruleIntrinsicStats = ref<IntrinsicStatId[]>([]);
const rulePreservedFilter = ref<FilterCriteria | null>(null);
const ruleSource = ref<PresetRule["source"] | undefined>(undefined);
const ruleYuhunPickerOpen = ref(false);
const ruleYuhunSearch = ref("");
const ruleYuhunCategory = ref<YuhunCategory>("全部");
const ruleCodeImportOpen = ref(false);
const ruleCodeImportValue = ref("");
const ruleEntryMode = ref<"code" | "manual">("code");
const ruleQrInput = ref<HTMLInputElement | null>(null);
const ruleImportBusy = ref<"image" | "clipboard" | "decode" | null>(null);
const ruleImportMessage = ref("");
const ruleImportFailed = ref(false);
let ruleImportSequence = 0;

watch(ruleCodeImportOpen, () => {
  ruleImportSequence++;
  ruleImportBusy.value = null;
});

const statOptions: Array<{ id: StatId; label: string }> = [
  "attack", "attackPercent", "defense", "defensePercent", "hp", "hpPercent",
  "speed", "effectHit", "effectResist", "crit", "critDamage"
].map((id) => ({ id: id as StatId, label: STAT_LABELS[id as StatId] }));
const INTRINSIC_STAT_IDS = [
  "attackPercent", "defensePercent", "hpPercent", "effectHit", "effectResist", "crit"
] as const satisfies readonly IntrinsicStatId[];
const intrinsicStatOptions: ReadonlyArray<{ id: IntrinsicStatId; label: string }> = INTRINSIC_STAT_IDS.map((id) => ({ id, label: STAT_LABELS[id] }));
const subStatCountOptions: ReadonlyArray<{ id: SubStatCount; label: string }> = [
  { id: "lessThan2", label: "不足2条" },
  { id: "2", label: "2条" },
  { id: "3", label: "3条" },
  { id: "4", label: "4条" }
];
const ruleYuhunOptions = YUHUN_TYPES.map((name) => {
  return {
    name,
    label: name,
    category: yuhunCategory(name),
    image: yuhunImage(name),
    placeholder: yuhunPlaceholder(name)
  };
});
const ruleYuhunByName = new Map<string, (typeof ruleYuhunOptions)[number]>(ruleYuhunOptions.map((item) => [item.name, item]));
const visibleRuleYuhun = computed(() => {
  const query = ruleYuhunSearch.value.trim().toLocaleLowerCase();
  return ruleYuhunOptions.filter((item) => (
    (ruleYuhunCategory.value === "全部" || item.category === ruleYuhunCategory.value)
    && (query === "" || item.label.toLocaleLowerCase().includes(query) || item.category.includes(query))
  ));
});
const hasSelectedBossRuleSuit = computed(() => ruleSuits.value.some((name) => ruleYuhunByName.get(name)?.category === "首领御魂"));
const ruleSubStatFilters = computed(() => statOptions.flatMap((stat) => {
  const requirement = ruleSubStatRequirements.value[stat.id];
  return requirement === undefined ? [] : [{ stat: stat.id, requirement }];
}));
const requiredRuleSubStats = computed(() => ruleSubStatFilters.value
  .filter((filter) => filter.requirement === "include")
  .map((filter) => filter.stat));
const discardPresetRules = computed(() => store.presetRules.filter((rule) => rule.pool === "discard"));
const enhancePresetRules = computed(() => store.presetRules.filter((rule) => rule.pool === "enhance"));
const scenePaths = computed<EditableScenePath[]>(() => catalog.value.flatMap((domain) =>
    domain.categories.flatMap((category) => category.scenes.map((scene) => ({
    domainId: domain.id,
    categoryId: category.id,
    sceneId: scene.id,
    gameSceneId: scene.gameSceneIdOverride === undefined ? scene.gameSceneId ?? null : scene.gameSceneIdOverride,
    domainLabel: domain.label,
    categoryLabel: category.label,
    sceneLabel: scene.label,
    mutualExclusion: scene.mutualExclusion === true
  })))
));
const importScenePath = computed(() => scenePaths.value.find((scene) => scene.sceneId === importSceneId.value) ?? null);
const importDomainId = computed({
  get: () => importScenePath.value?.domainId ?? "",
  set: (domainId: string) => {
    if (domainId === "") {
      importSceneId.value = "";
      return;
    }
    importSceneId.value = catalog.value.find((domain) => domain.id === domainId)?.categories[0]?.scenes[0]?.id ?? "";
  }
});
const importCategoryId = computed({
  get: () => importScenePath.value?.categoryId ?? "",
  set: (categoryId: string) => {
    if (categoryId === "") {
      importSceneId.value = "";
      return;
    }
    const domain = catalog.value.find((item) => item.id === importDomainId.value);
    importSceneId.value = domain?.categories.find((category) => category.id === categoryId)?.scenes[0]?.id ?? "";
  }
});
const importCategories = computed(() => catalog.value.find((domain) => domain.id === importDomainId.value)?.categories ?? []);
const importScenes = computed(() => importCategories.value.find((category) => category.id === importCategoryId.value)?.scenes ?? []);
const selectedScenes = computed(() => scenePaths.value.filter((scene) => selectedSceneIds.value.includes(scene.sceneId)));
const selectedTeamTargets = computed(() => {
  const selected = new Set(selectedSceneIds.value);
  return store.teamTargets.filter((target) => selected.has(target.sceneId));
});
const selectedEnabledTeamTargetCount = computed(() => selectedTeamTargets.value.filter((target) => target.enabled).length);
const selectedEnabledTeamMetricCount = computed(() => selectedTeamTargets.value
  .filter((target) => target.enabled)
  .reduce((sum, target) => sum + target.metricCount, 0));
const resultScenes = computed(() => selectedScenes.value.filter((scene) => filteredTargetsForScene(scene.sceneId).length > 0));
const visibleTeamTargets = computed(() => resultScenes.value.flatMap((scene) => filteredTargetsForScene(scene.sceneId)));
const visibleEnabledTeamTargetCount = computed(() => visibleTeamTargets.value.filter((target) => target.enabled).length);
const enabledTeamTargetDisplayCount = computed(() => teamSelectionMode.value === "smart"
  ? store.teamTargets.filter((target) => targetDisplayStatus(target) === "已启用").length
  : selectedEnabledTeamTargetCount.value);
const allVisibleTeamTargetsEnabled = computed(() => visibleTeamTargets.value.length > 0 && visibleTeamTargets.value.every((target) => target.enabled));
const teamProgressEntries = computed(() => Object.values(store.teamCalculationProgress).filter((entry) => entry.status === "running"));
const isTeamCalculationBusy = computed(() => store.busy === "正在计算阵容御魂搭配");
const activeTeamProgress = computed(() => {
  const current = store.progress;
  const entries = teamProgressEntries.value;
  const entry = entries[teamProgressCarouselIndex.value % Math.max(1, entries.length)];
  if (entry === undefined) return current?.phase === "team-calculation" ? current : null;
  return {
    phase: "team-calculation" as const,
    targetId: entry.targetId,
    targetLabel: entry.targetLabel,
    completed: entry.completed,
    total: entry.total,
    current: entry.current ?? entry.targetLabel,
    currentShikigamiId: entry.currentShikigamiId ?? undefined,
    detail: entry.detail ?? "等待计算"
  };
});
const completedTeamTargetCount = computed(() => Object.values(store.teamCalculationProgress)
  .filter((entry) => entry.status === "completed").length);
const completedTeamMetricCount = computed(() => Object.values(store.teamCalculationProgress)
  .reduce((sum, entry) => sum + entry.completed, 0));
const completedSelectedSceneCount = computed(() => selectedSceneIds.value.filter((sceneId) => {
  const sceneTargetIds = store.teamTargets
    .filter((target) => target.sceneId === sceneId && store.teamCalculationProgress[target.id] !== undefined)
    .map((target) => target.id);
  if (sceneTargetIds.length === 0) return false;
  if (teamSelectionMode.value === "smart" && sceneTargetIds.some((targetId) => {
    const report = store.teamCalculationFor(targetId);
    return report !== null && teamCalculationMeetsTargetScore(report);
  })) return true;
  return sceneTargetIds.every((targetId) => store.teamCalculationProgress[targetId]?.status === "completed");
}).length);
const selectedSceneSummaryValue = computed(() => isTeamCalculationBusy.value
  ? `${completedSelectedSceneCount.value} / ${selectedSceneIds.value.length}`
  : String(selectedSceneIds.value.length));
const importedTeamSummaryValue = computed(() => {
  if (!isTeamCalculationBusy.value) return String(store.teamTargets.length);
  const total = teamSelectionMode.value === "smart" ? "-" : String(selectedEnabledTeamTargetCount.value);
  return `${completedTeamTargetCount.value} / ${total}`;
});
const teamMetricSummaryValue = computed(() => {
  const metricCount = teamSelectionMode.value === "smart"
    ? store.enabledTeamMetricCount
    : selectedEnabledTeamMetricCount.value;
  if (!isTeamCalculationBusy.value) return String(metricCount);
  const total = teamSelectionMode.value === "smart" ? "-" : String(metricCount);
  return `${completedTeamMetricCount.value} / ${total}`;
});
const activeTeamProgressLabel = computed(() => {
  const progress = activeTeamProgress.value;
  if (progress === null) return "";
  const targetLabel = progress.targetLabel ?? "";
  const target = progress.targetId === undefined ? null : store.teamTargets.find((item) => item.id === progress.targetId) ?? null;
  const configured = target === null
    ? null
    : editableTargetsFor(target).filter((item) => item.yuhunConfigEnabled !== false)[progress.completed];
  const catalogName = progress.currentShikigamiId === undefined
    ? null
    : shikigamiByHeroId(progress.currentShikigamiId)?.name ?? null;
  const current = catalogName
    ?? (configured === null || configured === undefined ? null : previewShikigamiName(configured))
    ?? progress.current?.trim()
    ?? "未知式神";
  return targetLabel !== "" && current !== "" && current !== targetLabel
    ? `${targetLabel} · ${current}`
    : targetLabel || current;
});
const hasTeamCalculationRun = computed(() => Object.keys(store.teamCalculationProgress).length > 0);
const allScenesSelected = computed(() => selectedSceneIds.value.length === scenePaths.value.length);
const managerDomain = computed(() => catalog.value.find((domain) => domain.id === managerDomainId.value) ?? null);
const managerCategory = computed(() => managerDomain.value?.categories.find((category) => category.id === managerCategoryId.value) ?? null);
const targetDetail = computed(() => store.teamTargets.find((target) => target.id === targetDetailId.value) ?? null);
const targetDetailIsPublished = computed(() => targetDetail.value?.locked === true || targetDetail.value?.builtIn === true);

function sceneIdsForCategory(category: Pick<TargetCategory, "scenes">): string[] {
  return category.scenes.map((scene) => scene.id);
}

function sceneIdsForDomain(domainId: string): string[] {
  return catalog.value.find((domain) => domain.id === domainId)?.categories.flatMap(sceneIdsForCategory) ?? [];
}

function fallbackSceneId(): string {
  return scenePaths.value[0]?.sceneId ?? "";
}

function selectionState(sceneIds: readonly string[]): "none" | "some" | "all" {
  const selected = sceneIds.filter((sceneId) => selectedSceneIds.value.includes(sceneId)).length;
  if (selected === 0) return "none";
  return selected === sceneIds.length ? "all" : "some";
}

function toggleSceneSelection(sceneIds: readonly string[]): void {
  const current = new Set(selectedSceneIds.value);
  if (sceneIds.every((sceneId) => current.has(sceneId))) {
    for (const sceneId of sceneIds) current.delete(sceneId);
  } else {
    for (const sceneId of sceneIds) current.add(sceneId);
  }
  selectedSceneIds.value = scenePaths.value.map((scene) => scene.sceneId).filter((sceneId) => current.has(sceneId));
  if (!selectedSceneIds.value.includes(focusedSceneId.value)) {
    focusedSceneId.value = selectedSceneIds.value[0] ?? fallbackSceneId();
  }
}

function toggleSingleScene(sceneId: string): void {
  const selecting = !selectedSceneIds.value.includes(sceneId);
  toggleSceneSelection([sceneId]);
  if (selecting) focusedSceneId.value = sceneId;
}

function clearCategory(category: Pick<TargetCategory, "scenes">): void {
  const sceneIds = new Set(sceneIdsForCategory(category));
  selectedSceneIds.value = selectedSceneIds.value.filter((sceneId) => !sceneIds.has(sceneId));
  if (!selectedSceneIds.value.includes(focusedSceneId.value)) {
    focusedSceneId.value = selectedSceneIds.value[0] ?? fallbackSceneId();
  }
}

function selectAllScenes(): void {
  selectedSceneIds.value = scenePaths.value.map((scene) => scene.sceneId);
}

function clearAllScenes(): void {
  selectedSceneIds.value = [];
}

function setVisibleTeamTargetsEnabled(enabled: boolean): void {
  for (const scene of resultScenes.value) store.setTeamTargetGroupEnabled(scene.sceneId, enabled);
}

function toggleSmartTeamSelection(): void {
  teamSelectionMode.value = teamSelectionMode.value === "smart" ? "manual" : "smart";
  smartHelpOpen.value = false;
}

function calculateVisibleTeamTargets(): void {
  void store.calculateTeamTargets({
    mode: teamSelectionMode.value,
    sceneIds: selectedSceneIds.value,
    difficultyDecreaseCount: smartDifficultyDecreaseCount.value
  });
}

function toggleDomain(domainId: string): void {
  expandedDomainIds.value = expandedDomainIds.value.includes(domainId)
    ? expandedDomainIds.value.filter((id) => id !== domainId)
    : [...expandedDomainIds.value, domainId];
}

function toggleCategory(categoryId: string, event?: MouseEvent): void {
  if (activeCategoryId.value === categoryId) {
    activeCategoryId.value = null;
    return;
  }

  activeCategoryId.value = categoryId;
  if (!(event?.currentTarget instanceof Element)) return;
  const categoryRow = event.currentTarget.closest(".category-row");
  if (categoryRow === null) return;
  const bounds = categoryRow.getBoundingClientRect();
  const filterPane = categoryRow.closest(".target-filter-pane");
  const filterBounds = filterPane?.getBoundingClientRect();
  scenePopoverStyle.value = {
    "--scene-popover-top": `${bounds.top}px`,
    "--scene-popover-left": `${(filterBounds?.right ?? bounds.right) + 10}px`
  };
}

function closeCategoryOnOutsideClick(event: MouseEvent): void {
  if (activeCategoryId.value === null || !(event.target instanceof Element)) return;
  if (event.target.closest(".scene-popover") !== null || event.target.closest(".category-row") !== null) return;
  activeCategoryId.value = null;
}

function closeSmartHelpOnOutsideClick(event: MouseEvent): void {
  if (!smartHelpOpen.value || !(event.target instanceof Element)) return;
  if (event.target.closest(".smart-target-help") !== null) return;
  smartHelpOpen.value = false;
}

onMounted(() => {
  viewMounted = true;
  teamProgressRotationTimer = setInterval(() => {
    if (teamProgressEntries.value.length <= 1) return;
    teamProgressCarouselIndex.value = (teamProgressCarouselIndex.value + 1) % teamProgressEntries.value.length;
  }, 3000);
  document.addEventListener("click", closeCategoryOnOutsideClick);
  document.addEventListener("click", closeSmartHelpOnOutsideClick);
  document.addEventListener("paste", handleTeamCodePaste);
  void initializeCatalogAfterRestore();
});
onBeforeUnmount(() => {
  viewMounted = false;
  if (teamProgressRotationTimer !== null) clearInterval(teamProgressRotationTimer);
  document.removeEventListener("click", closeCategoryOnOutsideClick);
  document.removeEventListener("click", closeSmartHelpOnOutsideClick);
  document.removeEventListener("paste", handleTeamCodePaste);
});

async function initializeCatalogAfterRestore(): Promise<void> {
  if (!viewMounted || !store.restoreCompleted || catalogInitializationStarted) return;
  catalogInitializationStarted = true;
  const publishedTargets = await loadPublishedCatalog(store.targetViewState);
  if (publishedTargets === null) return;
  if (import.meta.env.MODE !== "test") {
    store.loadPublishedTeamTargets(publishedTargets);
  }
  const restoredOptions = store.teamCalculationOptionsForResume();
  if (restoredOptions.mode === "smart" || restoredOptions.mode === "manual") {
    teamSelectionMode.value = restoredOptions.mode;
  }
  if (restoredOptions.difficultyDecreaseCount !== undefined) {
    smartDifficultyDecreaseCount.value = restoredOptions.difficultyDecreaseCount;
  }
  if (restoredOptions.sceneIds !== undefined && restoredOptions.sceneIds.length > 0) {
    const available = new Set(scenePaths.value.map((scene) => scene.sceneId));
    const restoredSceneIds = [...new Set(restoredOptions.sceneIds.map(canonicalSceneId))].filter((id) => available.has(id));
    if (restoredSceneIds.length > 0) {
      selectedSceneIds.value = restoredSceneIds;
      focusedSceneId.value = restoredSceneIds[0] ?? focusedSceneId.value;
    }
  }
  viewStateReady = true;
  store.setTargetViewState(localCatalogOverlay(catalog.value), selectedSceneIds.value, focusedSceneId.value, catalog.value);
  void hydrateTeamTargetInspections();
}

async function hydrateTeamTargetInspections(): Promise<void> {
  await Promise.all(store.teamTargets
    .filter((target) => target.source === "team-code" && (
      target.inspection?.editableTargets === undefined
      || !target.inspection.entities.every((entity) => "yuhunConfigEnabled" in entity)
      || !target.inspection.editableTargets.every((item) => "yuhunConfigEnabled" in item)
    ))
    .map((target) => store.inspectStoredTeamTarget(target.id)));
}

async function loadPublishedCatalog(savedState: typeof store.targetViewState): Promise<readonly Record<string, unknown>[] | null> {
  catalogLoading.value = true;
  try {
    const snapshot = await fetchPublishedSceneData();
    const published = snapshot.catalog;
    catalog.value = cloneCatalog(mergePublishedCatalog(
      [...published, OTHER_TARGET_DOMAIN],
      savedState?.catalog
    ) as readonly EditableTargetDomain[]);
    updateNextCustomCatalogId();
    const first = scenePaths.value[0]?.sceneId ?? "";
    const availableIds = new Set(scenePaths.value.map((scene) => scene.sceneId));
    for (const target of store.teamTargets) {
      const migratedId = canonicalSceneId(target.sceneId);
      const migratedScene = scenePaths.value.find((scene) => scene.sceneId === migratedId);
      if (migratedId !== target.sceneId && migratedScene !== undefined) {
        store.moveTeamTarget(target.id, migratedId, migratedScene.sceneLabel);
      }
    }
    const migratedSelectedIds = (savedState?.selectedSceneIds ?? store.teamTargets.map((target) => target.sceneId))
      .map(canonicalSceneId)
      .filter((id, index, values) => availableIds.has(id) && values.indexOf(id) === index);
    selectedSceneIds.value = migratedSelectedIds;
    const migratedFocusedId = canonicalSceneId(savedState?.focusedSceneId ?? "");
    focusedSceneId.value = availableIds.has(migratedFocusedId) ? migratedFocusedId : selectedSceneIds.value[0] ?? first;
    importSceneId.value = "";
    expandedDomainIds.value = published[0] === undefined ? [] : [published[0].id];
    managerDomainId.value = published[0]?.id ?? null;
    managerCategoryId.value = published[0]?.categories[0]?.id ?? null;
    managerSceneId.value = published[0]?.categories[0]?.scenes[0]?.id ?? null;
    return snapshot.targets;
  } catch (reason) {
    catalog.value = [];
    selectedSceneIds.value = [];
    focusedSceneId.value = "";
    importSceneId.value = "";
    expandedDomainIds.value = [];
    managerDomainId.value = null;
    managerCategoryId.value = null;
    managerSceneId.value = null;
    store.error = {
      stage: "targets",
      code: "SCENE_CATALOG_UNAVAILABLE",
      path: "sceneCatalog",
      message: reason instanceof Error ? reason.message : "关卡目录读取失败"
    };
    return null;
  } finally {
    catalogLoading.value = false;
  }
}

function updateNextCustomCatalogId(): void {
  const suffixes = catalog.value.flatMap((domain) => [
    domain.id,
    ...domain.categories.flatMap((category) => [category.id, ...category.scenes.map((scene) => scene.id)])
  ]).map((id) => Number(id.match(/^custom-(?:domain|category|scene)-(\d+)$/)?.[1] ?? 0));
  nextCustomCatalogId = Math.max(1, ...suffixes.map((value) => value + 1));
}

function targetsForScene(sceneId: string): ImportedTeamTarget[] {
  return store.teamTargets
    .map((target, index) => ({ target, index }))
    .filter(({ target }) => target.sceneId === sceneId)
    .sort((left, right) => {
      const leftForced = left.target.forceCalculate === true;
      const rightForced = right.target.forceCalculate === true;
      if (leftForced !== rightForced) return leftForced ? -1 : 1;
      if (leftForced) return left.index - right.index;
      return (right.target.difficulty ?? -Infinity) - (left.target.difficulty ?? -Infinity) || left.index - right.index;
    })
    .map(({ target }) => target);
}

function teamCalculationStatus(target: ImportedTeamTarget): "completed" | "running" | "pending" | "error" {
  const progress = store.teamCalculationProgressFor(target.id);
  if (progress !== null) return progress.status;
  const report = store.teamCalculationFor(target.id);
  if (report !== null) return report.entities.some((entity) => entity.status === "unsupported") ? "error" : "completed";
  return "pending";
}

const teamCalculationLocked = computed(() => store.busy === "正在计算阵容御魂搭配" || store.teamCalculationPaused);
function smartVisibleEnabled(target: ImportedTeamTarget): boolean {
  if (teamSelectionMode.value !== "smart") return target.enabled;
  if (target.forceCalculate === true) return true;
  const ordinary = targetsForScene(target.sceneId).filter((item) => item.forceCalculate !== true);
  const index = ordinary.findIndex((item) => item.id === target.id);
  if (smartDifficultyDecreaseCount.value === "auto") {
    // A smart run can advance beyond the highest-difficulty lineup. Keep every
    // lineup already reached by this run visibly selected after restoration.
    return store.teamCalculationProgressFor(target.id) !== null || index === 0;
  }
  return index >= 0 && index < Number(smartDifficultyDecreaseCount.value);
}

function targetDisplayStatus(target: ImportedTeamTarget): string {
  const status = teamCalculationStatus(target);
  // Once a calculation run has initialized a target, its enabled state becomes
  // an execution state immediately; it remains "待计算" until the worker
  // starts reporting progress for that target.
  if (status === "pending" && store.teamCalculationProgressFor(target.id) !== null) return "待计算";
  if (teamSelectionMode.value === "smart" && status === "pending" && smartDifficultyDecreaseCount.value === "auto") {
    const ordered = targetsForScene(target.sceneId);
    const index = ordered.findIndex((item) => item.id === target.id);
    const previous = index > 0 ? store.teamCalculationFor(ordered[index - 1]!.id) : null;
    if (previous !== null && !teamCalculationMeetsTargetScore(previous)) return "待计算";
  }
  if (status === "completed") return "计算完成";
  if (status === "running") return "计算中";
  if (status === "error") return "错误";
  return smartVisibleEnabled(target) ? "已启用" : "未启用";
}

function filteredTargetsForScene(sceneId: string): ImportedTeamTarget[] {
  return targetsForScene(sceneId).filter((target) => {
    if (teamCalculationFilter.value === "all") return true;
    if (teamCalculationFilter.value === "enabled") return targetDisplayStatus(target) === "已启用";
    if (teamCalculationFilter.value === "disabled") return targetDisplayStatus(target) === "未启用";
    if (teamCalculationFilter.value === "completed") return targetDisplayStatus(target) === "计算完成";
    if (teamCalculationFilter.value === "running") return targetDisplayStatus(target) === "计算中";
    if (teamCalculationFilter.value === "pending") return targetDisplayStatus(target) === "待计算";
    if (teamCalculationFilter.value === "error") return targetDisplayStatus(target) === "错误";
    return true;
  });
}

function isValidDifficulty(value: number | ""): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 100;
}

function nullableDifficulty(value: number | ""): number | null {
  return isValidDifficulty(value) ? value : null;
}

function setImportForceCalculate(value: boolean): void {
  if (value === importForceCalculate.value) return;
  if (value) {
    importStoredDifficulty.value = importDifficulty.value;
    importDifficulty.value = "";
  } else {
    importDifficulty.value = importStoredDifficulty.value;
  }
  importForceCalculate.value = value;
}

function setTargetDetailForceCalculate(value: boolean): void {
  if (value === targetDetailForceCalculate.value) return;
  if (value) {
    targetDetailStoredDifficulty.value = targetDetailDifficulty.value;
    targetDetailDifficulty.value = "";
  } else {
    targetDetailDifficulty.value = targetDetailStoredDifficulty.value;
  }
  targetDetailForceCalculate.value = value;
}

function formatGameSceneId(gameSceneId: number | null | undefined): string {
  return gameSceneId === null || gameSceneId === undefined ? "未设置" : String(gameSceneId);
}

function parseGameSceneId(value: string): number | null {
  const normalized = value.trim();
  if (normalized === "") return null;
  const gameSceneId = Number(normalized);
  if (!Number.isSafeInteger(gameSceneId) || gameSceneId <= 0) throw new Error("关卡 ID 必须是正整数");
  return gameSceneId;
}

function syncManualSceneGameId(): void {
  manualSceneGameId.value = importScenePath.value?.gameSceneId === null || importScenePath.value === null
    ? ""
    : String(importScenePath.value.gameSceneId);
}

function setSceneGameSceneId(sceneId: string, gameSceneId: number | null): void {
  const next = cloneCatalog(catalog.value);
  for (const domain of next) {
    for (const category of domain.categories) {
      const index = category.scenes.findIndex((scene) => scene.id === sceneId);
      if (index < 0) continue;
      const scene = category.scenes[index]!;
      if (isCustomCatalogId(scene.id)) {
        const { gameSceneIdOverride: _ignored, ...withoutOverride } = scene;
        category.scenes[index] = { ...withoutOverride, gameSceneId };
      } else if (scene.gameSceneId === gameSceneId) {
        const { gameSceneIdOverride: _ignored, ...withoutOverride } = scene;
        category.scenes[index] = withoutOverride;
      } else {
        category.scenes[index] = { ...scene, gameSceneIdOverride: gameSceneId };
      }
      catalog.value = next;
      syncManualSceneGameId();
      return;
    }
  }
  throw new Error("具体关卡不存在");
}

function setSceneMutualExclusion(sceneId: string, mutualExclusion: boolean): void {
  const next = cloneCatalog(catalog.value);
  for (const domain of next) {
    for (const category of domain.categories) {
      const index = category.scenes.findIndex((scene) => scene.id === sceneId);
      if (index < 0) continue;
      category.scenes[index] = { ...category.scenes[index]!, mutualExclusion };
      catalog.value = next;
      return;
    }
  }
}

function unmatchedSceneNotice(inspection: TeamCodeInspectionDTO, matches: readonly TargetScenePath[]): string {
  if (inspection.gameSceneId === null) return "未读取到关卡 ID，已暂时选择“其他”。你可以直接按“其他”导入，也可以手动指定一个具体关卡。";
  if (matches.length > 1) return `关卡 ID ${inspection.gameSceneId} 匹配到多个具体关卡，已暂时选择“其他”。请手动指定一个具体关卡。`;
  return `关卡 ID ${inspection.gameSceneId} 尚未关联到具体关卡，已暂时选择“其他”。你可以直接按“其他”导入，也可以手动指定一个具体关卡。`;
}

function targetCountForSceneIds(sceneIds: readonly string[]): number {
  const ids = new Set(sceneIds);
  return store.teamTargets.filter((target) => ids.has(target.sceneId)).length;
}

function enabledTargetsForScene(sceneId: string): number {
  return targetsForScene(sceneId).filter((target) => targetDisplayStatus(target) === "已启用").length;
}

function openImporter(sceneId: string | null = null): void {
  importInspectionSequence += 1;
  importMode.value = "code";
  importSceneId.value = sceneId ?? "";
  importLabel.value = "";
  importDifficulty.value = "";
  importStoredDifficulty.value = "";
  importForceCalculate.value = false;
  importDifficultyManuallyEdited.value = false;
  autoSelectedImportLabel.value = false;
  importLabelManuallyEdited.value = false;
  importCode.value = "";
  qrMessage.value = "";
  qrFailed.value = false;
  importSubmitError.value = "";
  importSceneNotice.value = "";
  pendingSceneInspection.value = null;
  pendingSceneInspectionCode.value = "";
  awaitingSceneConfirmation.value = false;
  pendingTeamSceneMismatch.value = null;
  teamSceneMismatchDoNotAskToday.value = false;
  pendingTeamSceneIdAssignment.value = null;
  autoSelectedImportScene.value = false;
  manualConfiguredCount.value = 0;
  manualDrafts.value = [];
  syncManualSceneGameId();
  importOpen.value = true;
}

function markImportSceneSelected(): void {
  importInspectionSequence += 1;
  autoSelectedImportScene.value = false;
  importSubmitError.value = "";
  syncManualSceneGameId();
}

function setImportMode(mode: "code" | "manual"): void {
  importMode.value = mode;
  if (mode === "manual") syncManualSceneGameId();
}

function markImportLabelEdited(): void {
  autoSelectedImportLabel.value = false;
  importLabelManuallyEdited.value = true;
  applyImportDifficultyFromLabel();
}

function markImportDifficultyEdited(): void {
  importDifficultyManuallyEdited.value = true;
}

function applyImportDifficultyFromLabel(): void {
  if (importDifficultyManuallyEdited.value) return;
  const inferred = teamDifficultyFromLabel(importLabel.value);
  if (importForceCalculate.value) importStoredDifficulty.value = inferred ?? "";
  else importDifficulty.value = inferred ?? "";
}

function applyInspectionTeamName(inspection: TeamCodeInspectionDTO): void {
  const teamName = inspection.teamName?.trim() ?? "";
  if (importLabelManuallyEdited.value) return;
  if (teamName === "") {
    if (autoSelectedImportLabel.value) importLabel.value = "";
    autoSelectedImportLabel.value = false;
    return;
  }
  if (importLabel.value.trim() !== "" && !autoSelectedImportLabel.value) return;
  importLabel.value = teamName.slice(0, 80);
  autoSelectedImportLabel.value = true;
  applyImportDifficultyFromLabel();
}

function reportQrFailure(reason: unknown): void {
  const message = reason instanceof Error ? reason.message : "二维码识别失败";
  qrMessage.value = message;
  qrFailed.value = true;
  store.error = { stage: "targets", code: "TEAM_CODE_QR_UNREADABLE", path: "teamCodeQr", message };
}

async function applyQrTeamCode(code: string, source: "图片" | "剪贴板文字" | "剪贴板图片"): Promise<void> {
  importCode.value = code;
  qrMessage.value = `${source}识别成功，已填入阵容码`;
  qrFailed.value = false;
  store.error = null;
  await autoCompleteImportScene(code);
}

async function autoCompleteImportScene(code = importCode.value): Promise<void> {
  const normalizedCode = code.trim();
  const sequence = ++importInspectionSequence;
  if (autoSelectedImportLabel.value) {
    importLabel.value = "";
    applyImportDifficultyFromLabel();
  }
  autoSelectedImportLabel.value = false;
  if (autoSelectedImportScene.value) importSceneId.value = "";
  autoSelectedImportScene.value = false;
  importSceneNotice.value = "";
  importSubmitError.value = "";
  pendingSceneInspection.value = null;
  pendingSceneInspectionCode.value = "";
  awaitingSceneConfirmation.value = false;
  if (!normalizedCode.startsWith("#TA#")) return;

  const inspection = await store.inspectTeamTarget(normalizedCode);
  if (sequence !== importInspectionSequence || normalizedCode !== importCode.value.trim() || !importOpen.value) return;
  if (inspection === null) {
    importSubmitError.value = store.error?.message ?? "阵容码解析失败";
    return;
  }
  applyInspectionTeamName(inspection);
  pendingSceneInspection.value = inspection;
  pendingSceneInspectionCode.value = normalizedCode;
  const matches = inspection.gameSceneId === null
    ? []
    : findTargetScenesByGameSceneId(inspection.gameSceneId, catalog.value);
  if (importSceneId.value !== "") return;
  if (matches.length === 1) {
    importSceneId.value = matches[0]!.sceneId;
    autoSelectedImportScene.value = true;
    return;
  }

  importSceneId.value = OTHER_SCENE_ID;
  autoSelectedImportScene.value = true;
  awaitingSceneConfirmation.value = true;
  importSceneNotice.value = unmatchedSceneNotice(inspection, matches);
  store.error = null;
}

function chooseQrImage(): void {
  qrImageInput.value?.click();
}

async function readQrImage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file === undefined) return;
  qrBusy.value = "image";
  qrMessage.value = "正在识别二维码图片…";
  qrFailed.value = false;
  try {
    await applyQrTeamCode(await decodeTeamCodeFromQrImage(file), "图片");
  } catch (reason) {
    reportQrFailure(reason);
  } finally {
    qrBusy.value = null;
  }
}

async function readClipboardTeamCode(): Promise<void> {
  qrBusy.value = "clipboard";
  qrMessage.value = "正在读取剪贴板…";
  qrFailed.value = false;
  try {
    const result = await readTeamCodeFromClipboard();
    await applyQrTeamCode(result.code, result.source === "text" ? "剪贴板文字" : "剪贴板图片");
  } catch (reason) {
    reportQrFailure(reason);
  } finally {
    qrBusy.value = null;
  }
}

async function handleTeamCodePaste(event: ClipboardEvent): Promise<void> {
  if (!importOpen.value || importMode.value !== "code" || event.clipboardData === null) return;
  const text = event.clipboardData.getData("text/plain").trim();
  if (text.startsWith("#TA#")) {
    event.preventDefault();
    await applyQrTeamCode(text, "剪贴板文字");
    return;
  }
  const image = Array.from(event.clipboardData.items)
    .find((item) => item.kind === "file" && item.type.startsWith("image/"))
    ?.getAsFile() ?? null;
  if (image === null) return;
  event.preventDefault();
  qrBusy.value = "clipboard";
  qrMessage.value = "正在识别剪贴板图片…";
  qrFailed.value = false;
  try {
    await applyQrTeamCode(await decodeTeamCodeFromQrImage(image), "剪贴板图片");
  } catch (reason) {
    reportQrFailure(reason);
  } finally {
    qrBusy.value = null;
  }
}

async function importTarget(): Promise<void> {
  importSubmitError.value = "";
  const normalizedCode = importCode.value.trim();
  let inspection: TeamCodeInspectionDTO | null;
  if (
    pendingSceneInspection.value !== null
    && pendingSceneInspectionCode.value === normalizedCode
  ) {
    inspection = pendingSceneInspection.value;
    awaitingSceneConfirmation.value = false;
  } else {
    if (autoSelectedImportScene.value) importSceneId.value = "";
    autoSelectedImportScene.value = false;
    importSceneNotice.value = "";
    pendingSceneInspection.value = null;
    pendingSceneInspectionCode.value = "";
    awaitingSceneConfirmation.value = false;
    inspection = await store.inspectTeamTarget(normalizedCode);
  }
  if (inspection === null) {
    importSubmitError.value = store.error?.message ?? "阵容码解析失败";
    return;
  }
  applyInspectionTeamName(inspection);
  const matches = inspection.gameSceneId === null
    ? []
    : findTargetScenesByGameSceneId(inspection.gameSceneId, catalog.value);
  if (importSceneId.value === "" && matches.length === 1) {
    importSceneId.value = matches[0]!.sceneId;
  } else if (importSceneId.value === "") {
    importSceneId.value = OTHER_SCENE_ID;
    autoSelectedImportScene.value = true;
    pendingSceneInspection.value = inspection;
    pendingSceneInspectionCode.value = normalizedCode;
    awaitingSceneConfirmation.value = true;
    importSceneNotice.value = unmatchedSceneNotice(inspection, matches);
    store.error = null;
    return;
  }
  const scene = scenePaths.value.find((item) => item.sceneId === importSceneId.value);
  if (scene === undefined) {
    const message = "阵容码关卡尚未收录，请选择一个具体场景";
    store.error = { stage: "targets", code: "INVALID_TARGET_SCENE", path: "sceneId", message };
    importSubmitError.value = message;
    return;
  }
  if (!importForceCalculate.value && !isValidDifficulty(importDifficulty.value)) {
    importSubmitError.value = "请填写 1 至 100 的整数难度";
    return;
  }
  const importRequest: TeamSceneMismatchRequest = {
    code: importCode.value,
    inspection,
    sceneId: scene.sceneId,
    sceneLabel: scene.sceneLabel,
    selectedScenePath: `${scene.domainLabel} / ${scene.categoryLabel} / ${scene.sceneLabel}`,
    codeScenePaths: matches.map((match) => `${match.domainLabel} / ${match.categoryLabel} / ${match.sceneLabel}`),
    teamLabel: importLabel.value,
    difficulty: importForceCalculate.value
      ? nullableDifficulty(importStoredDifficulty.value)
      : nullableDifficulty(importDifficulty.value),
    forceCalculate: importForceCalculate.value
  };
  if (
    inspection.gameSceneId !== null
    && matches.length === 0
    && scene.sceneId !== OTHER_SCENE_ID
    && scene.gameSceneId !== inspection.gameSceneId
  ) {
    pendingTeamSceneIdAssignment.value = { gameSceneId: inspection.gameSceneId, importRequest };
    store.error = null;
    return;
  }
  const mismatch = matches.length > 0
    && !matches.some((match) => match.sceneId === scene.sceneId);
  if (mismatch) {
    if (confirmationSuppressedToday(TEAM_SCENE_MISMATCH_CONFIRMATION_KEY)) {
      performInspectedTeamTargetImport(importRequest);
      return;
    }
    teamSceneMismatchDoNotAskToday.value = false;
    pendingTeamSceneMismatch.value = importRequest;
    store.error = null;
    return;
  }
  performInspectedTeamTargetImport(importRequest);
}

function performInspectedTeamTargetImport(request: TeamSceneMismatchRequest): void {
  if (store.addInspectedTeamTarget(
    request.code,
    request.inspection,
    request.sceneId,
    request.teamLabel,
    request.sceneLabel,
    request.difficulty,
    request.forceCalculate
  )) {
    if (!selectedSceneIds.value.includes(request.sceneId)) selectedSceneIds.value = [...selectedSceneIds.value, request.sceneId];
    pendingTeamSceneMismatch.value = null;
    importOpen.value = false;
  } else {
    importSubmitError.value = store.error?.message ?? "阵容目标导入失败";
  }
}

function cancelTeamSceneMismatchImport(): void {
  pendingTeamSceneMismatch.value = null;
  teamSceneMismatchDoNotAskToday.value = false;
}

function confirmTeamSceneMismatchImport(): void {
  const request = pendingTeamSceneMismatch.value;
  if (request === null) return;
  if (teamSceneMismatchDoNotAskToday.value) suppressConfirmationToday(TEAM_SCENE_MISMATCH_CONFIRMATION_KEY);
  pendingTeamSceneMismatch.value = null;
  teamSceneMismatchDoNotAskToday.value = false;
  performInspectedTeamTargetImport(request);
}

function cancelTeamSceneIdAssignment(): void {
  pendingTeamSceneIdAssignment.value = null;
}

function importWithoutAssigningSceneId(): void {
  const request = pendingTeamSceneIdAssignment.value;
  if (request === null) return;
  pendingTeamSceneIdAssignment.value = null;
  performInspectedTeamTargetImport(request.importRequest);
}

function assignSceneIdAndImport(): void {
  const request = pendingTeamSceneIdAssignment.value;
  if (request === null) return;
  try {
    setSceneGameSceneId(request.importRequest.sceneId, request.gameSceneId);
    pendingTeamSceneIdAssignment.value = null;
    performInspectedTeamTargetImport(request.importRequest);
  } catch (reason) {
    store.error = {
      stage: "targets",
      code: "INVALID_GAME_SCENE_ID",
      path: "gameSceneId",
      message: reason instanceof Error ? reason.message : "关卡 ID 设置失败"
    };
  }
}

function saveManualTarget(): void {
  const scene = scenePaths.value.find((item) => item.sceneId === importSceneId.value);
  if (scene === undefined) {
    store.error = { stage: "targets", code: "INVALID_TARGET_SCENE", path: "sceneId", message: "请选择有效的具体场景" };
    return;
  }
  if (!importForceCalculate.value && !isValidDifficulty(importDifficulty.value)) {
    store.error = { stage: "targets", code: "INVALID_TEAM_DIFFICULTY", path: "difficulty", message: "请填写 1 至 100 的整数难度" };
    return;
  }
  let gameSceneId: number | null;
  try {
    gameSceneId = parseGameSceneId(manualSceneGameId.value);
  } catch (reason) {
    store.error = {
      stage: "targets",
      code: "INVALID_GAME_SCENE_ID",
      path: "gameSceneId",
      message: reason instanceof Error ? reason.message : "关卡 ID 无效"
    };
    return;
  }
  if (store.saveManualTeamTarget(
    manualDrafts.value,
    importSceneId.value,
    importLabel.value,
    scene.sceneLabel,
    importForceCalculate.value ? nullableDifficulty(importStoredDifficulty.value) : nullableDifficulty(importDifficulty.value),
    importForceCalculate.value
  )) {
    setSceneGameSceneId(importSceneId.value, gameSceneId);
    if (!selectedSceneIds.value.includes(importSceneId.value)) selectedSceneIds.value = [...selectedSceneIds.value, importSceneId.value];
    importOpen.value = false;
  }
}

function editableTargetsFor(target: ImportedTeamTarget): readonly ManualShikigamiCalculationInput[] {
  if (target.manualTargets !== undefined) return target.manualTargets;
  return target.inspection?.editableTargets ?? [];
}

function previewShikigamiName(target: ManualShikigamiCalculationInput): string {
  return shikigamiByHeroId(target.shikigamiId)?.name ?? target.shikigamiName ?? `式神 #${target.shikigamiId}`;
}

function calculationEntityName(entity: TeamCalculationEntityDTO, target: ImportedTeamTarget): string {
  const configured = editableTargetsFor(target).find((item) => item.entityIndex === entity.entityIndex);
  return configured === undefined ? entity.shikigamiName : previewShikigamiName(configured);
}

async function openTargetDetail(target: ImportedTeamTarget): Promise<void> {
  targetDetailId.value = target.id;
  targetDetailEditing.value = false;
  targetDetailLabel.value = target.label;
  targetDetailForceCalculate.value = target.forceCalculate === true;
  targetDetailStoredDifficulty.value = target.difficulty ?? "";
  targetDetailDifficulty.value = target.forceCalculate === true ? "" : target.difficulty ?? "";
  targetDetailInitialTargets.value = [];
  targetDetailDrafts.value = [];
  targetDetailConfiguredCount.value = 0;
  targetDetailLoading.value = true;
  try {
    const inspection = target.source === "team-code"
      ? await store.inspectStoredTeamTarget(target.id)
      : null;
    if (targetDetailId.value !== target.id) return;
    const editableTargets = target.manualTargets ?? inspection?.editableTargets ?? [];
    targetDetailInitialTargets.value = JSON.parse(JSON.stringify(editableTargets)) as ManualShikigamiCalculationInput[];
    targetDetailDrafts.value = JSON.parse(JSON.stringify(editableTargets)) as ManualShikigamiCalculationInput[];
    targetDetailConfiguredCount.value = editableTargets.filter((target) => target.yuhunConfigEnabled !== false).length;
    targetDetailEditorKey.value += 1;
  } finally {
    if (targetDetailId.value === target.id) targetDetailLoading.value = false;
  }
}

function closeTargetDetail(): void {
  targetDetailId.value = null;
  targetDetailEditing.value = false;
  targetDetailLoading.value = false;
  targetDetailDifficulty.value = "";
  targetDetailStoredDifficulty.value = "";
  targetDetailForceCalculate.value = false;
}

function beginTargetDetailEdit(): void {
  const target = targetDetail.value;
  if (target === null || targetDetailInitialTargets.value.length === 0) return;
  targetDetailEditing.value = true;
  targetDetailLabel.value = targetDetailIsPublished.value ? `${target.label}（副本）`.slice(0, 80) : target.label;
}

function cancelTargetDetailEdit(): void {
  const target = targetDetail.value;
  if (target === null) return;
  targetDetailEditing.value = false;
  targetDetailLabel.value = target.label;
  targetDetailForceCalculate.value = target.forceCalculate === true;
  targetDetailStoredDifficulty.value = target.difficulty ?? "";
  targetDetailDifficulty.value = target.forceCalculate === true ? "" : target.difficulty ?? "";
  targetDetailDrafts.value = JSON.parse(JSON.stringify(targetDetailInitialTargets.value)) as ManualShikigamiCalculationInput[];
  targetDetailConfiguredCount.value = targetDetailInitialTargets.value.filter((item) => item.yuhunConfigEnabled !== false).length;
  targetDetailEditorKey.value += 1;
}

function saveTargetDetail(): void {
  const target = targetDetail.value;
  if (target === null) return;
  if (!targetDetailForceCalculate.value && !isValidDifficulty(targetDetailDifficulty.value)) {
    store.error = { stage: "targets", code: "INVALID_TEAM_DIFFICULTY", path: "difficulty", message: "请填写 1 至 100 的整数难度" };
    return;
  }
  const savedId = store.saveEditedTeamTarget(
    target.id,
    targetDetailDrafts.value,
    targetDetailLabel.value,
    targetDetailForceCalculate.value ? nullableDifficulty(targetDetailStoredDifficulty.value) : nullableDifficulty(targetDetailDifficulty.value),
    targetDetailForceCalculate.value
  );
  if (savedId === null) return;
  targetDetailId.value = savedId;
  const saved = store.teamTargets.find((item) => item.id === savedId);
  targetDetailLabel.value = saved?.label ?? targetDetailLabel.value.trim();
  targetDetailInitialTargets.value = JSON.parse(JSON.stringify(targetDetailDrafts.value)) as ManualShikigamiCalculationInput[];
  targetDetailEditing.value = false;
  targetDetailEditorKey.value += 1;
}

function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function confirmationSuppressedToday(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === localDateKey();
  } catch {
    return false;
  }
}

function suppressConfirmationToday(key: string): void {
  try {
    window.localStorage.setItem(key, localDateKey());
  } catch {
    // localStorage 不可用时，本次操作仍继续，后续继续提示。
  }
}

function performTeamTargetDelete(request: TeamTargetDeleteRequest): void {
  const target = store.teamTargets.find((item) => item.id === request.id);
  if (target === undefined || target.locked || target.builtIn) return;
  store.removeTeamTarget(request.id);
  if (targetDetailId.value === request.id) closeTargetDetail();
}

function requestTeamTargetDelete(target: ImportedTeamTarget): void {
  if (target.locked || target.builtIn) return;
  const request = { id: target.id, label: target.label };
  if (confirmationSuppressedToday(TEAM_DELETE_CONFIRMATION_KEY)) {
    performTeamTargetDelete(request);
    return;
  }
  teamDeleteDoNotAskToday.value = false;
  pendingTeamTargetDelete.value = request;
}

function cancelTeamTargetDelete(): void {
  pendingTeamTargetDelete.value = null;
  teamDeleteDoNotAskToday.value = false;
}

function confirmTeamTargetDelete(): void {
  const request = pendingTeamTargetDelete.value;
  if (request === null) return;
  if (teamDeleteDoNotAskToday.value) suppressConfirmationToday(TEAM_DELETE_CONFIRMATION_KEY);
  pendingTeamTargetDelete.value = null;
  teamDeleteDoNotAskToday.value = false;
  performTeamTargetDelete(request);
}

function deleteTargetDetail(): void {
  const target = targetDetail.value;
  if (target === null || targetDetailIsPublished.value) return;
  requestTeamTargetDelete(target);
}

function panelStatEntries(panel: Panel): Array<{ label: string; value: string }> {
  const percent = (value: number): string => `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
  return [
    { label: "攻击", value: panel.attack.toFixed(0) },
    { label: "生命", value: panel.hp.toFixed(0) },
    { label: "防御", value: panel.defense.toFixed(0) },
    { label: "速度", value: panel.speed.toFixed(1).replace(/\.0$/, "") },
    { label: "暴击", value: percent(panel.crit) },
    { label: "暴伤", value: percent(panel.critDamage) },
    { label: "命中", value: percent(panel.effectHit) },
    { label: "抵抗", value: percent(panel.effectResist) }
  ];
}

function calculationStatusLabel(entity: TeamCalculationEntityDTO): string {
  if (entity.status === "success") return entity.exact ? "精确最优" : "近似最优";
  if (entity.status === "no-match") return "无满足组合";
  if (entity.status === "disabled") return "配置已关闭";
  return "暂不支持";
}

const teamProgressPercent = computed(() => {
  const current = activeTeamProgress.value;
  if (store.busy !== "正在计算阵容御魂搭配" || current?.phase !== "team-calculation") return 0;
  return Math.round(current.completed / Math.max(1, current.total) * 100);
});

function calculationScore(entity: TeamCalculationEntityDTO): string {
  return entity.score === null ? "-" : entity.score.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function entityTargetScore(entity: TeamCalculationEntityDTO): number | null {
  const value = entity.targetScoreRaw;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function entityTargetScoreLabel(entity: TeamCalculationEntityDTO): string | null {
  const targetScore = entityTargetScore(entity);
  return targetScore === null ? null : `目标评分 ${targetScore.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function entityMeetsTargetScore(entity: TeamCalculationEntityDTO): boolean {
  const targetScore = entityTargetScore(entity);
  if (targetScore === null || entity.score === null || entity.status !== "success") return false;
  return Math.round((entity.score + Number.EPSILON) * 100) / 100 >= targetScore;
}

function targetScoreStatus(target: ImportedTeamTarget): "达标" | "未达标" | null {
  const report = store.teamCalculationFor(target.id);
  if (report === null) return null;
  const scoredEntities = report.entities.filter((entity) => entityTargetScore(entity) !== null);
  if (scoredEntities.length === 0) return null;
  return scoredEntities
    .filter((entity) => entityTargetScore(entity) !== null)
    .every(entityMeetsTargetScore) ? "达标" : "未达标";
}

function calculationSuitSummary(entity: TeamCalculationEntityDTO): string {
  const counts = new Map<string, number>();
  for (const piece of entity.pieces) counts.set(piece.suit, (counts.get(piece.suit) ?? 0) + 1);
  const completedSets = [...counts.entries()]
    .filter(([suit, count]) => count >= (yuhunCategory(suit) === "首领御魂" ? 2 : 4))
    .sort(([leftSuit, leftCount], [rightSuit, rightCount]) => {
      const categoryOrder = Number(yuhunCategory(leftSuit) === "首领御魂") - Number(yuhunCategory(rightSuit) === "首领御魂");
      return categoryOrder || rightCount - leftCount;
    })
    .map(([suit]) => suit);
  return completedSets.join(" + ") || "散件";
}

const calculationDetailTarget = computed(() => store.teamTargets.find((target) => target.id === calculationDetailTargetId.value) ?? null);
const calculationDetailReport = computed(() => calculationDetailTarget.value === null ? null : store.teamCalculationFor(calculationDetailTarget.value.id));
const calculationDetailEntity = computed(() => calculationDetailReport.value?.entities.find((entity) => entity.entityIndex === calculationDetailEntityIndex.value) ?? calculationDetailReport.value?.entities[0] ?? null);
const calculationDetailPiece = computed(() => {
  const entity = calculationDetailEntity.value;
  const piece = entity?.pieces.find((item) => item.position === calculationDetailPosition.value) ?? null;
  if (piece === null || piece.mainValue !== undefined) return piece;
  return entity?.potentialYuhunDetails?.find((item) => item.yuhunId === piece.yuhunId) ?? calculationDetailPieces.value.get(piece.yuhunId ?? "") ?? piece;
});
const calculationDetailCandidates = computed(() => {
  const entity = calculationDetailEntity.value;
  if (entity === null) return [];
  const ids = entity.potentialEvidence === undefined
    ? entity.potentialYuhunIds ?? []
    : entity.potentialEvidence
      .filter((item) => item.strategy === "upgrade-upper-bound" && item.position === calculationDetailPosition.value)
      .map((item) => item.yuhunId);
  return [...new Set(ids)].flatMap((id) => {
    const item = entity.potentialYuhunDetails?.find((detail) => detail.yuhunId === id) ?? calculationDetailPieces.value.get(id);
    return item?.position === calculationDetailPosition.value ? [item] : [];
  });
});
const calculationDetailCandidatePageCount = computed(() => Math.max(1, Math.ceil(calculationDetailCandidates.value.length / 12)));
const calculationDetailCandidatePageItems = computed(() => calculationDetailCandidates.value.slice((calculationDetailCandidatePage.value - 1) * 12, calculationDetailCandidatePage.value * 12));
const calculationDisplayedPiece = computed(() => calculationDetailCandidates.value.find((item) => item.yuhunId === calculationDetailCandidateId.value) ?? calculationDetailPiece.value);

function selectCalculationPosition(position: number): void {
  calculationDetailPosition.value = position;
  calculationDetailCandidateId.value = null;
  calculationDetailCandidatePage.value = 1;
}

function openCalculationCandidateComparison(candidate: TeamCalculationYuhunDTO): void {
  const entity = calculationDetailEntity.value;
  const target = calculationDetailTarget.value;
  const reference = calculationDetailPiece.value;
  if (entity === null || target === null || reference === null) return;
  const evidence = entity.potentialEvidence?.find((item) => item.strategy === "upgrade-upper-bound" && item.yuhunId === candidate.yuhunId && item.position === candidate.position);
  if (evidence === undefined) return;
  potentialComparisonTargets.value = [{
    ...(evidence.comparisonNote === undefined ? {} : { comparisonNote: evidence.comparisonNote }),
    position: candidate.position,
    teamLabel: target.label,
    shikigamiName: entity.shikigamiName,
    metricName: entity.metricName,
    score: entity.score,
    strategy: evidence.strategy,
    statesEvaluated: evidence.statesEvaluated,
    referenceSuit: evidence.referenceSuit,
    referenceLevel: evidence.referenceLevel,
    exactEmbryo: evidence.exactEmbryo,
    candidate: potentialComparisonPiece(candidate),
    reference: potentialComparisonPiece(reference),
    upperScore: evidence.upperScore,
    baselineScore: evidence.baselineScore
  }];
  potentialComparisonTitle.value = `${calculationEntityName(entity, target)} · ${candidate.position}号御魂对比`;
  potentialComparisonCompact.value = true;
}

async function loadCalculationDetailPieces(entity: TeamCalculationEntityDTO | undefined): Promise<void> {
  const ids = entity === undefined ? [] : [...entity.pieces, ...(entity.potentialYuhunDetails ?? [])].flatMap((piece) => piece.mainValue === undefined && piece.yuhunId ? [piece.yuhunId] : []);
  if (entity?.potentialYuhunDetails === undefined) ids.push(...(entity?.potentialYuhunIds ?? []));
  if (ids.length === 0) return;
  const details = await store.queryYuhunDetails(ids);
  calculationDetailPieces.value = new Map([...calculationDetailPieces.value, ...details.map((item) => [item.yuhunId, item] as const)]);
}

function openCalculationDetail(target: ImportedTeamTarget, entities: readonly TeamCalculationEntityDTO[]): void {
  calculationDetailTargetId.value = target.id;
  calculationDetailEntityIndex.value = entities.find((entity) => entity.status === "success")?.entityIndex ?? entities[0]?.entityIndex ?? null;
  calculationDetailPosition.value = 1;
  calculationDetailCandidateId.value = null;
  calculationDetailCandidatePage.value = 1;
  void loadCalculationDetailPieces(entities.find((entity) => entity.entityIndex === calculationDetailEntityIndex.value));
}

function closeCalculationDetail(): void {
  calculationDetailTargetId.value = null;
  calculationDetailEntityIndex.value = null;
}

function selectCalculationEntity(entity: TeamCalculationEntityDTO): void {
  calculationDetailEntityIndex.value = entity.entityIndex;
  calculationDetailPosition.value = entity.pieces[0]?.position ?? 1;
  calculationDetailCandidateId.value = null;
  calculationDetailCandidatePage.value = 1;
  void loadCalculationDetailPieces(entity);
}

function pieceStatValue(stat: { readonly stat: StatId; readonly value: number }): string {
  const percentStats: readonly StatId[] = ["attackPercent", "hpPercent", "defensePercent", "crit", "critDamage", "effectHit", "effectResist"];
  return percentStats.includes(stat.stat) ? `${(stat.value * 100).toFixed(1).replace(/\.0$/, "")}%` : stat.value.toFixed(1).replace(/\.0$/, "");
}

function potentialComparisonPiece(item: TeamCalculationPieceDTO | null): YuhunPotentialPieceDTO | null {
  if (item === null) return null;
  return {
    position: item.position,
    suit: item.suit,
    mainStat: item.mainStat,
    mainStatLabel: item.mainStatLabel,
    ...(item.mainValue === undefined ? {} : { mainValue: item.mainValue }),
    level: item.level,
    star: item.star,
    ...(item.subStats === undefined ? {} : { subStats: item.subStats }),
    ...(item.intrinsicStats === undefined ? {} : { intrinsicStats: item.intrinsicStats })
  };
}

function openEntityPotentialComparison(target: ImportedTeamTarget, entity: TeamCalculationEntityDTO): void {
  const evidence = entity.potentialEvidence ?? (entity.potentialYuhunIds ?? []).map((yuhunId) => ({
    yuhunId,
    strategy: "candidate-build" as const,
    position: 0,
    referenceSuit: null,
    referenceYuhunId: null,
    referenceLevel: null,
    statesEvaluated: 0,
    upperScore: null,
    baselineScore: entity.score,
    exactEmbryo: false
  }));
  if (evidence.length === 0) return;
  const byId = new Map((entity.potentialYuhunDetails ?? []).map((item) => [item.yuhunId, item]));
  potentialComparisonTargets.value = evidence.filter(entry => entry.strategy === "upgrade-upper-bound").map((entry) => ({
    ...("comparisonNote" in entry && typeof entry.comparisonNote === "string" ? { comparisonNote: entry.comparisonNote } : {}),
    position: entry.position,
    teamLabel: target.label,
    shikigamiName: entity.shikigamiName,
    metricName: entity.metricName,
    score: entity.score,
    strategy: entry.strategy,
    statesEvaluated: entry.statesEvaluated,
    referenceSuit: entry.referenceSuit,
    referenceLevel: entry.referenceLevel,
    exactEmbryo: entry.exactEmbryo,
    candidate: potentialComparisonPiece(byId.get(entry.yuhunId) ?? null),
    reference: entry.strategy === "candidate-build"
      ? null
      : potentialComparisonPiece(entity.pieces.find((piece) => piece.yuhunId === (entry.referenceYuhunId ?? "") || piece.position === entry.position) ?? null),
    upperScore: entry.upperScore,
    baselineScore: entry.baselineScore
  }));
  potentialComparisonTitle.value = `${calculationEntityName(entity, target)} · ${entity.metricName} · 潜力御魂`;
}

async function copyTeamCalculationError(target: ImportedTeamTarget): Promise<void> {
  const report = store.teamCalculationFor(target.id);
  if (report === null) return;
  try {
    await copyText(formatTeamCalculationError(report, (id, fallback) => id === null ? fallback : shikigamiByHeroId(id)?.name ?? fallback));
    store.notice = `已复制“${target.label}”的错误信息`;
  } catch (reason) {
    store.error = {
      stage: "targets",
      code: "COPY_CALCULATION_ERROR_FAILED",
      path: target.id,
      message: reason instanceof Error ? reason.message : "复制错误信息失败"
    };
  }
}

function sceneShortLabel(sceneLabel: string, categoryLabel: string): string {
  const prefix = `${categoryLabel} · `;
  return sceneLabel.startsWith(prefix) ? sceneLabel.slice(prefix.length) : sceneLabel;
}

function selectManagerDomain(domainId: string): void {
  const domain = catalog.value.find((item) => item.id === domainId);
  if (domain === undefined) return;
  managerDomainId.value = domain.id;
  managerCategoryId.value = domain.categories[0]?.id ?? null;
  managerSceneId.value = domain.categories[0]?.scenes[0]?.id ?? null;
  catalogDraft.value = null;
}

function selectManagerCategory(categoryId: string): void {
  const category = managerDomain.value?.categories.find((item) => item.id === categoryId);
  if (category === undefined) return;
  managerCategoryId.value = category.id;
  managerSceneId.value = category.scenes[0]?.id ?? null;
  catalogDraft.value = null;
}

function selectManagerScene(sceneId: string): void {
  if (!managerCategory.value?.scenes.some((scene) => scene.id === sceneId)) return;
  managerSceneId.value = sceneId;
  catalogDraft.value = null;
}

function openCatalogManager(sceneId: string | null = null): void {
  const scene = sceneId === null ? null : scenePaths.value.find((item) => item.sceneId === sceneId) ?? null;
  const context = scene ?? scenePaths.value.find((item) => item.categoryId === activeCategoryId.value) ?? selectedScenes.value[0] ?? scenePaths.value[0] ?? null;
  const domain = catalog.value.find((item) => item.id === (context?.domainId ?? managerDomainId.value)) ?? catalog.value[0] ?? null;
  const category = domain?.categories.find((item) => item.id === (context?.categoryId ?? managerCategoryId.value)) ?? domain?.categories[0] ?? null;
  const selectedScene = category?.scenes.find((item) => item.id === (context?.sceneId ?? managerSceneId.value)) ?? category?.scenes[0] ?? null;
  managerDomainId.value = domain?.id ?? null;
  managerCategoryId.value = category?.id ?? null;
  managerSceneId.value = selectedScene?.id ?? null;
  catalogDraft.value = null;
  catalogManagerOpen.value = true;
}

function closeCatalogManager(): void {
  catalogDraft.value = null;
  pendingCatalogDelete.value = null;
  catalogManagerOpen.value = false;
}

function beginCatalogDraft(level: CatalogNodeLevel, id: string | null = null): void {
  if (id !== null && !isCustomCatalogId(id)) return;
  let label = "";
  let gameSceneId = "";
  if (level === "domain" && id !== null) label = catalog.value.find((domain) => domain.id === id)?.label ?? "";
  if (level === "category" && id !== null) label = managerDomain.value?.categories.find((category) => category.id === id)?.label ?? "";
  if (level === "scene" && id !== null) {
    const scene = managerCategory.value?.scenes.find((item) => item.id === id);
    if (scene !== undefined && managerCategory.value !== null) {
      label = sceneShortLabel(scene.label, managerCategory.value.label);
      const effectiveGameSceneId = scene.gameSceneIdOverride === undefined ? scene.gameSceneId : scene.gameSceneIdOverride;
      gameSceneId = effectiveGameSceneId === null || effectiveGameSceneId === undefined ? "" : String(effectiveGameSceneId);
    }
  }
  catalogDraft.value = { level, id, label, gameSceneId };
  void nextTick(() => {
    const input = catalogDraftInput.value;
    if (input === null) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
}

function duplicateLabel(values: readonly { readonly id: string; readonly label: string }[], label: string, id: string | null): boolean {
  return values.some((value) => value.id !== id && value.label === label);
}

function saveCatalogDraft(): void {
  const draft = catalogDraft.value;
  if (draft === null) return;
  const label = draft.label.trim().slice(0, 40);
  if (label === "") return;

  try {
    const gameSceneId = draft.level === "scene" ? parseGameSceneId(draft.gameSceneId) : null;
    const next = cloneCatalog(catalog.value);
    const renamedScenes: Array<{ id: string; label: string }> = [];
    if (draft.level === "domain") {
      if (duplicateLabel(next, label, draft.id)) throw new Error("已存在同名一级分类");
      if (draft.id === null) {
        const id = `custom-domain-${nextCustomCatalogId++}`;
        next.push({ id, label, categories: [] });
        managerDomainId.value = id;
        managerCategoryId.value = null;
        managerSceneId.value = null;
        expandedDomainIds.value = [...expandedDomainIds.value, id];
      } else {
        const domain = next.find((item) => item.id === draft.id);
        if (domain === undefined) throw new Error("一级分类不存在");
        domain.label = label;
      }
    } else if (draft.level === "category") {
      const domain = next.find((item) => item.id === managerDomainId.value);
      if (domain === undefined) throw new Error("请先选择一级分类");
      if (duplicateLabel(domain.categories, label, draft.id)) throw new Error("该一级分类下已存在同名二级分类");
      if (draft.id === null) {
        const id = `custom-category-${nextCustomCatalogId++}`;
        domain.categories.push({ id, label, scenes: [] });
        managerCategoryId.value = id;
        managerSceneId.value = null;
        if (!expandedDomainIds.value.includes(domain.id)) expandedDomainIds.value = [...expandedDomainIds.value, domain.id];
      } else {
        const category = domain.categories.find((item) => item.id === draft.id);
        if (category === undefined) throw new Error("二级分类不存在");
        const oldLabel = category.label;
        category.label = label;
        category.scenes = category.scenes.map((scene) => {
          const renamed = { ...scene, label: `${label} · ${sceneShortLabel(scene.label, oldLabel)}`.slice(0, 80) };
          renamedScenes.push({ id: renamed.id, label: renamed.label });
          return renamed;
        });
      }
    } else {
      const domain = next.find((item) => item.id === managerDomainId.value);
      const category = domain?.categories.find((item) => item.id === managerCategoryId.value);
      if (category === undefined) throw new Error("请先选择二级分类");
      const fullLabel = `${category.label} · ${label}`.slice(0, 80);
      if (duplicateLabel(category.scenes, fullLabel, draft.id)) throw new Error("该二级分类下已存在同名具体场景");
      if (draft.id === null) {
        const id = `custom-scene-${nextCustomCatalogId++}`;
        category.scenes.push({ id, label: fullLabel, gameSceneId });
        managerSceneId.value = id;
        focusedSceneId.value = id;
        selectedSceneIds.value = [...selectedSceneIds.value, id];
      } else {
        const index = category.scenes.findIndex((item) => item.id === draft.id);
        if (index < 0) throw new Error("具体场景不存在");
        const scene = category.scenes[index]!;
        const { gameSceneIdOverride: _ignored, ...withoutOverride } = scene;
        category.scenes[index] = { ...withoutOverride, label: fullLabel, gameSceneId };
        renamedScenes.push({ id: scene.id, label: fullLabel });
      }
    }
    catalog.value = next;
    for (const renamed of renamedScenes) {
      for (const target of targetsForScene(renamed.id)) store.moveTeamTarget(target.id, renamed.id, renamed.label);
    }
    catalogDraft.value = null;
  } catch (reason) {
    store.error = { stage: "targets", code: "INVALID_CATALOG_NODE", path: "targetCatalog", message: reason instanceof Error ? reason.message : "分类目录修改无效" };
  }
}

function catalogDeleteRequest(level: CatalogNodeLevel, id: string): CatalogDeleteRequest | null {
  const domain = level === "domain" ? catalog.value.find((item) => item.id === id) ?? null : managerDomain.value;
  const category = level === "category"
    ? domain?.categories.find((item) => item.id === id) ?? null
    : managerCategory.value;
  const scene = level === "scene" ? category?.scenes.find((item) => item.id === id) ?? null : null;
  if ((level === "domain" && domain === null) || (level === "category" && category === null) || (level === "scene" && scene === null)) return null;
  const sceneIds = level === "domain"
    ? sceneIdsForDomain(id)
    : level === "category"
      ? sceneIdsForCategory(category ?? { scenes: [] })
      : [id];
  return {
    level,
    id,
    label: level === "domain" ? domain!.label : level === "category" ? category!.label : scene!.label,
    categoryCount: level === "domain" ? domain!.categories.length : 0,
    sceneCount: level === "domain" ? sceneIds.length : level === "category" ? sceneIds.length : 0,
    targetCount: targetCountForSceneIds(sceneIds),
    sceneIds
  };
}

function requestCatalogDelete(level: CatalogNodeLevel, id: string): void {
  if (!isCustomCatalogId(id)) return;
  const request = catalogDeleteRequest(level, id);
  if (request === null) return;
  if (request.categoryCount > 0 || request.sceneCount > 0 || request.targetCount > 0) {
    pendingCatalogDelete.value = request;
    return;
  }
  performCatalogDelete(request);
}

function confirmCatalogDelete(): void {
  const request = pendingCatalogDelete.value;
  if (request === null) return;
  performCatalogDelete(request);
  pendingCatalogDelete.value = null;
}

function performCatalogDelete(request: CatalogDeleteRequest): void {
  const { level, id, sceneIds } = request;
  const domain = level === "domain" ? catalog.value.find((item) => item.id === id) ?? null : managerDomain.value;

  const removedCategoryIds = level === "domain" ? domain?.categories.map((item) => item.id) ?? [] : level === "category" ? [id] : [];
  const sceneIdSet = new Set(sceneIds);
  for (const target of store.teamTargets.filter((item) => sceneIdSet.has(item.sceneId))) store.removeTeamTarget(target.id);
  const next = cloneCatalog(catalog.value);
  if (level === "domain") {
    const domainIndex = next.findIndex((item) => item.id === id);
    if (domainIndex < 0) return;
    next.splice(domainIndex, 1);
    expandedDomainIds.value = expandedDomainIds.value.filter((item) => item !== id);
  } else {
    const nextDomain = next.find((item) => item.id === managerDomainId.value);
    if (nextDomain === undefined) return;
    if (level === "category") nextDomain.categories = nextDomain.categories.filter((item) => item.id !== id);
    else {
      const nextCategory = nextDomain.categories.find((item) => item.id === managerCategoryId.value);
      if (nextCategory === undefined) return;
      nextCategory.scenes = nextCategory.scenes.filter((item) => item.id !== id);
    }
  }
  catalog.value = next;
  selectedSceneIds.value = selectedSceneIds.value.filter((sceneId) => !sceneIds.includes(sceneId));
  if (sceneIds.includes(focusedSceneId.value)) focusedSceneId.value = selectedSceneIds.value[0] ?? fallbackSceneId();
  if (sceneIds.includes(importSceneId.value)) importSceneId.value = fallbackSceneId();
  if (activeCategoryId.value !== null && removedCategoryIds.includes(activeCategoryId.value)) activeCategoryId.value = null;

  const nextDomain = next.find((item) => item.id === managerDomainId.value) ?? next[0] ?? null;
  const nextCategory = nextDomain?.categories.find((item) => item.id === managerCategoryId.value) ?? nextDomain?.categories[0] ?? null;
  const nextScene = nextCategory?.scenes.find((item) => item.id === managerSceneId.value) ?? nextCategory?.scenes[0] ?? null;
  managerDomainId.value = nextDomain?.id ?? null;
  managerCategoryId.value = nextCategory?.id ?? null;
  managerSceneId.value = nextScene?.id ?? null;
  catalogDraft.value = null;
}

function startCatalogDrag(level: CatalogNodeLevel, parentId: string | null, id: string, event: DragEvent): void {
  if (!isCustomCatalogId(id)) return;
  catalogDrag.value = { level, parentId, id };
  if (event.dataTransfer !== null) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }
}

function reorderNodes<T extends { readonly id: string }>(values: T[], sourceId: string, targetId: string): T[] {
  const sourceIndex = values.findIndex((item) => item.id === sourceId);
  const targetIndex = values.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return values;
  const next = [...values];
  const [source] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source!);
  return next;
}

function dropCatalogNode(level: CatalogNodeLevel, parentId: string | null, targetId: string): void {
  const drag = catalogDrag.value;
  catalogDrag.value = null;
  if (drag === null || drag.level !== level || drag.parentId !== parentId || !isCustomCatalogId(targetId)) return;
  const next = cloneCatalog(catalog.value);
  if (level === "domain") next.splice(0, next.length, ...reorderNodes(next, drag.id, targetId));
  else {
    const domain = next.find((item) => item.id === managerDomainId.value);
    if (domain === undefined) return;
    if (level === "category") domain.categories = reorderNodes(domain.categories, drag.id, targetId);
    else {
      const category = domain.categories.find((item) => item.id === managerCategoryId.value);
      if (category === undefined) return;
      category.scenes = reorderNodes(category.scenes, drag.id, targetId);
    }
  }
  catalog.value = next;
}

function resetRuleForm(pool: PresetRulePool, rule: PresetRule | null = null): void {
  editingRuleId.value = rule?.id ?? null;
  rulePool.value = rule?.pool ?? pool;
  ruleLabel.value = rule?.label ?? "";
  ruleSuits.value = [...(rule?.suits ?? [])];
  rulePositions.value = [...(rule?.positions ?? [])];
  ruleMainStats.value = [...(rule?.mainStats ?? [])];
  const subStatRequirements: Partial<Record<StatId, SubStatRequirement>> = {};
  for (const filter of rule?.filter?.subStats ?? []) subStatRequirements[filter.stat] = filter.requirement;
  for (const stat of rule?.requiredSubStats ?? []) {
    if (subStatRequirements[stat] === undefined) subStatRequirements[stat] = "include";
  }
  ruleSubStatRequirements.value = subStatRequirements;
  ruleSubStatCounts.value = [...(rule?.subStatCounts ?? [])];
  ruleLevelRanges.value = [...(rule?.filter?.levelRanges ?? [])];
  ruleIntrinsicStats.value = [...(rule?.filter?.intrinsicStats ?? [])];
  rulePreservedFilter.value = rule?.filter ?? null;
  ruleCriteria.value = structuredClone(rule?.filter ? JSON.parse(JSON.stringify(rule.filter)) : { ...emptyYuhunFilter(), types: [...ruleSuits.value], positions: [...rulePositions.value], mainStats: [...ruleMainStats.value], subStats: ruleSubStatFilters.value.map(entry => ({ ...entry })), subStatCounts: [...ruleSubStatCounts.value] });
  ruleSource.value = rule?.source;
  ruleYuhunPickerOpen.value = false;
  ruleYuhunSearch.value = "";
  ruleYuhunCategory.value = "全部";
  ruleOpen.value = true;
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}

function openRuleYuhunPicker(): void {
  ruleYuhunSearch.value = "";
  ruleYuhunCategory.value = "全部";
  ruleYuhunPickerOpen.value = true;
}

function toggleRuleYuhun(name: string): void {
  ruleSuits.value = toggleValue(ruleSuits.value, name);
}

function ruleSubStatRequirement(stat: StatId): SubStatRequirement | null {
  return ruleSubStatRequirements.value[stat] ?? null;
}

function setRuleSubStatRequirement(stat: StatId, requirement: SubStatRequirement): void {
  const next = { ...ruleSubStatRequirements.value };
  if (next[stat] === requirement) delete next[stat];
  else next[stat] = requirement;
  ruleSubStatRequirements.value = next;
}

function ruleYuhunOption(name: string) {
  return ruleYuhunByName.get(name) ?? {
    name,
    label: name,
    category: "其他" as const,
    image: null,
    placeholder: name.slice(0, 1)
  };
}

watch(hasSelectedBossRuleSuit, (hasBossSuit) => {
  if (!hasBossSuit) ruleIntrinsicStats.value = [];
});

function formFilterCriteria(): FilterCriteria {
  return JSON.parse(JSON.stringify(ruleCriteria.value)) as FilterCriteria;
}

function saveRule(): void {
  try {
    const filter = formFilterCriteria();
    store.savePresetRule({
      pool: rulePool.value,
      label: ruleLabel.value,
      suits: filter.types,
      positions: filter.positions,
      mainStats: filter.mainStats,
      requiredSubStats: filter.subStats.filter(entry => entry.requirement === "include").map(entry => entry.stat),
      subStatCounts: filter.subStatCounts,
      ...(filter === undefined ? {} : { filter }),
      ...(ruleSource.value === undefined ? {} : { source: ruleSource.value })
    }, editingRuleId.value);
    ruleOpen.value = false;
    ruleCodeImportOpen.value = false;
  } catch (reason) {
    store.error = { stage: "policy", code: "INVALID_PRESET_RULE", path: null, message: reason instanceof Error ? reason.message : "预置规则无效" };
  }
}

function openRuleCodeImporter(pool: PresetRulePool = "discard"): void {
  resetRuleForm(pool);
  ruleOpen.value = false;
  ruleEntryMode.value = "code";
  ruleCodeImportValue.value = "";
  ruleImportMessage.value = "";
  ruleImportFailed.value = false;
  ruleCodeImportOpen.value = true;
}

async function recognizeRuleCode(source: "image" | "clipboard", image?: Blob): Promise<void> {
  if (ruleImportBusy.value !== null) return;
  const sequence = ++ruleImportSequence;
  ruleImportBusy.value = source;
  ruleImportMessage.value = "正在读取并识别御魂码…";
  ruleImportFailed.value = false;
  try {
    const code = image ? await decodeYuhunCodeFromQrImage(image) : (await readYuhunCodeFromClipboard()).code;
    if (sequence !== ruleImportSequence || !ruleCodeImportOpen.value) return;
    ruleCodeImportValue.value = code;
    ruleImportMessage.value = "识别成功，已填入御魂码。点击“解码并导入”保存规则。";
  } catch (reason) {
    if (sequence !== ruleImportSequence || !ruleCodeImportOpen.value) return;
    ruleImportFailed.value = true;
    ruleImportMessage.value = reason instanceof Error ? reason.message : "御魂码识别失败";
  } finally {
    if (sequence === ruleImportSequence) ruleImportBusy.value = null;
  }
}

async function readRuleQrImage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) await recognizeRuleCode("image", file);
}

async function handleRuleCodePaste(event: ClipboardEvent): Promise<void> {
  if (ruleEntryMode.value !== "code" || !event.clipboardData) return;
  const image = Array.from(event.clipboardData.items)
    .find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
  if (!image) return;
  event.preventDefault();
  await recognizeRuleCode("clipboard", image);
}

async function importRuleCode(): Promise<void> {
  if (ruleImportBusy.value !== null || store.busy) return;
  ruleImportBusy.value = "decode";
  ruleImportFailed.value = false;
  ruleImportMessage.value = "正在解码御魂筛选条件…";
  const importedCount = await store.importYuhunFilterCode(ruleCodeImportValue.value);
  ruleImportBusy.value = null;
  if (importedCount > 0) ruleCodeImportOpen.value = false;
  else {
    ruleImportFailed.value = true;
    ruleImportMessage.value = store.error?.message ?? "御魂码解码失败，请检查后重试";
  }
}

function ruleSummary(rule: PresetRule): string {
  const parts = [
    rule.positions.length === 0 ? "全部位置" : `${rule.positions.join("/")} 号位`,
    rule.mainStats.length === 0 ? "主属性不限" : `主属性 ${rule.mainStats.map((stat) => STAT_LABELS[stat]).join("/")}`,
    rule.requiredSubStats.length === 0 ? "副属性不限" : `副属性含 ${rule.requiredSubStats.map((stat) => STAT_LABELS[stat]).join("+")}`,
    rule.subStatCounts.length === 0 ? "条数不限" : `条数 ${rule.subStatCounts.map((count) => count === "lessThan2" ? "不足2" : count).join("/")}`
  ];
  if (rule.filter !== undefined) {
    if (rule.filter.stars.length > 0) parts.push(`${rule.filter.stars.join("/")}星`);
    const excluded = rule.filter.subStats.filter((filter) => filter.requirement === "exclude");
    if (excluded.length > 0) parts.push(`排除 ${excluded.map((filter) => STAT_LABELS[filter.stat]).join("/")}`);
    if (rule.filter.levelRanges.length > 0) parts.push(`等级 ${rule.filter.levelRanges.join("/")}`);
    if (rule.filter.intrinsicStats.length > 0) parts.push(`固有 ${rule.filter.intrinsicStats.map((stat) => STAT_LABELS[stat]).join("/")}`);
    if (rule.filter.unknownTypeBits.length > 0 || rule.filter.unknownOptionBits.length > 0) parts.push("含未知字段");
  }
  return parts.join(" · ");
}
</script>

<template>
  <section class="page-heading">
    <div><span class="eyebrow">02 / TARGETS</span><h1>目标阵容与预置方案</h1></div>
    <span class="tag" :class="store.teamCalculations.length > 0 ? 'success-tag' : 'neutral'"><Calculator :size="14" />{{ store.teamCalculations.length > 0 ? '已生成库存计算结果' : '等待库存计算' }}</span>
  </section>

  <div class="target-summary">
    <div data-testid="selected-scene-summary"><span>已选场景</span><strong>{{ selectedSceneSummaryValue }}</strong></div>
    <div data-testid="imported-team-summary"><span>已导入阵容</span><strong>{{ importedTeamSummaryValue }}</strong></div>
    <div data-testid="team-metric-summary"><span>式神指标</span><strong>{{ teamMetricSummaryValue }}</strong></div>
    <div><span>预置方案</span><strong>{{ store.enabledPresetRules.length }}</strong></div>
  </div>

  <section class="target-library">
    <div class="section-toolbar team-library-toolbar">
      <div class="team-library-heading"><h2>阵容目标库</h2><span>{{ selectedSceneIds.length }} 个场景 · {{ enabledTeamTargetDisplayCount }} 条阵容已启用</span></div>
      <div v-if="isTeamCalculationBusy && activeTeamProgress" class="team-library-progress team-calculation-progress" aria-live="polite">
        <div class="team-library-progress-copy">
          <Transition name="team-progress-slide">
            <div :key="`${activeTeamProgress.targetId ?? ''}:${activeTeamProgress.current}`" class="team-progress-carousel-item">
              <small>计算进度 · {{ activeTeamProgress.completed }} / {{ activeTeamProgress.total }}</small>
              <strong>正在计算 {{ activeTeamProgressLabel }}</strong>
            </div>
          </Transition>
        </div>
        <div class="team-calculation-progress-bar" role="progressbar" :aria-valuenow="teamProgressPercent" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: `${teamProgressPercent}%` }"></i></div>
        <span class="team-calculation-progress-percent">{{ teamProgressPercent }}%</span>
      </div>
      <div v-else class="team-library-progress team-library-progress-idle"><span>计算进度</span><small>{{ store.teamCalculationPaused ? '已暂停，结果已保存' : (hasTeamCalculationRun ? '本次计算已完成' : '尚未启动') }}</small></div>
      <div class="team-calculation-toolbar-actions">
        <button v-if="store.busy === '正在计算阵容御魂搭配'" class="secondary" data-testid="pause-team-targets" @click="store.pauseTeamCalculation"><Pause :size="15" />暂停计算</button>
        <button v-else-if="store.teamCalculationPaused" class="primary" data-testid="resume-team-targets" :disabled="!store.snapshot" @click="store.resumeTeamCalculation"><Play :size="15" />继续计算</button>
        <button v-else class="primary" data-testid="calculate-team-targets" :disabled="!!store.busy || (teamSelectionMode !== 'smart' && selectedEnabledTeamTargetCount === 0) || (teamSelectionMode === 'smart' && store.teamTargets.length === 0) || !store.snapshot" @click="calculateVisibleTeamTargets"><Calculator :size="16" />计算已启动阵容</button>
        <button class="secondary" data-testid="reset-team-targets" :disabled="store.teamCalculations.length === 0 && Object.keys(store.teamCalculationProgress).length === 0 && !store.teamCalculationPaused" @click="store.resetTeamCalculations"><RotateCcw :size="15" />重置计算</button>
      </div>
    </div>

    <div class="target-browser">
      <aside class="target-filter-pane">
        <div class="target-filter-actions" role="group" aria-label="关卡目录操作">
          <button data-testid="select-all-scenes" :disabled="allScenesSelected" @click="selectAllScenes"><Check :size="15" />全选</button>
          <button data-testid="clear-all-scenes" :disabled="selectedSceneIds.length === 0" @click="clearAllScenes"><X :size="15" />清除</button>
          <button title="导入阵容码" @click="openImporter()"><Import :size="15" />导入</button>
          <button data-testid="edit-scene-catalog" @click="openCatalogManager()"><Edit3 :size="15" />自定义</button>
        </div>
        <nav class="target-tree" aria-label="阵容场景分类" @scroll.passive="activeCategoryId = null">
          <div v-for="domain in catalog" :key="domain.id" class="tree-domain">
            <div class="tree-row domain-row">
              <button class="tree-select" :class="selectionState(sceneIdsForDomain(domain.id))" :title="`${domain.label}全选`" :aria-label="`${domain.label}全选`" @click="toggleSceneSelection(sceneIdsForDomain(domain.id))"><Check v-if="selectionState(sceneIdsForDomain(domain.id)) === 'all'" :size="14" /><Minus v-else-if="selectionState(sceneIdsForDomain(domain.id)) === 'some'" :size="14" /></button>
              <button class="tree-label" @click="toggleDomain(domain.id)"><span>{{ domain.label }}</span><small :title="`${domain.label}下的实际阵容数`">{{ targetCountForSceneIds(sceneIdsForDomain(domain.id)) }}</small></button>
              <button class="tree-expand" :title="expandedDomainIds.includes(domain.id) ? '收起' : '展开'" @click="toggleDomain(domain.id)"><ChevronDown v-if="expandedDomainIds.includes(domain.id)" :size="16" /><ChevronRight v-else :size="16" /></button>
            </div>
            <div v-if="expandedDomainIds.includes(domain.id)" class="tree-children">
              <div v-for="category in domain.categories" :key="category.id" class="tree-category">
                <div class="tree-row category-row" :class="{ active: activeCategoryId === category.id }">
                  <button class="tree-select" :class="selectionState(sceneIdsForCategory(category))" :title="`${category.label}全选`" :aria-label="`${category.label}全选`" @click="toggleSceneSelection(sceneIdsForCategory(category))"><Check v-if="selectionState(sceneIdsForCategory(category)) === 'all'" :size="14" /><Minus v-else-if="selectionState(sceneIdsForCategory(category)) === 'some'" :size="14" /></button>
                  <button class="tree-label" @click="toggleCategory(category.id, $event)"><span>{{ category.label }}</span><small :title="`${category.label}下的实际阵容数`">{{ targetCountForSceneIds(sceneIdsForCategory(category)) }}</small></button>
                  <button class="tree-expand" :title="activeCategoryId === category.id ? '关闭具体场景' : '展开具体场景'" @click="toggleCategory(category.id, $event)"><ChevronRight :size="16" /></button>
                </div>
                <section v-if="activeCategoryId === category.id" class="scene-popover" :style="scenePopoverStyle" :aria-label="`${category.label}具体场景`">
                  <header><strong>{{ category.label }}</strong><button @click="clearCategory(category)">清除</button><button class="icon-button" title="关闭" @click="activeCategoryId = null"><X :size="15" /></button></header>
                  <div v-for="scene in category.scenes" :key="scene.id" class="scene-option" :data-scene-id="scene.id">
                    <label><input type="checkbox" :checked="selectedSceneIds.includes(scene.id)" @change="toggleSingleScene(scene.id)" /><span>{{ scene.label }}</span></label>
                    <small :title="`${scene.label}下的实际阵容数`">{{ targetsForScene(scene.id).length }}</small>
                    <button class="icon-button" title="打开分类管理器" @click="openCatalogManager(scene.id)"><Edit3 :size="13" /></button>
                  </div>
                </section>
              </div>
            </div>
          </div>
        </nav>
      </aside>

      <main class="target-results">
        <div class="team-target-toolbar">
          <div class="team-target-actions" role="group" aria-label="当前筛选阵容操作">
            <button data-testid="select-all-visible-targets" :disabled="teamCalculationLocked || teamSelectionMode === 'smart' || visibleTeamTargets.length === 0 || allVisibleTeamTargetsEnabled" @click="setVisibleTeamTargetsEnabled(true)"><Check :size="15" />全选</button>
            <button data-testid="clear-all-visible-targets" :disabled="teamCalculationLocked || teamSelectionMode === 'smart' || visibleEnabledTeamTargetCount === 0" @click="setVisibleTeamTargetsEnabled(false)"><X :size="15" />清除</button>
            <button data-testid="toggle-smart-target-selection" :disabled="teamCalculationLocked" :class="{ active: teamSelectionMode === 'smart' }" :aria-pressed="teamSelectionMode === 'smart'" @click="toggleSmartTeamSelection"><Sparkles :size="15" />智能</button>
            <label v-if="teamSelectionMode === 'smart'" class="smart-target-setting"><select v-model="smartDifficultyDecreaseCount" :disabled="teamCalculationLocked" data-testid="smart-difficulty-decrease-count" aria-label="难度递减次数"><option value="auto">自动</option><option v-for="count in 10" :key="count" :value="count">{{ count }} 次</option></select></label>
            <div v-if="teamSelectionMode === 'smart'" class="smart-target-help">
              <button class="smart-target-help-trigger" title="查看智能选择说明" aria-label="查看智能选择说明" aria-controls="smart-target-help-popover" :aria-expanded="smartHelpOpen" @click="smartHelpOpen = !smartHelpOpen"><CircleHelp :size="16" /></button>
              <section v-if="smartHelpOpen" id="smart-target-help-popover" class="smart-target-help-popover" role="note">
                <strong>智能选择</strong>
                <p>强制计算阵容会优先执行；其余阵容从难度最高开始。当前阵容不满足时，按所选次数在该场景内逐级降低难度。</p>
                <p>部分阵容码包含目标评分；任意一个式神的计算结果低于目标评分时，当前阵容视为不满足，并触发难度递减。</p>
                <p>选择“自动”时持续尝试，直到计算出结果或全部阵容均已尝试。</p>
              </section>
            </div>
          </div>
          <div class="team-calculation-filter" role="group" aria-label="阵容计算状态筛选">
            <span>显示阵容</span>
            <button data-testid="team-filter-all" :class="{ active: teamCalculationFilter === 'all' }" @click="teamCalculationFilter = 'all'">全部</button>
            <button data-testid="team-filter-enabled" :class="{ active: teamCalculationFilter === 'enabled' }" @click="teamCalculationFilter = 'enabled'">已启用</button>
            <button data-testid="team-filter-disabled" :class="{ active: teamCalculationFilter === 'disabled' }" @click="teamCalculationFilter = 'disabled'">未启用</button>
            <button data-testid="team-filter-completed" :class="{ active: teamCalculationFilter === 'completed' }" @click="teamCalculationFilter = 'completed'">计算完成</button>
            <button data-testid="team-filter-running" :class="{ active: teamCalculationFilter === 'running' }" @click="teamCalculationFilter = 'running'">计算中</button>
            <button data-testid="team-filter-pending" :class="{ active: teamCalculationFilter === 'pending' }" @click="teamCalculationFilter = 'pending'">待计算</button>
            <button data-testid="team-filter-error" :class="{ active: teamCalculationFilter === 'error' }" @click="teamCalculationFilter = 'error'">错误</button>
          </div>
          <span class="visible-target-count">当前筛选 {{ visibleTeamTargets.filter((target) => targetDisplayStatus(target) === '已启用').length }} / {{ visibleTeamTargets.length }} 已启用</span>
        </div>
        <div class="target-results-scroll" aria-live="polite">
          <div v-if="resultScenes.length === 0" class="target-group-empty"><FolderTree :size="27" /><div><strong>当前筛选下暂无阵容</strong><span>可从左侧导入阵容或调整筛选条件</span></div></div>
          <div v-else class="scene-detail-list">
          <section v-for="scene in resultScenes" :key="scene.sceneId" class="scene-detail">
            <header class="scene-detail-head"><div><span>{{ scene.domainLabel }} / {{ scene.categoryLabel }}</span><h2>{{ scene.sceneLabel }}</h2></div><div><label class="scene-mutual-exclusion-toggle"><input type="checkbox" :checked="scene.mutualExclusion" @change="setSceneMutualExclusion(scene.sceneId, ($event.target as HTMLInputElement).checked)" /><span>阵容互斥</span></label><span>{{ enabledTargetsForScene(scene.sceneId) }} / {{ targetsForScene(scene.sceneId).length }} 已启用</span></div></header>
            <div class="team-target-list">
              <article v-for="target in filteredTargetsForScene(scene.sceneId)" :key="target.id" class="team-target-row" :class="{ disabled: targetDisplayStatus(target) === '未启用' }">
                <label class="target-check" :title="teamCalculationLocked ? '计算期间不可修改' : (target.enabled ? '从目标集中停用' : '加入目标集')"><input data-testid="team-target-toggle" type="checkbox" :disabled="teamCalculationLocked || teamSelectionMode === 'smart'" :checked="smartVisibleEnabled(target)" @change="store.setTeamTargetEnabled(target.id, ($event.target as HTMLInputElement).checked)" /></label>
                <div class="team-target-scene"><small>关卡</small><strong>{{ target.sceneLabel }}</strong><span v-if="targetScoreStatus(target)" class="target-score-status" :class="targetScoreStatus(target) === '达标' ? 'met' : 'unmet'">{{ targetScoreStatus(target) }}</span></div>
                <div class="team-target-main"><h3>{{ target.label }}</h3><span><template v-if="target.forceCalculate">强制计算</template><template v-else>难度 {{ target.difficulty }}</template> · {{ target.metricCount }} 个式神指标 · {{ target.source === 'manual' ? '手动搭配' : `${target.inspection?.occupiedSlots ?? 6} 个占用槽位` }}<template v-if="target.locked || target.builtIn"> · 已锁定</template></span></div>
                <div class="team-target-assets" :aria-label="`${target.label}式神与御魂预览`">
                  <div class="team-asset-row shikigami-assets">
                    <template v-if="editableTargetsFor(target).length > 0">
                      <span v-for="entity in editableTargetsFor(target).slice(0, 6)" :key="entity.entityIndex" class="team-asset-slot" :class="{ 'calculation-disabled': entity.yuhunConfigEnabled === false }" :title="`槽位 ${entity.entityIndex} · ${previewShikigamiName(entity)}${entity.yuhunConfigEnabled === false ? ' · 无需配置御魂' : ''}`">
                        <img v-if="shikigamiImage(entity.shikigamiId)" :src="shikigamiImage(entity.shikigamiId)!" :alt="previewShikigamiName(entity)" />
                        <span v-else class="asset-preview-fallback">{{ previewShikigamiName(entity).slice(0, 1) }}</span>
                      </span>
                    </template>
                    <small v-else>正在读取式神配置…</small>
                  </div>
                  <div class="team-asset-row yuhun-assets">
                    <template v-if="editableTargetsFor(target).length > 0">
                      <span v-for="entity in editableTargetsFor(target).slice(0, 6)" :key="entity.entityIndex" class="team-yuhun-slot" :class="{ 'calculation-disabled': entity.yuhunConfigEnabled === false }" :title="entity.yuhunConfigEnabled === false ? '无需配置御魂' : entity.suits.join(' + ') || '散件'">
                        <span v-if="entity.yuhunConfigEnabled === false" class="asset-preview-empty">无</span>
                        <template v-else-if="entity.suits.length > 0">
                          <template v-for="suit in entity.suits.slice(0, 3)" :key="suit"><img v-if="yuhunImage(suit)" :src="yuhunImage(suit)!" :alt="suit" /><span v-else class="asset-preview-empty">{{ yuhunPlaceholder(suit) }}</span></template>
                        </template>
                        <span v-else class="asset-preview-empty">散</span>
                      </span>
                    </template>
                  </div>
                </div>
                <div class="team-target-status">
                  <span class="tag" :class="targetDisplayStatus(target) === '已启用' || targetDisplayStatus(target) === '计算完成' ? 'success-tag' : targetDisplayStatus(target) === '错误' ? 'warning-tag' : 'neutral'">{{ targetDisplayStatus(target) }}</span>
                  <button v-if="targetDisplayStatus(target) === '错误'" class="icon-button" title="复制错误原因" aria-label="复制错误原因" data-testid="copy-team-calculation-error" @click="copyTeamCalculationError(target)"><Clipboard :size="14" /></button>
                </div>
                <div class="team-target-row-actions">
                  <button class="icon-button" title="查看阵容" data-testid="view-team-target" @click="openTargetDetail(target)"><Eye :size="16" /></button>
                  <button v-if="!(target.locked || target.builtIn)" class="icon-button danger" title="删除阵容" data-testid="delete-team-target-row" @click="requestTeamTargetDelete(target)"><Trash2 :size="16" /></button>
                  <span v-else class="target-row-lock" title="发布阵容只读" role="img" aria-label="发布阵容只读"><Lock :size="15" /></span>
                </div>
                <template v-for="report in [store.teamCalculationFor(target.id)]" :key="target.id">
                  <section v-if="report" class="team-calculation-results" aria-label="御魂计算结果">
                    <div class="team-calculation-details">
                      <button class="team-calculation-summary" type="button" data-testid="open-team-calculation-detail" @click="openCalculationDetail(target, report.entities)">
                        <span class="team-calculation-summary-roster">
                          <span v-for="entity in report.entities" :key="entity.entityIndex" class="team-calculation-member-summary">
                            <span class="team-calculation-member-avatar"><img v-if="shikigamiImage(entity.shikigamiId ?? 0)" :src="shikigamiImage(entity.shikigamiId ?? 0)!" :alt="calculationEntityName(entity, target)" /><span v-else>{{ calculationEntityName(entity, target).slice(0, 1) }}</span></span>
                            <span class="team-calculation-member-summary-copy">
                              <strong>{{ entity.status === 'success' ? calculationSuitSummary(entity) : calculationStatusLabel(entity) }}</strong>
                              <small>{{ calculationEntityName(entity, target) }}</small>
                              <span>{{ entity.status === 'success' ? `${entity.metricName} ${calculationScore(entity)}` : entity.message }}</span>
                              <em v-if="entityTargetScoreLabel(entity)" :class="entityMeetsTargetScore(entity) ? 'target-score-met' : 'target-score-unmet'">{{ entityTargetScoreLabel(entity) }}</em>
                            </span>
                          </span>
                        </span>
                        <span class="team-calculation-summary-action">查看队伍详情 <ChevronRight :size="15" /></span>
                      </button>
                    </div>
                  </section>
                </template>
              </article>
            </div>
          </section>
          </div>
        </div>
      </main>
    </div>
  </section>

  <section class="preset-retention-section">
    <div class="section-toolbar unframed"><div><h2>预置方案</h2><span>{{ store.presetRules.length }} 条规则 · 新增后默认启用</span></div><div class="section-toolbar-actions"><button data-testid="import-yuhun-code" @click="openRuleCodeImporter()"><Import :size="15" />导入规则</button><span v-if="store.enabledPresetRules.length > 0" class="tag success-tag">已接入单件决策</span></div></div>
    <div class="preset-pools">
      <section class="preset-pool discard-pool" data-rule-pool="discard">
        <header class="preset-pool-header"><div><span>DISCARD</span><h3>弃置规则池</h3><p>匹配的御魂进入弃置候选</p></div><div class="preset-pool-controls"><small>{{ discardPresetRules.filter((rule) => rule.enabled).length }} / {{ discardPresetRules.length }} 已启用</small><div class="preset-pool-actions"><button data-testid="enable-all-discard-rules" :disabled="discardPresetRules.length === 0 || discardPresetRules.every((rule) => rule.enabled)" @click="store.setPresetRulePoolEnabled('discard', true)"><Check :size="14" />全部启用</button><button data-testid="disable-all-discard-rules" :disabled="discardPresetRules.length === 0 || discardPresetRules.every((rule) => !rule.enabled)" @click="store.setPresetRulePoolEnabled('discard', false)"><X :size="14" />全部关闭</button><button class="pool-add" data-testid="add-discard-rule" @click="openRuleCodeImporter('discard')"><Plus :size="16" />添加规则</button></div></div></header>
        <div v-if="discardPresetRules.length === 0" class="preset-empty"><strong>暂无弃置规则</strong><span>添加需要优先进入弃置候选的筛选条件。</span></div>
        <div v-else class="preset-rule-list">
          <article v-for="rule in discardPresetRules" :key="rule.id" class="preset-rule-row" :class="{ disabled: !rule.enabled }">
            <label class="switch"><input type="checkbox" :checked="rule.enabled" @change="store.setPresetRuleEnabled(rule.id, ($event.target as HTMLInputElement).checked)" /><span></span></label>
            <div class="preset-rule-main"><h3>{{ rule.label }}</h3><div class="suit-tags"><span v-if="rule.suits.length === 0">全部套装</span><span v-for="suit in rule.suits" :key="suit">{{ suit }}</span></div><small>{{ ruleSummary(rule) }}</small></div>
            <span class="tag" :class="rule.enabled ? 'danger-tag' : 'neutral'">{{ rule.enabled ? '已启用' : '已停用' }}</span>
            <button class="icon-button" title="编辑弃置规则" @click="resetRuleForm(rule.pool, rule)"><Edit3 :size="16" /></button>
            <button class="icon-button danger" title="删除弃置规则" @click="store.removePresetRule(rule.id)"><Trash2 :size="16" /></button>
          </article>
        </div>
      </section>
      <section class="preset-pool enhance-pool" data-rule-pool="enhance">
        <header class="preset-pool-header"><div><span>ENHANCE</span><h3>强化规则池</h3><p>匹配的御魂进入强化候选</p></div><div class="preset-pool-controls"><small>{{ enhancePresetRules.filter((rule) => rule.enabled).length }} / {{ enhancePresetRules.length }} 已启用</small><div class="preset-pool-actions"><button data-testid="enable-all-enhance-rules" :disabled="enhancePresetRules.length === 0 || enhancePresetRules.every((rule) => rule.enabled)" @click="store.setPresetRulePoolEnabled('enhance', true)"><Check :size="14" />全部启用</button><button data-testid="disable-all-enhance-rules" :disabled="enhancePresetRules.length === 0 || enhancePresetRules.every((rule) => !rule.enabled)" @click="store.setPresetRulePoolEnabled('enhance', false)"><X :size="14" />全部关闭</button><button class="pool-add" data-testid="add-enhance-rule" @click="openRuleCodeImporter('enhance')"><Plus :size="16" />添加规则</button></div></div></header>
        <div v-if="enhancePresetRules.length === 0" class="preset-empty"><strong>暂无强化规则</strong><span>添加值得保留并优先强化的筛选条件。</span></div>
        <div v-else class="preset-rule-list">
          <article v-for="rule in enhancePresetRules" :key="rule.id" class="preset-rule-row" :class="{ disabled: !rule.enabled }">
            <label class="switch"><input type="checkbox" :checked="rule.enabled" @change="store.setPresetRuleEnabled(rule.id, ($event.target as HTMLInputElement).checked)" /><span></span></label>
            <div class="preset-rule-main"><h3>{{ rule.label }}</h3><div class="suit-tags"><span v-if="rule.suits.length === 0">全部套装</span><span v-for="suit in rule.suits" :key="suit">{{ suit }}</span></div><small>{{ ruleSummary(rule) }}</small></div>
            <span class="tag" :class="rule.enabled ? 'success-tag' : 'neutral'">{{ rule.enabled ? '已启用' : '已停用' }}</span>
            <button class="icon-button" title="编辑强化规则" @click="resetRuleForm(rule.pool, rule)"><Edit3 :size="16" /></button>
            <button class="icon-button danger" title="删除强化规则" @click="store.removePresetRule(rule.id)"><Trash2 :size="16" /></button>
          </article>
        </div>
      </section>
    </div>
  </section>

  <div v-if="importOpen" class="modal-backdrop" @click.self="importOpen = false" @keydown.esc="importOpen = false">
    <section class="import-dialog team-target-dialog" :class="{ 'manual-mode': importMode === 'manual' }" role="dialog" aria-modal="true" aria-labelledby="import-team-title">
      <header><div><span class="eyebrow">TEAM TARGET</span><h2 id="import-team-title">导入阵容目标</h2></div><button class="icon-button" title="关闭" @click="importOpen = false"><X :size="18" /></button></header>
      <div class="target-entry-tabs" role="tablist" aria-label="阵容目标添加方式"><button role="tab" :aria-selected="importMode === 'code'" :class="{ active: importMode === 'code' }" @click="setImportMode('code')"><Import :size="16" />阵容码导入</button><button data-testid="manual-target-tab" role="tab" :aria-selected="importMode === 'manual'" :class="{ active: importMode === 'manual' }" @click="setImportMode('manual')"><Calculator :size="16" />手动搭配</button></div>
      <div class="target-entry-meta">
        <fieldset class="scene-cascade" :disabled="catalogLoading">
          <legend>归属场景</legend>
          <label><span>一级玩法</span><select v-model="importDomainId" data-testid="import-scene-domain" @change="markImportSceneSelected"><option disabled value="">请选择</option><option v-for="domain in catalog" :key="domain.id" :value="domain.id">{{ domain.label }}</option></select></label>
          <label><span>二级分类</span><select v-model="importCategoryId" data-testid="import-scene-category" :disabled="importDomainId === ''" @change="markImportSceneSelected"><option disabled value="">请选择</option><option v-for="category in importCategories" :key="category.id" :value="category.id">{{ category.label }}</option></select></label>
          <div class="scene-field"><span>具体关卡</span><div class="scene-select-with-id"><select v-model="importSceneId" data-testid="import-scene" aria-label="具体关卡" :disabled="importCategoryId === ''" @change="markImportSceneSelected"><option disabled value="">请选择</option><option v-for="scene in importScenes" :key="scene.id" :value="scene.id">{{ sceneShortLabel(scene.label, importCategories.find((category) => category.id === importCategoryId)?.label ?? '') }}</option></select><label class="scene-game-id-field"><span>关卡 ID</span><input v-if="importMode === 'code'" data-testid="import-scene-game-id" :value="formatGameSceneId(importScenePath?.gameSceneId)" readonly title="由所选具体关卡决定" /><input v-else v-model="manualSceneGameId" data-testid="manual-scene-game-id" inputmode="numeric" maxlength="16" placeholder="未设置" title="保存阵容时写入所选具体关卡" /></label></div></div>
        </fieldset>
        <label class="target-name-field"><span>阵容名称</span><input v-model="importLabel" data-testid="import-team-name" maxlength="80" :placeholder="importMode === 'code' ? '优先读取阵容码内名称，留空时按场景命名' : '例如：悲鸣 · 天照 18 秒'" @input="markImportLabelEdited" /></label>
        <div class="target-difficulty-control">
          <label><span>计算方式</span><select data-testid="import-team-calculation-mode" :value="importForceCalculate ? 'force' : 'difficulty'" @change="setImportForceCalculate(($event.target as HTMLSelectElement).value === 'force')"><option value="difficulty">难度递补</option><option value="force">强制计算</option></select></label>
          <label class="target-difficulty-field"><span>难度</span><input v-model.number="importDifficulty" data-testid="import-team-difficulty" type="number" min="1" max="100" step="1" inputmode="numeric" placeholder="1-100" title="1 最容易，100 最困难；名称中的 xxS 会自动换算" :disabled="importForceCalculate" @input="markImportDifficultyEdited" /></label>
        </div>
      </div>
      <div v-if="importMode === 'code'" class="target-code-entry">
        <label class="import-code-field"><span>#TA# 阵容码</span><textarea v-model="importCode" rows="6" spellcheck="false" placeholder="粘贴 #TA#…，或从下方识别二维码" @change="autoCompleteImportScene()"></textarea></label>
        <section class="team-code-qr-panel" aria-labelledby="team-code-qr-title">
          <div><ScanQrCode :size="19" /><span><strong id="team-code-qr-title">从剪贴板或二维码图片导入</strong><small>文字和图片只在当前浏览器中读取，不会上传。</small></span></div>
          <div class="team-code-qr-actions">
            <button type="button" data-testid="choose-team-code-qr" :disabled="qrBusy !== null" @click="chooseQrImage"><LoaderCircle v-if="qrBusy === 'image'" class="spin" :size="15" /><ImageUp v-else :size="15" />选择二维码图片</button>
            <button type="button" data-testid="read-team-code-clipboard" :disabled="qrBusy !== null" @click="readClipboardTeamCode"><LoaderCircle v-if="qrBusy === 'clipboard'" class="spin" :size="15" /><ClipboardPaste v-else :size="15" />读取剪贴板</button>
            <input ref="qrImageInput" type="file" accept="image/*" hidden @change="readQrImage" />
          </div>
          <p v-if="qrMessage" :class="{ success: !qrFailed }" aria-live="polite">{{ qrMessage }}</p>
        </section>
        <div class="target-entry-note"><strong>支持 Ctrl+V / Cmd+V 直接粘贴</strong><span>可以粘贴文字阵容码，也可以粘贴包含二维码的截图；识别后再点击“导入并启用”。</span></div>
        <div v-if="store.busy === '正在导入阵容目标'" class="target-import-feedback loading" role="status"><LoaderCircle class="spin" :size="16" /><span><strong>正在本地解析阵容码</strong><small>解析由浏览器 Worker 完成，不会产生 API 或 Network 请求。</small></span></div>
        <div v-else-if="importSceneNotice" class="target-import-feedback warning" role="status"><TriangleAlert :size="16" /><span><strong>未能自动匹配关卡</strong><small>{{ importSceneNotice }}</small></span></div>
        <div v-else-if="importSubmitError" class="target-import-feedback error" role="alert"><TriangleAlert :size="16" /><span><strong>导入失败</strong><small>{{ importSubmitError }}</small></span></div>
      </div>
      <ManualTargetEditor v-else @configured-change="manualConfiguredCount = $event" @drafts-change="manualDrafts = $event" />
      <footer v-if="importMode === 'code'"><span>阵容码仅保存在本机自动会话</span><button class="primary" :disabled="!importCode.trim().startsWith('#TA#') || (!importForceCalculate && !isValidDifficulty(importDifficulty)) || !!store.busy" @click="importTarget"><Import :size="17" />{{ store.busy ?? (awaitingSceneConfirmation ? '按此场景导入' : '导入并启用') }}</button></footer>
      <footer v-else><span>已添加 {{ manualDrafts.length }} / 6 个式神 · {{ manualConfiguredCount }} 个参与御魂计算</span><button class="primary" :disabled="manualConfiguredCount === 0 || importSceneId === '' || (!importForceCalculate && !isValidDifficulty(importDifficulty))" @click="saveManualTarget"><Save :size="17" />保存并启用</button></footer>
    </section>
  </div>

  <div
    v-if="pendingTeamSceneMismatch"
    class="catalog-delete-overlay team-scene-mismatch-overlay"
    @click.self="cancelTeamSceneMismatchImport"
    @keydown.esc.stop="cancelTeamSceneMismatchImport"
  >
    <section
      class="catalog-delete-dialog team-scene-mismatch-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="team-scene-mismatch-title"
      aria-describedby="team-scene-mismatch-description"
    >
      <header>
        <span><TriangleAlert :size="20" /></span>
        <div>
          <small>SCENE MISMATCH</small>
          <h2 id="team-scene-mismatch-title">阵容码与归属场景不一致</h2>
        </div>
      </header>
      <div class="catalog-delete-body">
        <p id="team-scene-mismatch-description">继续导入会采用你当前选择的归属场景，覆盖阵容码识别结果。</p>
        <dl class="team-scene-mismatch-paths">
          <div>
            <dt>阵容码场景</dt>
            <dd>{{ pendingTeamSceneMismatch.codeScenePaths.join('；') }}</dd>
          </div>
          <div>
            <dt>当前选择</dt>
            <dd>{{ pendingTeamSceneMismatch.selectedScenePath }}</dd>
          </div>
        </dl>
        <label class="team-delete-suppress">
          <input v-model="teamSceneMismatchDoNotAskToday" data-testid="team-scene-mismatch-do-not-ask" type="checkbox" />
          <span>今天不再提示</span>
        </label>
      </div>
      <footer>
        <button data-testid="cancel-team-scene-mismatch" @click="cancelTeamSceneMismatchImport">取消</button>
        <button class="warning-command" data-testid="confirm-team-scene-mismatch" @click="confirmTeamSceneMismatchImport"><Check :size="16" />确认</button>
      </footer>
    </section>
  </div>

  <div
    v-if="pendingTeamSceneIdAssignment"
    class="catalog-delete-overlay team-scene-mismatch-overlay"
    @click.self="cancelTeamSceneIdAssignment"
    @keydown.esc.stop="cancelTeamSceneIdAssignment"
  >
    <section
      class="catalog-delete-dialog team-scene-mismatch-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="team-scene-id-assignment-title"
      aria-describedby="team-scene-id-assignment-description"
    >
      <header>
        <span><TriangleAlert :size="20" /></span>
        <div>
          <small>SCENE ID ASSIGNMENT</small>
          <h2 id="team-scene-id-assignment-title">为具体关卡指定 ID？</h2>
        </div>
      </header>
      <div class="catalog-delete-body">
        <p id="team-scene-id-assignment-description">阵容码中的关卡 ID 尚未关联到具体关卡。指定后，后续导入会自动匹配该关卡。</p>
        <dl class="team-scene-mismatch-paths">
          <div>
            <dt>阵容码关卡 ID</dt>
            <dd>{{ pendingTeamSceneIdAssignment.gameSceneId }}</dd>
          </div>
          <div>
            <dt>指定给</dt>
            <dd>{{ pendingTeamSceneIdAssignment.importRequest.selectedScenePath }}</dd>
          </div>
        </dl>
      </div>
      <footer>
        <button data-testid="cancel-team-scene-id-assignment" @click="cancelTeamSceneIdAssignment">取消</button>
        <button data-testid="import-without-assigning-scene-id" @click="importWithoutAssigningSceneId">仅导入</button>
        <button class="warning-command" data-testid="assign-scene-id-and-import" @click="assignSceneIdAndImport"><Check :size="16" />指定并导入</button>
      </footer>
    </section>
  </div>

  <div v-if="targetDetail" class="modal-backdrop" @click.self="closeTargetDetail" @keydown.esc="closeTargetDetail">
    <section class="import-dialog team-target-dialog manual-mode team-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="team-detail-title">
      <header>
        <div><span class="eyebrow">TEAM TARGET</span><h2 id="team-detail-title">{{ targetDetailEditing ? '编辑阵容' : '查看阵容' }}</h2></div>
        <div class="team-detail-header-actions">
          <span v-if="targetDetailIsPublished" class="team-detail-lock" title="发布阵容只读；编辑时会创建本地副本"><Lock :size="14" />发布数据</span>
          <button v-if="!targetDetailEditing" data-testid="edit-team-target" :disabled="targetDetailLoading || targetDetailInitialTargets.length === 0" @click="beginTargetDetailEdit"><Pencil :size="15" />编辑</button>
          <button v-else data-testid="cancel-team-target-edit" @click="cancelTargetDetailEdit">取消编辑</button>
          <button class="icon-button" title="关闭" @click="closeTargetDetail"><X :size="18" /></button>
        </div>
      </header>
      <div class="team-detail-meta">
        <label><span>阵容名称</span><input v-model="targetDetailLabel" data-testid="team-detail-name" maxlength="80" :disabled="!targetDetailEditing" /></label>
        <div><span>归属关卡</span><strong>{{ targetDetail.sceneLabel }}</strong></div>
        <div class="target-detail-difficulty-control">
          <label><span>计算方式</span><select data-testid="team-detail-calculation-mode" :value="targetDetailForceCalculate ? 'force' : 'difficulty'" :disabled="!targetDetailEditing" @change="setTargetDetailForceCalculate(($event.target as HTMLSelectElement).value === 'force')"><option value="difficulty">难度递补</option><option value="force">强制计算</option></select></label>
          <label><span>难度</span><input v-model.number="targetDetailDifficulty" data-testid="team-detail-difficulty" type="number" min="1" max="100" step="1" inputmode="numeric" :disabled="!targetDetailEditing || targetDetailForceCalculate" /></label>
        </div>
      </div>
      <div v-if="targetDetailLoading" class="team-detail-loading"><LoaderCircle class="spin" :size="20" /><span>正在读取阵容配置…</span></div>
      <div v-else-if="targetDetailInitialTargets.length === 0" class="team-detail-loading error"><TriangleAlert :size="20" /><span>阵容配置暂时无法转换为可查看的手动搭配</span></div>
      <ManualTargetEditor
        v-else
        :key="targetDetailEditorKey"
        :initial-targets="targetDetailInitialTargets"
        :read-only="!targetDetailEditing"
        @configured-change="targetDetailConfiguredCount = $event"
        @drafts-change="targetDetailDrafts = $event"
      />
      <div v-if="targetDetailEditing && targetDetailIsPublished" class="team-detail-copy-notice"><Lock :size="15" /><span>这是发布的只读阵容。保存时会创建一份本地副本，原阵容不会改变。</span></div>
      <footer>
        <span v-if="targetDetailEditing">已添加 {{ targetDetailDrafts.length }} / 6 个式神 · {{ targetDetailConfiguredCount }} 个参与御魂计算</span>
        <span v-else>{{ targetDetailIsPublished ? '发布阵容已锁定，可查看、启用或复制编辑' : '当前为查看模式，点击右上角“编辑”后可修改' }}</span>
        <div class="team-detail-footer-actions">
          <button v-if="!targetDetailEditing && !targetDetailIsPublished" class="danger" data-testid="delete-team-target" @click="deleteTargetDetail"><Trash2 :size="16" />删除</button>
          <button v-if="targetDetailEditing" class="primary" data-testid="save-team-target" :disabled="targetDetailConfiguredCount === 0 || targetDetailLabel.trim() === '' || (!targetDetailForceCalculate && !isValidDifficulty(targetDetailDifficulty))" @click="saveTargetDetail"><Save :size="17" />{{ targetDetailIsPublished ? '保存为本地副本' : '保存修改' }}</button>
          <button v-else @click="closeTargetDetail">关闭</button>
        </div>
      </footer>
    </section>
  </div>

  <div v-if="calculationDetailTarget && calculationDetailReport" class="modal-backdrop calculation-detail-backdrop" @click.self="closeCalculationDetail" @keydown.esc="closeCalculationDetail">
    <section class="calculation-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="calculation-detail-title">
      <header><div><span>YUHUN LOADOUT</span><h2 id="calculation-detail-title">{{ calculationDetailTarget.label }}</h2></div><button class="icon-button" title="关闭队伍详情" @click="closeCalculationDetail"><X :size="18" /></button></header>
      <nav class="calculation-detail-roster" aria-label="选择式神">
        <button v-for="entity in calculationDetailReport.entities" :key="entity.entityIndex" :class="{ active: entity.entityIndex === calculationDetailEntity?.entityIndex }" @click="selectCalculationEntity(entity)">
          <span><img v-if="shikigamiImage(entity.shikigamiId ?? 0)" :src="shikigamiImage(entity.shikigamiId ?? 0)!" :alt="calculationEntityName(entity, calculationDetailTarget)" /><i v-else>{{ calculationEntityName(entity, calculationDetailTarget).slice(0, 1) }}</i></span>
          <strong>{{ calculationEntityName(entity, calculationDetailTarget) }}</strong><small>{{ calculationStatusLabel(entity) }}</small>
        </button>
      </nav>
      <div v-if="calculationDetailEntity" class="calculation-detail-content">
        <section class="yuhun-wheel-panel">
          <div class="yuhun-wheel">
            <button v-for="position in 6" :key="position" class="yuhun-wheel-slot" :class="[`position-${position}`, { active: calculationDetailPosition === position && calculationDetailCandidateId === null }]" :disabled="!calculationDetailEntity.pieces.some((piece) => piece.position === position)" @click="selectCalculationPosition(position)">
              <template v-for="piece in [calculationDetailEntity.pieces.find((item) => item.position === position)]" :key="position">
                <img v-if="piece && yuhunImage(piece.suit)" :src="yuhunImage(piece.suit)!" :alt="piece.suit" /><span v-else>{{ piece ? yuhunPlaceholder(piece.suit) : position }}</span><small v-if="piece">+{{ piece.level }}</small>
              </template>
            </button>
            <div class="yuhun-wheel-center"><img v-if="shikigamiImage(calculationDetailEntity.shikigamiId ?? 0)" :src="shikigamiImage(calculationDetailEntity.shikigamiId ?? 0)!" :alt="calculationEntityName(calculationDetailEntity, calculationDetailTarget)" /><span v-else>{{ calculationEntityName(calculationDetailEntity, calculationDetailTarget).slice(0, 1) }}</span><strong>{{ calculationEntityName(calculationDetailEntity, calculationDetailTarget) }}</strong></div>
          </div>
          <div class="yuhun-build-summary"><span><small>{{ calculationDetailEntity.metricName }}</small><strong>{{ calculationScore(calculationDetailEntity) }}</strong></span><span><small>套装</small><strong>{{ calculationSuitSummary(calculationDetailEntity) }}</strong></span></div>
        </section>
        <aside class="yuhun-detail-panel">
          <template v-if="calculationDisplayedPiece">
            <header><span>{{ calculationDisplayedPiece.position }}号位{{ calculationDetailCandidateId === null ? '' : ' · 候选御魂' }}</span><strong>{{ calculationDisplayedPiece.suit }}</strong><small>{{ calculationDisplayedPiece.star }}星 · +{{ calculationDisplayedPiece.level }}</small></header>
            <div class="yuhun-main-stat"><span>{{ calculationDisplayedPiece.mainStatLabel }}</span><strong>{{ calculationDisplayedPiece.mainValue === undefined ? '-' : pieceStatValue({ stat: calculationDisplayedPiece.mainStat, value: calculationDisplayedPiece.mainValue }) }}</strong></div>
            <div class="yuhun-sub-stats"><span v-for="stat in calculationDisplayedPiece.intrinsicStats" :key="`intrinsic-${stat.stat}`"><small>{{ STAT_LABELS[stat.stat] }}（固有）</small><strong>{{ pieceStatValue(stat) }}</strong></span><span v-for="stat in calculationDisplayedPiece.subStats" :key="stat.stat"><small>{{ STAT_LABELS[stat.stat] }}</small><strong>{{ pieceStatValue(stat) }}</strong></span></div>
          </template>
          <p v-else>这个位置没有装配御魂。</p>
          <section class="yuhun-candidate-browser" aria-label="可提升御魂">
            <div v-if="calculationDetailCandidatePageItems.length > 0" class="yuhun-candidate-grid">
              <button v-for="item in calculationDetailCandidatePageItems" :key="item.yuhunId" :class="{ active: item.yuhunId === calculationDetailCandidateId }" :title="`${item.suit} · ${item.position}号 · +${item.level}`" @click="openCalculationCandidateComparison(item)">
                <img v-if="yuhunImage(item.suit)" :src="yuhunImage(item.suit)!" :alt="item.suit" /><span v-else>{{ yuhunPlaceholder(item.suit) }}</span><small>+{{ item.level }}</small>
              </button>
            </div>
            <p v-else>当前 {{ calculationDetailPosition }} 号位没有可提升御魂。</p>
            <nav v-if="calculationDetailCandidates.length > 0" class="yuhun-candidate-pagination" aria-label="可提升御魂分页"><button title="上一页" :disabled="calculationDetailCandidatePage === 1" @click="calculationDetailCandidatePage--"><ChevronRight class="previous" :size="14" /></button><span>{{ calculationDetailCandidatePage }} / {{ calculationDetailCandidatePageCount }}</span><button title="下一页" :disabled="calculationDetailCandidatePage === calculationDetailCandidatePageCount" @click="calculationDetailCandidatePage++"><ChevronRight :size="14" /></button></nav>
          </section>
        </aside>
        <footer class="yuhun-equipped-panel">
          <div v-if="calculationDetailEntity.panel" class="yuhun-panel-stats"><span v-for="stat in panelStatEntries(calculationDetailEntity.panel)" :key="stat.label"><small>{{ stat.label }}</small><strong>{{ stat.value }}</strong></span></div>
          <p v-else>{{ calculationDetailEntity.message }}</p>
        </footer>
      </div>
    </section>
  </div>

  <div
    v-if="pendingTeamTargetDelete"
    class="catalog-delete-overlay team-delete-overlay"
    @click.self="cancelTeamTargetDelete"
    @keydown.esc.stop="cancelTeamTargetDelete"
  >
    <section
      class="catalog-delete-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="team-target-delete-title"
      aria-describedby="team-target-delete-description"
    >
      <header>
        <span><TriangleAlert :size="20" /></span>
        <div>
          <small>DELETE TEAM TARGET</small>
          <h2 id="team-target-delete-title">确认删除“{{ pendingTeamTargetDelete.label }}”</h2>
        </div>
      </header>
      <div class="catalog-delete-body">
        <p id="team-target-delete-description">确认后，这条阵容会从当前浏览器会话中删除，且无法撤销。</p>
        <label class="team-delete-suppress">
          <input v-model="teamDeleteDoNotAskToday" data-testid="team-delete-do-not-ask" type="checkbox" />
          <span>今天不再提示</span>
        </label>
      </div>
      <footer>
        <button data-testid="cancel-team-target-delete" @click="cancelTeamTargetDelete">取消</button>
        <button class="danger-command" data-testid="confirm-team-target-delete" @click="confirmTeamTargetDelete"><Trash2 :size="16" />确认</button>
      </footer>
    </section>
  </div>

  <div v-if="catalogManagerOpen" class="modal-backdrop" @click.self="closeCatalogManager" @keydown.esc="closeCatalogManager">
    <section class="import-dialog catalog-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="catalog-manager-title">
      <header><div><span class="eyebrow">CATALOG MANAGER</span><h2 id="catalog-manager-title">阵容分类管理</h2></div><button class="icon-button" title="关闭" @click="closeCatalogManager"><X :size="18" /></button></header>
      <div class="catalog-manager-grid">
        <section class="catalog-manager-pane">
          <header><div><span>LEVEL 1</span><strong>一级分类</strong></div><button class="icon-button" title="新增一级分类" @click="beginCatalogDraft('domain')"><Plus :size="16" /></button></header>
          <form v-if="catalogDraft?.level === 'domain'" class="catalog-node-form" @submit.prevent="saveCatalogDraft">
            <input ref="catalogDraftInput" v-model="catalogDraft.label" maxlength="40" placeholder="一级分类名称" autofocus />
            <button class="icon-button" type="submit" title="保存一级分类" :disabled="catalogDraft.label.trim() === ''"><Save :size="15" /></button>
            <button class="icon-button" type="button" title="取消" @click="catalogDraft = null"><X :size="15" /></button>
          </form>
          <div class="catalog-node-list" role="listbox" aria-label="一级分类">
            <div
              v-for="domain in catalog"
              :key="domain.id"
              class="catalog-node-row"
              :class="{ selected: managerDomainId === domain.id }"
              :draggable="isCustomCatalogId(domain.id)"
              :data-catalog-domain="domain.id"
              @dragstart="startCatalogDrag('domain', null, domain.id, $event)"
              @dragover.prevent
              @drop.prevent="dropCatalogNode('domain', null, domain.id)"
              @dragend="catalogDrag = null"
            >
              <span class="catalog-node-gutter" aria-hidden="true"><GripVertical v-if="isCustomCatalogId(domain.id)" :size="14" class="drag-handle" /></span>
              <button class="catalog-node-select" role="option" :aria-selected="managerDomainId === domain.id" @click="selectManagerDomain(domain.id)"><span>{{ domain.label }}</span><small>{{ targetCountForSceneIds(sceneIdsForDomain(domain.id)) }}</small></button>
              <button v-if="isCustomCatalogId(domain.id)" class="icon-button" :title="`编辑一级分类：${domain.label}`" @click="selectManagerDomain(domain.id); beginCatalogDraft('domain', domain.id)"><Edit3 :size="13" /></button>
              <span v-else class="catalog-node-lock" :title="`${domain.label}由 R2 发布，只读`" role="img" :aria-label="`${domain.label}由 R2 发布，只读`"><Lock :size="13" /></span>
              <button v-if="isCustomCatalogId(domain.id)" class="icon-button danger" :title="`删除一级分类：${domain.label}`" @click="requestCatalogDelete('domain', domain.id)"><Trash2 :size="13" /></button>
              <span v-else class="catalog-node-action-spacer" aria-hidden="true"></span>
            </div>
            <div v-if="catalog.length === 0" class="catalog-pane-empty">暂无一级分类</div>
          </div>
        </section>

        <section class="catalog-manager-pane" :class="{ unavailable: managerDomain === null }">
          <header><div><span>LEVEL 2</span><strong>二级分类</strong></div><button class="icon-button" title="新增二级分类" :disabled="managerDomain === null" @click="beginCatalogDraft('category')"><Plus :size="16" /></button></header>
          <form v-if="catalogDraft?.level === 'category'" class="catalog-node-form" @submit.prevent="saveCatalogDraft">
            <input ref="catalogDraftInput" v-model="catalogDraft.label" maxlength="40" placeholder="二级分类名称" autofocus />
            <button class="icon-button" type="submit" title="保存二级分类" :disabled="catalogDraft.label.trim() === ''"><Save :size="15" /></button>
            <button class="icon-button" type="button" title="取消" @click="catalogDraft = null"><X :size="15" /></button>
          </form>
          <div class="catalog-node-list" role="listbox" aria-label="二级分类">
            <div
              v-for="category in managerDomain?.categories ?? []"
              :key="category.id"
              class="catalog-node-row"
              :class="{ selected: managerCategoryId === category.id }"
              :draggable="isCustomCatalogId(category.id)"
              :data-catalog-category="category.id"
              @dragstart="startCatalogDrag('category', managerDomainId, category.id, $event)"
              @dragover.prevent
              @drop.prevent="dropCatalogNode('category', managerDomainId, category.id)"
              @dragend="catalogDrag = null"
            >
              <span class="catalog-node-gutter" aria-hidden="true"><GripVertical v-if="isCustomCatalogId(category.id)" :size="14" class="drag-handle" /></span>
              <button class="catalog-node-select" role="option" :aria-selected="managerCategoryId === category.id" @click="selectManagerCategory(category.id)"><span>{{ category.label }}</span><small>{{ targetCountForSceneIds(sceneIdsForCategory(category)) }}</small></button>
              <button v-if="isCustomCatalogId(category.id)" class="icon-button" :title="`编辑二级分类：${category.label}`" @click="selectManagerCategory(category.id); beginCatalogDraft('category', category.id)"><Edit3 :size="13" /></button>
              <span v-else class="catalog-node-lock" :title="`${category.label}由 R2 发布，只读`" role="img" :aria-label="`${category.label}由 R2 发布，只读`"><Lock :size="13" /></span>
              <button v-if="isCustomCatalogId(category.id)" class="icon-button danger" :title="`删除二级分类：${category.label}`" @click="requestCatalogDelete('category', category.id)"><Trash2 :size="13" /></button>
              <span v-else class="catalog-node-action-spacer" aria-hidden="true"></span>
            </div>
            <div v-if="managerDomain === null" class="catalog-pane-empty">请先选择一级分类</div>
            <div v-else-if="managerDomain.categories.length === 0" class="catalog-pane-empty">暂无二级分类</div>
          </div>
        </section>

        <section class="catalog-manager-pane" :class="{ unavailable: managerCategory === null }">
          <header><div><span>LEVEL 3</span><strong>具体场景</strong></div><button class="icon-button" title="新增具体场景" :disabled="managerCategory === null" @click="beginCatalogDraft('scene')"><Plus :size="16" /></button></header>
          <form v-if="catalogDraft?.level === 'scene'" class="catalog-node-form scene-catalog-node-form" @submit.prevent="saveCatalogDraft">
            <input ref="catalogDraftInput" v-model="catalogDraft.label" maxlength="40" placeholder="具体场景名称" autofocus />
            <label class="catalog-game-scene-id"><span>关卡 ID</span><input v-model="catalogDraft.gameSceneId" data-testid="catalog-scene-game-id" inputmode="numeric" maxlength="16" placeholder="未设置" /></label>
            <button class="icon-button" type="submit" title="保存具体场景" :disabled="catalogDraft.label.trim() === ''"><Save :size="15" /></button>
            <button class="icon-button" type="button" title="取消" @click="catalogDraft = null"><X :size="15" /></button>
          </form>
          <div class="catalog-node-list" role="listbox" aria-label="具体场景">
            <div
              v-for="scene in managerCategory?.scenes ?? []"
              :key="scene.id"
              class="catalog-node-row"
              :class="{ selected: managerSceneId === scene.id }"
              :draggable="isCustomCatalogId(scene.id)"
              :data-catalog-scene="scene.id"
              @dragstart="startCatalogDrag('scene', managerCategoryId, scene.id, $event)"
              @dragover.prevent
              @drop.prevent="dropCatalogNode('scene', managerCategoryId, scene.id)"
              @dragend="catalogDrag = null"
            >
              <span class="catalog-node-gutter" aria-hidden="true"><GripVertical v-if="isCustomCatalogId(scene.id)" :size="14" class="drag-handle" /></span>
              <button class="catalog-node-select" role="option" :aria-selected="managerSceneId === scene.id" @click="selectManagerScene(scene.id)"><span>{{ sceneShortLabel(scene.label, managerCategory?.label ?? '') }}</span><small :title="`关卡 ID：${formatGameSceneId(scene.gameSceneIdOverride === undefined ? scene.gameSceneId : scene.gameSceneIdOverride)}；${targetsForScene(scene.id).length} 条阵容`">ID {{ formatGameSceneId(scene.gameSceneIdOverride === undefined ? scene.gameSceneId : scene.gameSceneIdOverride) }} · {{ targetsForScene(scene.id).length }}</small></button>
              <label class="catalog-scene-mutual-exclusion" @click.stop><input type="checkbox" :checked="scene.mutualExclusion === true" @change="setSceneMutualExclusion(scene.id, ($event.target as HTMLInputElement).checked)" /><span>互斥</span></label>
              <button v-if="isCustomCatalogId(scene.id)" class="icon-button" :title="`编辑具体场景：${scene.label}`" @click="selectManagerScene(scene.id); beginCatalogDraft('scene', scene.id)"><Edit3 :size="13" /></button>
              <span v-else class="catalog-node-lock" :title="`${scene.label}由 R2 发布，只读`" role="img" :aria-label="`${scene.label}由 R2 发布，只读`"><Lock :size="13" /></span>
              <button v-if="isCustomCatalogId(scene.id)" class="icon-button danger" :title="`删除具体场景：${scene.label}`" @click="requestCatalogDelete('scene', scene.id)"><Trash2 :size="13" /></button>
              <span v-else class="catalog-node-action-spacer" aria-hidden="true"></span>
            </div>
            <div v-if="managerCategory === null" class="catalog-pane-empty">请先选择二级分类</div>
            <div v-else-if="managerCategory.scenes.length === 0" class="catalog-pane-empty">暂无具体场景</div>
          </div>
        </section>
      </div>
      <footer><span>R2 官方目录只读；本地新增分类和场景会自动保存</span><button class="primary" @click="closeCatalogManager">完成</button></footer>
    </section>

    <div v-if="pendingCatalogDelete" class="catalog-delete-overlay" @click.self="pendingCatalogDelete = null" @keydown.esc.stop="pendingCatalogDelete = null">
      <section class="catalog-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="catalog-delete-title" aria-describedby="catalog-delete-description">
        <header><span><TriangleAlert :size="20" /></span><div><small>DELETE CATALOG</small><h2 id="catalog-delete-title">确认删除“{{ pendingCatalogDelete.label }}”</h2></div></header>
        <div class="catalog-delete-body">
          <p id="catalog-delete-description">该节点包含以下内容，确认后将一并从当前会话删除：</p>
          <div class="catalog-delete-counts">
            <span v-if="pendingCatalogDelete.categoryCount > 0"><strong>{{ pendingCatalogDelete.categoryCount }}</strong> 个二级分类</span>
            <span v-if="pendingCatalogDelete.sceneCount > 0"><strong>{{ pendingCatalogDelete.sceneCount }}</strong> 个具体场景</span>
            <span v-if="pendingCatalogDelete.targetCount > 0"><strong>{{ pendingCatalogDelete.targetCount }}</strong> 条已导入阵容</span>
          </div>
          <p>此操作不会影响游戏内数据，但在当前会话中无法撤销。</p>
        </div>
        <footer><button @click="pendingCatalogDelete = null">取消</button><button class="danger-command" data-testid="confirm-catalog-delete" @click="confirmCatalogDelete"><Trash2 :size="16" />确认删除</button></footer>
      </section>
    </div>
  </div>

  <div v-if="ruleCodeImportOpen" class="modal-backdrop" @click.self="!ruleImportBusy && (ruleCodeImportOpen = false)" @keydown.esc="!ruleImportBusy && (ruleCodeImportOpen = false)" @paste="handleRuleCodePaste">
    <section class="import-dialog rule-dialog" role="dialog" aria-modal="true" aria-labelledby="rule-code-import-title" :aria-busy="ruleImportBusy !== null">
      <header><div><span class="eyebrow">PRESET RULE</span><h2 id="rule-code-import-title">导入规则配置</h2></div><button class="icon-button" title="关闭" :disabled="ruleImportBusy !== null" @click="ruleCodeImportOpen = false"><X :size="18" /></button></header>
      <div class="target-entry-tabs" role="tablist" aria-label="规则添加方式">
        <button role="tab" :aria-selected="ruleEntryMode === 'code'" :class="{ active: ruleEntryMode === 'code' }" :disabled="ruleImportBusy !== null" @click="ruleEntryMode = 'code'"><Import :size="16" />御魂码导入</button>
        <button role="tab" data-testid="manual-rule-tab" :aria-selected="ruleEntryMode === 'manual'" :class="{ active: ruleEntryMode === 'manual' }" :disabled="ruleImportBusy !== null" @click="ruleEntryMode = 'manual'"><Pencil :size="16" />手动配置</button>
      </div>
      <div v-if="ruleEntryMode === 'code'" class="target-code-entry">
        <label class="import-code-field"><span>御魂筛选码</span><textarea v-model="ruleCodeImportValue" :disabled="ruleImportBusy !== null" rows="6" spellcheck="false" placeholder="粘贴游戏内导出的御魂码，或从下方识别二维码"></textarea></label>
        <section class="team-code-qr-panel" aria-labelledby="rule-code-qr-title">
          <div><ScanQrCode :size="19" /><span><strong id="rule-code-qr-title">从剪贴板或二维码图片导入</strong><small>图片仅在浏览器中识别；御魂码通过解码服务解析。</small></span></div>
          <div class="team-code-qr-actions">
            <button type="button" data-testid="choose-yuhun-code-qr" :disabled="ruleImportBusy !== null" @click="ruleQrInput?.click()"><LoaderCircle v-if="ruleImportBusy === 'image'" class="spin" :size="15" /><ImageUp v-else :size="15" />选择二维码图片</button>
            <button type="button" data-testid="read-yuhun-code-clipboard" :disabled="ruleImportBusy !== null" @click="recognizeRuleCode('clipboard')"><LoaderCircle v-if="ruleImportBusy === 'clipboard'" class="spin" :size="15" /><ClipboardPaste v-else :size="15" />读取剪贴板</button>
            <input ref="ruleQrInput" type="file" accept="image/*" hidden @change="readRuleQrImage" />
          </div>
        </section>
        <div class="target-entry-note"><strong>支持 Ctrl+V / Cmd+V 直接粘贴</strong><span>可以粘贴御魂码文字，也可以粘贴包含二维码的截图。</span></div>
        <div class="target-entry-note"><strong>每个条件组会导入为一条规则</strong><span>弃置或强化类型由御魂码决定；星级、等级、副属性排除和固有属性等高级条件会一并保留。</span></div>
        <div v-if="ruleImportMessage" class="target-import-feedback" :class="ruleImportFailed ? 'error' : ruleImportBusy ? 'loading' : 'success'" :role="ruleImportFailed ? 'alert' : 'status'">
          <TriangleAlert v-if="ruleImportFailed" :size="16" /><LoaderCircle v-else-if="ruleImportBusy" class="spin" :size="16" /><Check v-else :size="16" /><span>{{ ruleImportMessage }}</span>
        </div>
      </div>
      <div v-else class="rule-form">
        <label class="rule-name"><span>规则池</span><select v-model="rulePool"><option value="discard">弃置规则池</option><option value="enhance">强化规则池</option></select></label>
        <label class="rule-name"><span>规则名称</span><input v-model="ruleLabel" maxlength="80" placeholder="例如：针女输出胚子" /></label>
        <YuhunConditionEditor v-model="ruleCriteria" />
      </div>
      <footer v-if="ruleEntryMode === 'code'"><span>导入后默认启用，规则保存在本机自动会话</span><button class="primary" data-testid="confirm-import-yuhun-code" :disabled="ruleCodeImportValue.trim() === '' || ruleImportBusy !== null || !!store.busy" @click="importRuleCode"><LoaderCircle v-if="ruleImportBusy === 'decode'" class="spin" :size="17" /><Import v-else :size="17" />{{ ruleImportBusy === 'decode' ? '正在解码…' : '解码并导入' }}</button></footer>
      <footer v-else><span>保存后默认启用并进入{{ rulePool === 'discard' ? '弃置' : '强化' }}规则池</span><button class="primary" :disabled="ruleLabel.trim() === '' || !!store.busy" @click="saveRule"><Save :size="17" />保存并启用</button></footer>
    </section>
  </div>

  <div v-if="ruleOpen" class="modal-backdrop" @click.self="ruleOpen = false" @keydown.esc="ruleOpen = false">
    <section class="import-dialog rule-dialog" role="dialog" aria-modal="true" aria-labelledby="preset-rule-title">
      <header><div><span class="eyebrow">PRESET RULE</span><h2 id="preset-rule-title">{{ editingRuleId ? '编辑' : '添加' }}{{ rulePool === 'discard' ? '弃置' : '强化' }}规则</h2></div><button class="icon-button" title="关闭" @click="ruleOpen = false"><X :size="18" /></button></header>
      <div class="rule-form">
        <label class="rule-name"><span>规则名称</span><input v-model="ruleLabel" maxlength="80" placeholder="例如：针女输出胚子" /></label>
        <YuhunConditionEditor v-model="ruleCriteria" />
      </div>
      <footer><span>未选择御魂套装表示不限套装；保存后默认启用并进入{{ rulePool === 'discard' ? '弃置' : '强化' }}规则池</span><button class="primary" :disabled="ruleLabel.trim() === ''" @click="saveRule"><Save :size="17" />保存规则</button></footer>
    </section>
  </div>

  <YuhunSuitPicker v-if="ruleYuhunPickerOpen" :options="YUHUN_TYPES" :selected="ruleSuits" @change="ruleSuits = $event" @close="ruleYuhunPickerOpen = false" @apply="ruleYuhunPickerOpen = false" />
  <PotentialComparison v-if="potentialComparisonTargets" :targets="potentialComparisonTargets" :title="potentialComparisonTitle" :compact="potentialComparisonCompact" reference-title="当前装配御魂" @close="potentialComparisonTargets = null; potentialComparisonCompact = false" />
</template>
