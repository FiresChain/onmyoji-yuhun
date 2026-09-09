<script setup lang="ts">
import { computed, ref } from "vue";
import { FileJson, SlidersHorizontal, Filter, Play, RefreshCw, X } from "@lucide/vue";
import { yuhunDisplayName, yuhunImage } from "../manual-target-config.js";
import YuhunSuitPicker from "../components/YuhunSuitPicker.vue";
import YuhunConditionEditor from "../components/YuhunConditionEditor.vue";
import { emptyYuhunFilter } from "../yuhun-filter.js";
import ExcelColumnFilter, { type ExcelFilterOption, type ExcelFilterValue } from "../components/ExcelColumnFilter.vue";
import { STAT_LABELS, type StatId, type YuhunDecisionRowDTO, type YuhunPotentialTarget } from "../../../src/browser.js";
import PotentialComparison from "../components/PotentialComparison.vue";
import { useWorkbenchStore } from "../store.js";

const store = useWorkbenchStore();
function formatStatValue(stat: StatId, value: number | undefined): string {
  if (value === undefined) return "—";
  const percent = ["attackPercent", "defensePercent", "hpPercent", "crit", "critDamage", "effectHit", "effectResist"].includes(stat);
  return `+${(percent ? value * 100 : value).toFixed(2).replace(/\.?0+$/, "")}${percent ? "%" : ""}`;
}
const potentialComparisonTargets = ref<readonly YuhunPotentialTarget[] | null>(null);
const potentialComparisonTitle = ref("");
const reasonDetail = ref<{ row: YuhunDecisionRowDTO; tag: string } | null>(null);
const detailRules = computed(() => (reasonDetail.value?.row.matchedRules ?? []).filter((rule) =>
  reasonDetail.value?.tag === "弃置捞回" || (reasonDetail.value?.tag === "强化规则" ? rule.pool === "enhance" : reasonDetail.value?.tag === "弃置规则" && rule.pool === "discard")
));
const actualTeamMetricCount = computed(() => store.teamCalculations.reduce((sum, report) => sum + report.entities.length, 0));
const actualTeamCalculationCount = computed(() => store.teamCalculations.length);

type YuhunFilterColumn = "suit" | "position" | "star" | "level" | "mainStat" | "subStat" | "disposition" | "reason";

const yuhunFilterColumns: readonly { key: YuhunFilterColumn; label: string }[] = [
  { key: "suit", label: "套装" },
  { key: "position", label: "位置" },
  { key: "star", label: "星级" },
  { key: "level", label: "等级" },
  { key: "mainStat", label: "主属性" },
  { key: "subStat", label: "副属性" },
  { key: "disposition", label: "决策" },
  { key: "reason", label: "原因" }
];

const activeYuhunFilter = ref<YuhunFilterColumn | null>(null);
const yuhunSuitFilter = ref<string[] | null>(null);
const inventoryFilterOpen = ref(false);
const inventoryCriteria = ref(emptyYuhunFilter());
const inventoryDraft = ref(emptyYuhunFilter());
const inventoryFiltered = computed(() => Object.values(inventoryCriteria.value).some(values => values.length > 0));
function openInventoryFilter(): void {
  closeYuhunFilterMenu();
  inventoryDraft.value = JSON.parse(JSON.stringify(inventoryCriteria.value));
  inventoryFilterOpen.value = true;
}
function resetInventoryFilter(): void { inventoryDraft.value = emptyYuhunFilter(); }
function applyInventoryFilter(): void {
  inventoryCriteria.value = JSON.parse(JSON.stringify(inventoryDraft.value));
  inventoryFilterOpen.value = false;
  void filterYuhun();
}
const yuhunPositionFilter = ref<number[] | null>(null);
const yuhunStarFilter = ref<number[] | null>(null);
const yuhunLevelFilter = ref<number[] | null>(null);
const yuhunMainStatFilter = ref<StatId[] | null>(null);
const yuhunSubStatFilter = ref<StatId[] | null>(null);
const yuhunDispositionFilter = ref<Array<"discard" | "retain"> | null>(null);
const yuhunReasonFilter = ref<string[] | null>(null);
const reasonMode = ref<"or" | "and">("or");

