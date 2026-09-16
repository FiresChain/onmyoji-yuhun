<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowLeftRight, Check, ClipboardPaste, Download, Eye, FileJson, GitCompareArrows, ImageUp, Import, LoaderCircle, Pencil, ScanQrCode, Search, SlidersHorizontal, Trash2, TriangleAlert, Upload, X } from "@lucide/vue";
import { STAT_LABELS, type PlanComparisonDTO, type PlanComparisonFilter, type PlanDifference, type StatId } from "../../../src/browser.js";
import YuhunConditionEditor from "../components/YuhunConditionEditor.vue";
import { yuhunDisplayName, yuhunImage } from "../manual-target-config.js";
import type { SavedPlan } from "../plan-library.js";
import { useWorkbenchStore } from "../store.js";
import { formatStatValue as formatStat } from "../number-format.js";
import { decodeYuhunCodeFromQrImage, readYuhunCodeFromClipboard } from "../team-code-qr.js";
import { emptyYuhunFilter } from "../yuhun-filter.js";

const store = useWorkbenchStore();
const labels: Record<PlanDifference, string> = {
  "extra-discard": "新方案额外弃置", "extra-retain": "新方案额外保留",
  "both-discard": "两者都弃置", "both-retain": "两者都保留"
};
const differenceKinds = Object.keys(labels) as PlanDifference[];
const comparison = ref<PlanComparisonDTO | null>(null);
const comparisonBusy = ref(false);
const pageError = ref("");
const libraryLoading = ref(false);
const librarySearch = ref("");
const filter = ref<PlanComparisonFilter>("changed");
const search = ref("");
const criteria = ref(emptyYuhunFilter());
const criteriaDraft = ref(emptyYuhunFilter());
const filterOpen = ref(false);
const hasCriteria = computed(() => Object.values(criteria.value).some(values => values.length > 0));
const visiblePlans = computed(() => store.savedPlans.filter(plan => plan.name.toLocaleLowerCase().includes(librarySearch.value.trim().toLocaleLowerCase())));
const basePlan = computed(() => store.savedPlans.find(plan => plan.id === store.comparisonBaseId));
const nextPlan = computed(() => store.savedPlans.find(plan => plan.id === store.comparisonNextId));
let comparisonRequest = 0;

async function loadLibrary(): Promise<void> {
  libraryLoading.value = true;
  pageError.value = "";
  try { await store.loadPlanLibrary(); }
  catch (reason) { pageError.value = reason instanceof Error ? reason.message : "读取方案失败"; }
  finally { libraryLoading.value = false; }
}

async function loadComparison(page = 1): Promise<void> {
  const request = ++comparisonRequest;
  comparison.value = null;
  comparisonBusy.value = false;
  if (!basePlan.value || !nextPlan.value || !store.snapshot) return;
  pageError.value = "";
  comparisonBusy.value = true;
  try {
    const result = await store.compareSavedPlans({ page, pageSize: 30, filter: filter.value, criteria: criteria.value, search: search.value });
    if (request === comparisonRequest) comparison.value = result;
  } catch (reason) {
    if (request === comparisonRequest) pageError.value = reason instanceof Error ? reason.message : "比对失败";
  } finally {
    if (request === comparisonRequest) comparisonBusy.value = false;
  }
}

watch([() => store.comparisonBaseId, () => store.comparisonNextId, () => store.snapshot, filter, criteria], () => { void loadComparison(); }, { immediate: true });
onMounted(() => { void loadLibrary(); });
onBeforeUnmount(() => { comparisonRequest++; importSequence++; });

function swapPlans(): void {
  [store.comparisonBaseId, store.comparisonNextId] = [store.comparisonNextId, store.comparisonBaseId];
}
function openFilter(): void {
  criteriaDraft.value = JSON.parse(JSON.stringify(criteria.value));
  filterOpen.value = true;
}
function applyFilter(): void {
  criteria.value = JSON.parse(JSON.stringify(criteriaDraft.value));
  filterOpen.value = false;
}
function formatStatValue(stat: StatId, value: number): string {
  return formatStat(stat, value, store.displayDecimalPlaces);
}
function dateLabel(date: string): string { return new Date(date).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }

