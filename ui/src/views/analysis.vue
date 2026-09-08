<script setup lang="ts">
import { computed, ref } from "vue";
import { GitCompareArrows, Play, RefreshCw } from "@lucide/vue";
import ExcelColumnFilter, { type ExcelFilterOption, type ExcelFilterValue } from "../components/ExcelColumnFilter.vue";
import { STAT_LABELS, type StatId, type YuhunDecisionRowDTO, type YuhunPotentialTarget } from "../../../src/browser.js";
import PotentialComparison from "../components/PotentialComparison.vue";
import { useWorkbenchStore } from "../store.js";

const store = useWorkbenchStore();
const yuhunSearch = ref("");
const potentialComparisonTargets = ref<readonly YuhunPotentialTarget[] | null>(null);
const potentialComparisonTitle = ref("");
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
const yuhunPositionFilter = ref<number[] | null>(null);
const yuhunStarFilter = ref<number[] | null>(null);
const yuhunLevelFilter = ref<number[] | null>(null);
const yuhunMainStatFilter = ref<StatId[] | null>(null);
const yuhunSubStatFilter = ref<StatId[] | null>(null);
const yuhunDispositionFilter = ref<Array<"discard" | "retain"> | null>(null);
const yuhunReasonFilter = ref<string[] | null>(null);

async function filterYuhun(page = 1): Promise<void> {
  await store.loadYuhunDecisions(page, {
    ...(yuhunSuitFilter.value === null ? {} : { suits: yuhunSuitFilter.value }),
    ...(yuhunPositionFilter.value === null ? {} : { positions: yuhunPositionFilter.value }),
    ...(yuhunStarFilter.value === null ? {} : { stars: yuhunStarFilter.value }),
    ...(yuhunLevelFilter.value === null ? {} : { levels: yuhunLevelFilter.value }),
    ...(yuhunMainStatFilter.value === null ? {} : { mainStats: yuhunMainStatFilter.value }),
    ...(yuhunSubStatFilter.value === null ? {} : { subStats: yuhunSubStatFilter.value }),
    ...(yuhunDispositionFilter.value === null ? {} : { dispositions: yuhunDispositionFilter.value }),
    ...(yuhunReasonFilter.value === null ? {} : { reasons: yuhunReasonFilter.value }),
    ...(yuhunSearch.value === "" ? {} : { search: yuhunSearch.value })
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

function potentialStrategyTags(row: YuhunDecisionRowDTO): string[] {
  const tags: string[] = [];
  for (const target of row.potentialTargets) {
    const label = target.strategy === "candidate-build"
      ? "候选组合"
      : target.strategy === "embryo-comparison"
        ? target.exactEmbryo ? "胚子对比" : "胚子属性类型对比"
        : target.statesEvaluated > 0 ? `强化上界 · ${target.statesEvaluated} 状态` : "强化上界";
    if (!tags.includes(label)) tags.push(label);
  }
  return tags;
}

function openPotentialComparison(row: YuhunDecisionRowDTO): void {
  potentialComparisonTargets.value = row.potentialTargets;
  potentialComparisonTitle.value = `${row.position}号 ${row.suit} · 可关联的阵容指标`;
}
</script>

<template>
  <section class="page-heading"><div><span class="eyebrow">03 / ANALYSIS</span><h1>分析结果</h1></div><div class="analysis-actions"><div class="segmented" aria-label="风险档位"><button :class="{ active: store.riskTier === 'tier0' }" @click="store.setRiskTier('tier0')">保守档</button><button :class="{ active: store.riskTier === 'tier1' }" @click="store.setRiskTier('tier1')">常规档</button></div><button class="primary" :disabled="!store.snapshot || !!store.busy" @click="store.runAnalysis"><RefreshCw v-if="store.analysis" :size="17" /><Play v-else :size="17" />{{ store.analysis ? '重新分析' : '运行分析' }}</button></div></section>

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
      <div class="section-toolbar"><div><h2>单件御魂决策</h2><span>{{ store.yuhunDecisions?.total ?? 0 }} 件御魂 · 表头可多选筛选</span></div><div class="filters"><input v-model="yuhunSearch" placeholder="套装 / 原因" @keyup.enter="filterYuhun()" /></div></div>
      <div class="table-wrap"><table class="excel-table"><thead><tr>
        <th v-for="column in yuhunFilterColumns" :key="column.key"><div class="excel-column-head"><span>{{ column.label }}</span><ExcelColumnFilter :label="column.label" :options="optionsFor(column.key)" :selected="selectedFor(column.key)" :open="activeYuhunFilter === column.key" @toggle-open="toggleYuhunFilterMenu(column.key)" @toggle="toggleYuhunFilter(column.key, $event)" @select-all="selectAllYuhunFilter(column.key)" @clear="clearYuhunFilter(column.key)" @apply="applyYuhunFilter" /></div></th>
        </tr></thead><tbody><tr v-for="row in store.yuhunDecisions?.rows" :key="row.row"><td>{{ row.suit }}</td><td>{{ row.position }}号</td><td>{{ row.star }}星</td><td>+{{ row.level }}</td><td>{{ STAT_LABELS[row.mainStat] }}</td><td>{{ row.subStats.map((stat) => STAT_LABELS[stat]).join(' / ') || '—' }}</td><td><span class="tag" :class="row.disposition === 'discard' ? 'danger-tag' : 'success-tag'">{{ row.disposition === 'discard' ? '弃置' : '保留' }}</span></td><td class="reason-cell"><code>{{ row.reason }}</code><div v-if="row.potentialTargets.length > 0" class="potential-strategy-tags"><span v-for="tag in potentialStrategyTags(row)" :key="tag" class="potential-strategy-tag">{{ tag }}</span><button class="potential-open" @click.stop="openPotentialComparison(row)"><GitCompareArrows :size="13" />查看对比</button></div></td></tr><tr v-if="store.yuhunDecisions?.rows.length === 0"><td colspan="8" class="empty-cell">没有符合当前筛选条件的御魂</td></tr></tbody></table></div>
      <div class="pagination"><button :disabled="(store.yuhunDecisions?.page ?? 1)<=1" @click.stop="filterYuhun((store.yuhunDecisions?.page ?? 1)-1)">上一页</button><span>{{ store.yuhunDecisions?.page ?? 1 }} / {{ Math.max(1,Math.ceil((store.yuhunDecisions?.total ?? 0)/30)) }}</span><button :disabled="(store.yuhunDecisions?.page ?? 1)*30 >= (store.yuhunDecisions?.total ?? 0)" @click.stop="filterYuhun((store.yuhunDecisions?.page ?? 1)+1)">下一页</button></div>
    </section>
  </template>
  <PotentialComparison v-if="potentialComparisonTargets" :targets="potentialComparisonTargets" :title="potentialComparisonTitle" @close="potentialComparisonTargets = null" />
</template>