async function filterYuhun(page = 1): Promise<void> {
  await store.loadYuhunDecisions(page, {
    criteria: JSON.parse(JSON.stringify(inventoryCriteria.value)),
    ...(yuhunSuitFilter.value === null ? {} : { suits: yuhunSuitFilter.value }),
    ...(yuhunPositionFilter.value === null ? {} : { positions: yuhunPositionFilter.value }),
    ...(yuhunStarFilter.value === null ? {} : { stars: yuhunStarFilter.value }),
    ...(yuhunLevelFilter.value === null ? {} : { levels: yuhunLevelFilter.value }),
    ...(yuhunMainStatFilter.value === null ? {} : { mainStats: yuhunMainStatFilter.value }),
    ...(yuhunSubStatFilter.value === null ? {} : { subStats: yuhunSubStatFilter.value }),
    ...(yuhunDispositionFilter.value === null ? {} : { dispositions: yuhunDispositionFilter.value }),
    reasonMode: reasonMode.value,
    ...(yuhunReasonFilter.value === null && reasonMode.value === "or" ? {} : { reasons: yuhunReasonFilter.value ?? store.yuhunDecisionFacets?.reasons ?? [] }),
  });
}

function optionsFor(column: YuhunFilterColumn): readonly ExcelFilterOption[] {
  const facets = store.yuhunDecisionFacets;
  if (facets === null) return [];
  switch (column) {
    case "suit": return facets.suits.map((value) => ({ value, label: value }));
    case "position": return facets.positions.map((value) => ({ value, label: `${value}号` }));
    case "star": return facets.stars.map((value) => ({ value, label: `${value}星` }));
    case "level": return facets.levels.map((value) => ({ value, label: `+${value}` }));
    case "mainStat": return facets.mainStats.map((value) => ({ value, label: STAT_LABELS[value] }));
    case "subStat": return facets.subStats.map((value) => ({ value, label: STAT_LABELS[value] }));
    case "disposition": return facets.dispositions.map((value) => ({ value, label: value === "discard" ? "弃置" : "保留" }));
    case "reason": return facets.reasons.map((value) => ({ value, label: value }));
  }
}

function selectedFor(column: YuhunFilterColumn): readonly ExcelFilterValue[] | null {
  switch (column) {
    case "suit": return yuhunSuitFilter.value;
    case "position": return yuhunPositionFilter.value;
    case "star": return yuhunStarFilter.value;
    case "level": return yuhunLevelFilter.value;
    case "mainStat": return yuhunMainStatFilter.value;
    case "subStat": return yuhunSubStatFilter.value;
    case "disposition": return yuhunDispositionFilter.value;
    case "reason": return yuhunReasonFilter.value;
  }
}

function setSelectedFor(column: YuhunFilterColumn, values: readonly ExcelFilterValue[] | null): void {
  switch (column) {
    case "suit": yuhunSuitFilter.value = values as string[]; break;
    case "position": yuhunPositionFilter.value = values as number[]; break;
    case "star": yuhunStarFilter.value = values as number[]; break;
    case "level": yuhunLevelFilter.value = values as number[]; break;
    case "mainStat": yuhunMainStatFilter.value = values as StatId[]; break;
    case "subStat": yuhunSubStatFilter.value = values as StatId[]; break;
    case "disposition": yuhunDispositionFilter.value = values as Array<"discard" | "retain">; break;
    case "reason": yuhunReasonFilter.value = values as string[]; break;
  }
}

function toggleYuhunFilter(column: YuhunFilterColumn, value: ExcelFilterValue): void {
  const options = optionsFor(column).map((option) => option.value);
  const selected = selectedFor(column);
  const valueKey = (entry: ExcelFilterValue): string => `${typeof entry}:${String(entry)}`;
  const index = selected?.findIndex((entry) => valueKey(entry) === valueKey(value)) ?? -1;
  const next = selected === null
    ? options.filter((entry) => valueKey(entry) !== valueKey(value))
      : index === -1
      ? [...selected, value]
      : selected.filter((_, entryIndex) => entryIndex !== index);
  setSelectedFor(column, next.length === options.length ? null : next);
}

function selectAllYuhunFilter(column: YuhunFilterColumn): void {
  setSelectedFor(column, null);
}