const importOpen = ref(false);
const importName = ref("");
const codeFields = [{ key: "discard", label: "弃置码" }, { key: "rescue", label: "强化码" }] as const;
type CodeField = typeof codeFields[number]["key"];
const importCodes = ref({ discard: "", rescue: "" });
const qrTarget = ref<CodeField>("discard");
const qrImageInput = ref<HTMLInputElement | null>(null);
const planFileInput = ref<HTMLInputElement | null>(null);
const importError = ref("");
const importMessage = ref("");
const importBusy = ref<"image" | "clipboard" | "decode" | "file" | null>(null);
let importSequence = 0;
function openImport(): void {
  importSequence++;
  importName.value = "";
  importCodes.value = { discard: "", rescue: "" };
  qrTarget.value = "discard";
  importError.value = "";
  importMessage.value = "";
  importOpen.value = true;
}
function chooseQrImage(target: CodeField): void {
  qrTarget.value = target;
  qrImageInput.value?.click();
}
async function recognizeCode(target: CodeField, source: "image" | "clipboard", image?: Blob): Promise<void> {
  if (importBusy.value !== null) return;
  const sequence = ++importSequence;
  qrTarget.value = target;
  importBusy.value = source;
  importError.value = "";
  importMessage.value = "正在识别御魂码…";
  try {
    const code = image ? await decodeYuhunCodeFromQrImage(image) : (await readYuhunCodeFromClipboard()).code;
    if (sequence !== importSequence) return;
    importCodes.value[target] = code;
    importMessage.value = `识别成功，已填入${target === "discard" ? "弃置码" : "强化码"}`;
  } catch (reason) {
    if (sequence !== importSequence) return;
    importError.value = reason instanceof Error ? reason.message : "御魂码识别失败";
  } finally {
    if (sequence === importSequence) importBusy.value = null;
  }
}
async function readQrImage(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) await recognizeCode(qrTarget.value, "image", file);
}
async function handleCodePaste(event: ClipboardEvent, target: CodeField): Promise<void> {
  const image = Array.from(event.clipboardData?.items ?? [])
    .find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile();
  if (!image) return;
  event.preventDefault();
  await recognizeCode(target, "clipboard", image);
}
async function importCodePlan(): Promise<void> {
  if (importBusy.value !== null) return;
  importBusy.value = "decode";
  importError.value = "";
  importMessage.value = "正在解码并导入…";
  try {
    await store.importSavedPlan({ name: importName.value, discardCode: importCodes.value.discard, rescueCode: importCodes.value.rescue });
    importOpen.value = false;
    store.notice = "方案已导入";
  } catch (reason) { importError.value = reason instanceof Error ? reason.message : "导入失败"; }
  finally { importBusy.value = null; }
}
async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || importBusy.value !== null) return;
  importBusy.value = "file";
  importError.value = "";
  importMessage.value = "正在导入方案文件…";
  try {
    await store.importSavedPlanFile(file);
    importOpen.value = false;
    store.notice = "方案已导入";
  } catch (reason) { importError.value = reason instanceof Error ? reason.message : "导入失败"; }
  finally { importBusy.value = null; }
}