function clearYuhunFilter(column: YuhunFilterColumn): void {
  setSelectedFor(column, []);
}

function applyYuhunFilter(): void {
  void filterYuhun();
  activeYuhunFilter.value = null;
}

function toggleYuhunFilterMenu(column: YuhunFilterColumn): void {
  if (activeYuhunFilter.value !== null && activeYuhunFilter.value !== column) void filterYuhun();
  activeYuhunFilter.value = activeYuhunFilter.value === column ? null : column;
}

function closeYuhunFilterMenu(): void {
  if (activeYuhunFilter.value !== null) void filterYuhun();
  activeYuhunFilter.value = null;
}

function openPotentialComparison(row: YuhunDecisionRowDTO): void {
  potentialComparisonTargets.value = row.potentialTargets;
  potentialComparisonTitle.value = `${row.position}号 ${row.suit} · 可提升的阵容评分`;
}
function openReason(row: YuhunDecisionRowDTO, tag: string): void {
  if (tag === "阵容提升") openPotentialComparison(row);
  else reasonDetail.value = { row, tag };
}
</script>

<template>
  <section class="page-heading"><div><span class="eyebrow">03 / ANALYSIS</span><h1>分析结果</h1></div><div class="analysis-actions"><label class="default-disposition">默认御魂处理<select :value="store.defaultDisposition" @change="store.setDefaultDisposition(($event.target as HTMLSelectElement).value as 'retain' | 'discard')"><option value="retain">保留</option><option value="discard">弃置</option></select></label><button class="primary" :disabled="!store.snapshot || !!store.busy" @click="store.runAnalysis"><RefreshCw v-if="store.analysis" :size="17" /><Play v-else :size="17" />{{ store.analysis ? '重新分析' : '运行分析' }}</button></div></section>

  <div v-if="store.enabledTeamTargets.length > 0 || actualTeamCalculationCount > 0" class="inline-warning team-calculation-pending">
    <template v-if="actualTeamCalculationCount > 0">已保存 {{ actualTeamCalculationCount }} 条完成阵容、{{ actualTeamMetricCount }} 个已计算式神指标；本次分析只读取这些搭配，不会重新计算或修改阵容结果。</template>
    <template v-else>当前没有完成的阵容计算结果；本次分析不会判断御魂是否可能提升阵容。</template>
  </div>
  <div v-if="store.enabledPresetRules.length > 0" class="inline-warning team-calculation-pending">已启用 {{ store.enabledPresetRules.length }} 条预置方案规则；命中规则会直接写入单件御魂原因。</div>

  <div v-if="!store.analysis" class="empty-state"><Play :size="32" /><strong>等待账号分析</strong><span>导入有效快照后即可运行；规则命中和阵容潜力会写入单件御魂原因。</span></div>
  <template v-else>
    <div class="metric-strip four capacity-strip" aria-label="御魂容量">
      <div data-testid="capacity-current-count"><span>当前六星御魂</span><strong>{{ store.analysis.inventoryCapacity.totalCount.toLocaleString() }}</strong></div>
      <div data-testid="capacity-limit"><span :title="`${store.analysis.inventoryCapacity.level15Count.toLocaleString()} 件 +15 御魂`">容量上限</span><strong>{{ store.analysis.inventoryCapacity.capacity.toLocaleString() }}</strong></div>
      <div data-testid="capacity-current-free"><span>当前空位</span><strong>{{ store.analysis.inventoryCapacity.overCapacityCount > 0 ? `超出 ${store.analysis.inventoryCapacity.overCapacityCount.toLocaleString()}` : store.analysis.inventoryCapacity.freeSlots.toLocaleString() }}</strong></div>
      <div data-testid="capacity-marked-discard"><span>标记弃置</span><strong>{{ store.analysis.markedDiscardProjection.discardCount.toLocaleString() }}</strong></div>
    </div>
    <section class="data-section yuhun-decision-section" @click="closeYuhunFilterMenu">
      <div class="section-toolbar"><div><h2>单件御魂决策</h2><span>{{ store.yuhunDecisions?.total ?? 0 }} 件御魂</span></div><div class="filters"><button class="inventory-filter-button" :class="{ active: inventoryFiltered }" :aria-pressed="inventoryFiltered" @click.stop="openInventoryFilter"><SlidersHorizontal :size="16" /><span>筛选</span><i v-if="inventoryFiltered" aria-label="已筛选" /></button></div></div>
      <div class="table-wrap"><table class="excel-table"><thead><tr>
        <th v-for="column in yuhunFilterColumns" :key="column.key"><div class="excel-column-head"><span>{{ column.label }}</span><ExcelColumnFilter v-if="column.key === 'disposition' || column.key === 'reason'" :match-mode="column.key === 'reason' ? reasonMode : undefined" @update:match-mode="reasonMode = $event" :label="column.label" :options="optionsFor(column.key)" :selected="selectedFor(column.key)" :open="activeYuhunFilter === column.key" @toggle-open="toggleYuhunFilterMenu(column.key)" @toggle="toggleYuhunFilter(column.key, $event)" @select-all="selectAllYuhunFilter(column.key)" @clear="clearYuhunFilter(column.key)" @apply="applyYuhunFilter" /></div></th>
        </tr></thead><tbody><tr v-for="row in store.yuhunDecisions?.rows" :key="row.row"><td><span class="inventory-suit"><img v-if="yuhunImage(row.suit)" :src="yuhunImage(row.suit)!" :alt="yuhunDisplayName(row.suit)" /><FileJson v-else :size="18" /><span>{{ yuhunDisplayName(row.suit) }}</span></span></td><td>{{ row.position }}号</td><td>{{ row.star }}星</td><td>+{{ row.level }}</td><td><div class="inventory-stat-list"><span class="inventory-stat"><small>{{ STAT_LABELS[row.mainStat] }}</small><strong>{{ formatStatValue(row.mainStat, row.mainValue) }}</strong></span><span v-for="stat in row.intrinsicStats" :key="stat.stat" class="inventory-stat intrinsic"><small>{{ STAT_LABELS[stat.stat] }}</small><strong>{{ formatStatValue(stat.stat, stat.value) }}</strong></span></div></td><td><div class="inventory-stat-list"><span v-for="stat in row.subStats" :key="stat" class="inventory-stat"><small>{{ STAT_LABELS[stat] }}</small><strong>{{ formatStatValue(stat, row.subStatValues?.find(entry => entry.stat === stat)?.value) }}</strong></span></div></td><td><span class="tag" :class="row.disposition === 'discard' ? 'danger-tag' : 'success-tag'">{{ row.disposition === 'discard' ? '弃置' : '保留' }}</span></td><td class="reason-cell"><div class="potential-strategy-tags"><button v-for="tag in row.reasonTags ?? [row.reason]" :key="tag" class="potential-open" @click.stop="openReason(row, tag)">{{ tag }}</button></div></td></tr><tr v-if="store.yuhunDecisions?.rows.length === 0"><td colspan="8" class="empty-cell">没有符合当前筛选条件的御魂</td></tr></tbody></table></div>
      <div class="pagination"><button :disabled="(store.yuhunDecisions?.page ?? 1)<=1" @click.stop="filterYuhun((store.yuhunDecisions?.page ?? 1)-1)">上一页</button><span>{{ store.yuhunDecisions?.page ?? 1 }} / {{ Math.max(1,Math.ceil((store.yuhunDecisions?.total ?? 0)/30)) }}</span><button :disabled="(store.yuhunDecisions?.page ?? 1)*30 >= (store.yuhunDecisions?.total ?? 0)" @click.stop="filterYuhun((store.yuhunDecisions?.page ?? 1)+1)">下一页</button></div>
    </section>
  </template>
  <PotentialComparison v-if="potentialComparisonTargets" :targets="potentialComparisonTargets" :title="potentialComparisonTitle" @close="potentialComparisonTargets = null" />
  <div v-if="inventoryFilterOpen" class="modal-backdrop" @click.self="inventoryFilterOpen = false" @keydown.esc="inventoryFilterOpen = false">
    <section class="import-dialog rule-dialog" role="dialog" aria-modal="true" aria-labelledby="inventory-filter-title">
      <header><h2 id="inventory-filter-title">筛选御魂</h2><button class="icon-button" aria-label="关闭" @click="inventoryFilterOpen = false"><X :size="18" /></button></header>
      <div class="rule-form">
        <YuhunConditionEditor v-model="inventoryDraft" />
      </div>
      <footer><button @click="resetInventoryFilter">重置</button><button class="primary" @click="applyInventoryFilter">应用</button></footer>
    </section>
  </div>
  <div v-if="reasonDetail" class="modal-backdrop" @click.self="reasonDetail = null" @keydown.esc="reasonDetail = null">
    <section class="reason-dialog" role="dialog" aria-modal="true" aria-labelledby="reason-title" tabindex="-1">
      <header><h2 id="reason-title">{{ reasonDetail.tag }}</h2><button autofocus aria-label="关闭" @click="reasonDetail = null"><X :size="18" /></button></header>
      <p>{{ reasonDetail.row.position }}号 {{ reasonDetail.row.suit }} · {{ reasonDetail.row.disposition === 'retain' ? '保留' : '弃置' }}</p>
      <p v-if="reasonDetail.tag === '已锁定'">御魂已锁定，优先保留。</p>
      <p v-else-if="reasonDetail.tag.startsWith('默认')">未命中强化或弃置规则，且无阵容提升证据，按本次分析的默认御魂处理设置{{ reasonDetail.row.disposition === 'retain' ? '保留' : '弃置' }}。</p>
      <p v-else-if="reasonDetail.tag === '弃置捞回'">同时命中两类规则，强化规则优先，保留该御魂。</p>
      <p v-else-if="reasonDetail.tag === '弃置规则' && reasonDetail.row.potentialTargets.length">命中弃置规则，但存在阵容提升证据，因此保留。</p>
      <article v-for="rule in detailRules" :key="rule.id" class="reason-rule">
        <h3>{{ rule.pool === 'enhance' ? '强化规则' : '弃置规则' }} · {{ rule.label }}</h3>
        <dl>
          <dt>套装</dt><dd>{{ rule.criteria.types.join('、') || '不限' }}</dd>
          <dt>位置</dt><dd>{{ rule.criteria.positions.join('、') || '不限' }}</dd>
          <dt>星级</dt><dd>{{ rule.criteria.stars.join('、') || '不限' }}</dd>
          <dt>等级</dt><dd>{{ rule.criteria.levelRanges.join('、') || '不限' }}</dd>
          <dt>主属性</dt><dd>{{ rule.criteria.mainStats.map(stat => STAT_LABELS[stat]).join('、') || '不限' }}</dd>
          <dt>副属性</dt><dd>{{ rule.criteria.subStats.map(stat => `${stat.requirement === 'include' ? '包含' : '排除'}${STAT_LABELS[stat.stat]}`).join('、') || '不限' }}</dd>
          <dt>副属性条数</dt><dd>{{ rule.criteria.subStatCounts.map(count => count === 'lessThan2' ? '不足2条' : `${count}条`).join('、') || '不限' }}</dd>
          <dt>固有属性</dt><dd>{{ rule.criteria.intrinsicStats.map(stat => STAT_LABELS[stat]).join('、') || '不限' }}</dd>
        </dl>
      </article>
    </section>
  </div>
</template>

<style scoped>
.inventory-filter-button { display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 12px; border: 1px solid #c7d0d0; border-radius: 4px; background: #fff; color: #334746; font-size: 12px; }
.inventory-filter-button:hover, .inventory-filter-button.active { background: #e8f1ef; border-color: #638d85; }
.inventory-filter-button i { width: 6px; height: 6px; border-radius: 50%; background: #357264; }
.default-disposition { display: flex; align-items: center; gap: 8px; }
.default-disposition select { min-width: 80px; }
.reason-dialog { background: white; color: #252525; width: min(560px, calc(100vw - 32px)); max-height: 85vh; overflow: auto; padding: 20px; border-radius: 8px; }
.reason-dialog header { display: flex; align-items: center; justify-content: space-between; }
.reason-dialog h2 { font-size: 18px; margin: 0; }
.reason-dialog h3 { font-size: 15px; overflow-wrap: anywhere; }
.reason-rule { border-top: 1px solid #ddd; margin-top: 16px; }
.reason-rule dl { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 8px; font-size: 14px; }
.reason-rule dd { margin: 0; overflow-wrap: anywhere; }
</style>