const viewedPlan = ref<SavedPlan | null>(null);
const renamePlan = ref<SavedPlan | null>(null);
const renameName = ref("");
const renameError = ref("");
const renaming = ref(false);
function openRename(plan: SavedPlan): void {
  renamePlan.value = plan;
  renameName.value = plan.name;
  renameError.value = "";
}
async function rename(): Promise<void> {
  if (!renamePlan.value) return;
  renaming.value = true;
  renameError.value = "";
  try { await store.renameSavedPlan(renamePlan.value.id, renameName.value); renamePlan.value = null; }
  catch (reason) { renameError.value = reason instanceof Error ? reason.message : "重命名失败"; }
  finally { renaming.value = false; }
}
async function remove(plan: SavedPlan): Promise<void> {
  if (!window.confirm(`删除方案“${plan.name}”？`)) return;
  try { await store.removeSavedPlan(plan.id); }
  catch (reason) { pageError.value = reason instanceof Error ? reason.message : "删除失败"; }
}
function exportPlan(plan: SavedPlan): void {
  try { store.exportSavedPlan(plan.id); }
  catch (reason) { pageError.value = reason instanceof Error ? reason.message : "导出失败"; }
}
</script>

<template>
  <section class="page-heading"><div><span class="eyebrow">05 / COMPARE</span><h1>方案比对</h1></div><span v-if="store.snapshot" class="tag">当前快照 · {{ store.snapshot.total.toLocaleString() }} 件</span></section>
  <div v-if="pageError" class="inline-warning comparison-error" role="alert">{{ pageError }}<button class="secondary" @click="store.planLibraryLoaded ? loadComparison() : loadLibrary()">重试</button></div>
  <div class="plan-compare-layout">
    <aside class="plan-library">
      <header><h2>方案库 <small>{{ store.savedPlans.length }}</small></h2><button class="secondary" :disabled="store.planLibraryBusy || libraryLoading" @click="openImport"><Upload :size="15" />导入</button></header>
      <div class="plan-library-search"><Search :size="15" /><input v-model="librarySearch" aria-label="搜索方案" placeholder="搜索方案" /></div>
      <div v-if="libraryLoading" class="empty-state"><LoaderCircle class="spin" :size="24" /><span>正在读取…</span></div>
      <div v-else-if="visiblePlans.length === 0" class="empty-state"><GitCompareArrows :size="28" /><strong>{{ store.savedPlans.length ? '没有匹配的方案' : '暂无保存方案' }}</strong></div>
      <div v-else class="plan-library-list">
        <article v-for="plan in visiblePlans" :key="plan.id" class="saved-plan" :class="{ selected: plan.id === store.comparisonBaseId || plan.id === store.comparisonNextId }">
          <button class="saved-plan-name" @click="viewedPlan = plan">{{ plan.name }}</button>
          <div class="saved-plan-meta"><span>D {{ plan.criteria.discard.length }} · E {{ plan.criteria.rescue.length }}</span><time :datetime="plan.createdAt">{{ dateLabel(plan.createdAt) }}</time></div>
          <div class="saved-plan-select"><button :class="{ active: plan.id === store.comparisonBaseId }" :aria-pressed="plan.id === store.comparisonBaseId" @click="store.comparisonBaseId = plan.id">基准方案</button><button :class="{ active: plan.id === store.comparisonNextId }" :aria-pressed="plan.id === store.comparisonNextId" @click="store.comparisonNextId = plan.id">新方案</button></div>
          <div class="saved-plan-actions"><button class="icon-button" title="查看方案" aria-label="查看方案" @click="viewedPlan = plan"><Eye :size="15" /></button><button class="icon-button" title="重命名" aria-label="重命名" :disabled="store.planLibraryBusy" @click="openRename(plan)"><Pencil :size="15" /></button><button class="icon-button" title="导出方案" aria-label="导出方案" @click="exportPlan(plan)"><Download :size="15" /></button><button class="icon-button danger" title="删除方案" aria-label="删除方案" :disabled="store.planLibraryBusy" @click="remove(plan)"><Trash2 :size="15" /></button></div>
        </article>
      </div>
    </aside>
    <div class="plan-comparison-main">
      <div class="comparison-selectors">
        <label>基准方案<select v-model="store.comparisonBaseId" aria-label="基准方案"><option value="">选择方案</option><option v-for="plan in store.savedPlans" :key="plan.id" :value="plan.id">{{ plan.name }}</option></select></label>
        <button class="icon-button" title="交换方案" aria-label="交换方案" :disabled="!basePlan && !nextPlan" @click="swapPlans"><ArrowLeftRight :size="18" /></button>
        <label>新方案<select v-model="store.comparisonNextId" aria-label="新方案"><option value="">选择方案</option><option v-for="plan in store.savedPlans" :key="plan.id" :value="plan.id">{{ plan.name }}</option></select></label>
      </div>
      <div v-if="!store.snapshot" class="empty-state"><FileJson :size="30" /><strong>请先导入御魂快照</strong><RouterLink to="/snapshot" class="primary">导入快照</RouterLink></div>
      <div v-else-if="!basePlan || !nextPlan" class="empty-state"><GitCompareArrows :size="30" /><strong>选择基准方案和新方案</strong></div>
      <template v-else>
        <div class="comparison-counts">
          <button v-for="kind in differenceKinds" :key="kind" :class="{ active: filter === kind, discard: kind === 'extra-discard' }" :aria-pressed="filter === kind" @click="filter = kind"><span>{{ labels[kind] }}</span><strong>{{ comparison?.counts[kind].toLocaleString() ?? '—' }}</strong></button>
        </div>
        <section class="data-section">
          <div class="section-toolbar comparison-toolbar"><div><h2>御魂处理差异</h2><span>{{ comparison?.total.toLocaleString() ?? '—' }} 件</span></div>
            <div class="comparison-filters"><select v-model="filter" aria-label="处理差异"><option value="changed">仅差异</option><option value="all">全部御魂</option><option v-for="kind in differenceKinds" :key="kind" :value="kind">{{ labels[kind] }}</option></select><button class="secondary" :class="{ active: hasCriteria }" @click="openFilter"><SlidersHorizontal :size="15" />筛选</button></div>
          </div>
          <form class="comparison-search" @submit.prevent="loadComparison()"><input v-model="search" aria-label="搜索御魂套装" placeholder="搜索御魂套装" /><button class="icon-button" type="submit" aria-label="搜索" title="搜索"><Search :size="16" /></button></form>
          <div v-if="comparisonBusy" class="empty-state" role="status"><LoaderCircle class="spin" :size="24" /><span>正在比对…</span></div>
          <template v-else-if="comparison">
            <div class="table-wrap"><table class="excel-table comparison-table"><thead><tr><th>套装</th><th>位置</th><th>星级</th><th>等级</th><th>主属性 / 固有属性</th><th>副属性</th><th>原始状态</th><th>基准方案</th><th>新方案</th><th>差异</th></tr></thead><tbody>
              <tr v-for="row in comparison.rows" :key="row.row">
                <td><span class="inventory-suit"><img v-if="yuhunImage(row.suit)" :src="yuhunImage(row.suit)!" :alt="yuhunDisplayName(row.suit)" /><FileJson v-else :size="18" /><span>{{ yuhunDisplayName(row.suit) }}</span></span></td><td>{{ row.position }}号</td><td>{{ row.star }}星</td><td>+{{ row.level }}</td>
                <td><div class="inventory-stat-list"><span class="inventory-stat"><small>{{ STAT_LABELS[row.mainStat] }}</small><strong>{{ formatStatValue(row.mainStat, row.mainValue) }}</strong></span><span v-for="stat in row.intrinsicStats" :key="stat.stat" class="inventory-stat intrinsic"><small>{{ STAT_LABELS[stat.stat] }}</small><strong>{{ formatStatValue(stat.stat, stat.value) }}</strong></span></div></td>
                <td><div class="inventory-stat-list"><span v-for="stat in row.subStatValues" :key="stat.stat" class="inventory-stat"><small>{{ STAT_LABELS[stat.stat] }}</small><strong>{{ formatStatValue(stat.stat, stat.value) }}</strong></span></div></td>
                <td>{{ row.locked ? '已锁定 · ' : '' }}{{ row.garbage ? '弃置池' : '正常池' }}</td>
                <td><span class="tag" :class="row.baseDisposition === 'discard' ? 'danger-tag' : 'success-tag'">{{ row.baseDisposition === 'discard' ? '弃置' : '保留' }}</span></td><td><span class="tag" :class="row.nextDisposition === 'discard' ? 'danger-tag' : 'success-tag'">{{ row.nextDisposition === 'discard' ? '弃置' : '保留' }}</span></td>
                <td><span class="difference-label" :class="row.difference">{{ labels[row.difference] }}</span></td>
              </tr><tr v-if="comparison.rows.length === 0"><td colspan="10" class="empty-cell">{{ filter === 'changed' && !hasCriteria && !search.trim() ? '两个方案处理一致' : '没有符合筛选条件的御魂' }}</td></tr>
            </tbody></table></div>
            <div class="pagination"><button :disabled="comparison.page <= 1" @click="loadComparison(comparison.page - 1)">上一页</button><span>{{ comparison.page }} / {{ Math.max(1, Math.ceil(comparison.total / comparison.pageSize)) }}</span><button :disabled="comparison.page * comparison.pageSize >= comparison.total" @click="loadComparison(comparison.page + 1)">下一页</button></div>
          </template>
        </section>
      </template>
    </div>
  </div>
  <div v-if="importOpen" class="modal-backdrop" @click.self="!importBusy && (importOpen = false)" @keydown.esc="!importBusy && (importOpen = false)">
    <form class="import-dialog plan-import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-plan-title" :aria-busy="importBusy !== null" @submit.prevent="importCodePlan">
      <header><h2 id="import-plan-title">导入方案</h2><button class="icon-button" type="button" aria-label="关闭" :disabled="importBusy !== null" @click="importOpen = false"><X :size="18" /></button></header>
      <div class="target-entry-tabs" role="tablist" aria-label="方案导入方式">
        <button id="plan-code-tab" class="active" type="button" role="tab" aria-selected="true" aria-controls="plan-code-entry"><Import :size="16" />御魂码导入</button>
      </div>
      <div id="plan-code-entry" class="target-code-entry" role="tabpanel" aria-labelledby="plan-code-tab">
        <label><span>方案名称</span><input v-model="importName" maxlength="80" required :disabled="importBusy !== null" placeholder="输入方案名称" /></label>
        <section v-for="field in codeFields" :key="field.key" class="plan-code-field" :aria-labelledby="`plan-${field.key}-title`" @paste="handleCodePaste($event, field.key)">
          <label class="import-code-field"><span :id="`plan-${field.key}-title`">{{ field.label }}</span><textarea v-model="importCodes[field.key]" rows="3" spellcheck="false" :disabled="importBusy !== null" :placeholder="`粘贴${field.label}，或从下方识别单张二维码图片`" @input="importError = ''; importMessage = ''" /></label>
          <section class="team-code-qr-panel" :aria-labelledby="`plan-${field.key}-qr-title`">
            <div><ScanQrCode :size="19" /><span><strong :id="`plan-${field.key}-qr-title`">从剪贴板或二维码图片导入</strong><small>支持 Ctrl+V / Cmd+V 粘贴御魂码或单张截图</small></span></div>
            <div class="team-code-qr-actions">
              <button type="button" :aria-label="`选择${field.label}二维码图片`" :disabled="importBusy !== null" @click="chooseQrImage(field.key)"><LoaderCircle v-if="importBusy === 'image' && qrTarget === field.key" class="spin" :size="15" /><ImageUp v-else :size="15" />选择二维码图片</button>
              <button type="button" :aria-label="`读取${field.label}剪贴板`" :disabled="importBusy !== null" @click="recognizeCode(field.key, 'clipboard')"><LoaderCircle v-if="importBusy === 'clipboard' && qrTarget === field.key" class="spin" :size="15" /><ClipboardPaste v-else :size="15" />读取剪贴板</button>
            </div>
          </section>
        </section>
        <input ref="qrImageInput" type="file" accept="image/*" hidden :disabled="importBusy !== null" @change="readQrImage" />
        <div v-if="importError || importMessage" class="target-import-feedback" :class="importError ? 'error' : importBusy ? 'loading' : 'success'" :role="importError ? 'alert' : 'status'">
          <TriangleAlert v-if="importError" :size="16" /><LoaderCircle v-else-if="importBusy" class="spin" :size="16" /><Check v-else :size="16" /><span>{{ importError || importMessage }}</span>
        </div>
      </div>
      <footer>
        <button class="secondary" type="button" :disabled="importBusy !== null" @click="planFileInput?.click()"><FileJson :size="16" />导入方案 JSON</button>
        <input ref="planFileInput" type="file" accept="application/json,.json" hidden :disabled="importBusy !== null" @change="importFile" />
        <button class="primary" type="submit" :disabled="importBusy !== null || !importName.trim() || (!importCodes.discard.trim() && !importCodes.rescue.trim())"><LoaderCircle v-if="importBusy === 'decode'" class="spin" :size="16" /><Import v-else :size="16" />{{ importBusy === 'decode' ? '正在解码…' : '解码并导入' }}</button>
      </footer>
    </form>
  </div>
  <div v-if="renamePlan" class="modal-backdrop" @click.self="!renaming && (renamePlan = null)">
    <form class="import-dialog plan-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-plan-title" @submit.prevent="rename"><header><h2 id="rename-plan-title">重命名方案</h2><button class="icon-button" type="button" aria-label="关闭" :disabled="renaming" @click="renamePlan = null"><X :size="18" /></button></header><div class="plan-import-form"><label>方案名称<input v-model="renameName" required maxlength="80" :disabled="renaming" /></label><p v-if="renameError" class="inline-warning" role="alert">{{ renameError }}</p><button class="primary" type="submit" :disabled="renaming || !renameName.trim()">{{ renaming ? '正在保存…' : '保存' }}</button></div></form>
  </div>
  <div v-if="viewedPlan" class="modal-backdrop" @click.self="viewedPlan = null" @keydown.esc="viewedPlan = null"><section class="import-dialog plan-import-dialog" role="dialog" aria-modal="true" aria-labelledby="view-plan-title"><header><h2 id="view-plan-title">{{ viewedPlan.name }}</h2><button class="icon-button" aria-label="关闭" @click="viewedPlan = null"><X :size="18" /></button></header><div class="plan-import-form"><label>弃置码<textarea readonly :value="viewedPlan.discardCode ?? '无'" rows="5" /></label><label>捡回码<textarea readonly :value="viewedPlan.rescueCode ?? '无'" rows="5" /></label></div></section></div>
  <div v-if="filterOpen" class="modal-backdrop" @click.self="filterOpen = false" @keydown.esc="filterOpen = false"><section class="import-dialog rule-dialog" role="dialog" aria-modal="true" aria-labelledby="compare-filter-title"><header><h2 id="compare-filter-title">筛选御魂</h2><button class="icon-button" aria-label="关闭" @click="filterOpen = false"><X :size="18" /></button></header><div class="rule-form"><YuhunConditionEditor v-model="criteriaDraft" /></div><footer><button @click="criteriaDraft = emptyYuhunFilter()">重置</button><button class="primary" @click="applyFilter">应用</button></footer></section></div>
</template>

<style scoped>
.plan-compare-layout { display: grid; grid-template-columns: 270px minmax(0, 1fr); gap: 20px; align-items: start; }
.plan-library { background: white; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.plan-library > header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px; border-bottom: 1px solid var(--line); }
.plan-library h2 { font-size: 15px; }.plan-library h2 small { margin-left: 6px; color: var(--muted); font-weight: 400; }
.plan-library-search { display: flex; gap: 8px; align-items: center; padding: 10px 14px; }.plan-library-search input { width: 100%; min-width: 0; border: 0; background: transparent; }
.plan-library-list { max-height: 72vh; overflow: auto; }.saved-plan { padding: 14px; border-top: 1px solid var(--line); }.saved-plan.selected { background: #f2f7f5; }
.saved-plan-name { padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; font-weight: 600; overflow-wrap: anywhere; }.saved-plan-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; font-size: 11px; color: var(--muted); }
.saved-plan-select { display: flex; gap: 6px; margin-top: 12px; }.saved-plan-select button { flex: 1; padding: 5px; border: 1px solid var(--line); border-radius: 4px; background: white; font-size: 11px; }.saved-plan-select button.active { background: var(--green); color: white; border-color: var(--green); }
.saved-plan-actions { display: flex; justify-content: flex-end; gap: 5px; margin-top: 10px; }.saved-plan-actions .icon-button { width: 28px; height: 28px; }
.plan-comparison-main { min-width: 0; }.comparison-selectors { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: 12px; margin-bottom: 18px; }.comparison-selectors label { display: grid; gap: 7px; font-size: 12px; font-weight: 600; }.comparison-selectors select { width: 100%; min-width: 0; padding: 9px; }.comparison-selectors > button { margin-bottom: 2px; }
.comparison-counts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 20px; }.comparison-counts button { display: grid; gap: 9px; padding: 14px 10px; border: 1px solid var(--line); border-radius: 5px; background: white; text-align: left; }.comparison-counts button span { font-size: 11px; color: var(--muted); }.comparison-counts button strong { font-size: 24px; font-weight: 600; }.comparison-counts button.active { border-color: var(--green); background: var(--green-soft); }.comparison-counts button.discard.active { border-color: var(--red); background: #f9efed; }
.comparison-toolbar { flex-wrap: wrap; gap: 10px; }.comparison-filters { display: flex; gap: 8px; }.comparison-filters select { min-width: 100px; max-width: 190px; }.comparison-filters button.active { background: var(--green-soft); border-color: var(--green); }
.comparison-search { display: flex; gap: 8px; padding: 0 14px 12px; }.comparison-search input { min-width: 0; flex: 1; }.comparison-table { min-width: 970px; }.comparison-table td { white-space: nowrap; }.comparison-table .inventory-stat-list { min-width: 140px; }.difference-label { font-size: 11px; color: var(--muted); }.difference-label.extra-discard { color: var(--red); }.difference-label.extra-retain { color: var(--green); }
.comparison-error { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
.plan-import-dialog { width: min(660px, 100%); max-height: 90vh; overflow: auto; }.plan-rename-dialog { width: min(440px, 100%); }.plan-import-form { display: grid; gap: 16px; padding: 18px; }.plan-import-form label { display: grid; gap: 7px; font-size: 12px; font-weight: 600; }.plan-import-form textarea { width: 100%; padding: 10px; resize: vertical; }.plan-import-form button { justify-self: end; }
.plan-import-dialog .target-code-entry input,.plan-import-dialog .target-code-entry textarea { width: 100%; min-width: 0; }.plan-import-dialog .target-import-feedback { font-size: 11px; }.plan-import-dialog .target-import-feedback.success { color: var(--green); background: var(--green-soft); border-color: #b9cfcd; }
.plan-code-field { display: grid; gap: 8px; }.plan-code-field + .plan-code-field { padding-top: 12px; border-top: 1px solid var(--line); }
@media (max-width: 1100px) { .plan-compare-layout { grid-template-columns: 1fr; }.plan-library-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); max-height: 300px; }.saved-plan + .saved-plan { border-left: 1px solid var(--line); } }
@media (max-width: 640px) { .plan-library-list { grid-template-columns: 1fr; }.comparison-counts { grid-template-columns: repeat(2, minmax(0, 1fr)); }.comparison-selectors { gap: 7px; }.comparison-toolbar { align-items: flex-start; flex-direction: column; } }
</style>
