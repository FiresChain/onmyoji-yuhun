<script setup lang="ts">
import { computed, ref } from "vue";
import { X } from "@lucide/vue";
import { STAT_LABELS, type YuhunPotentialPieceDTO, type YuhunPotentialTarget } from "../../../src/browser.js";
import { shikigamiByHeroId } from "../manual-target-config.js";

const props = withDefaults(defineProps<{ targets: readonly YuhunPotentialTarget[]; title?: string; compact?: boolean; referenceTitle?: string }>(), { compact: false });
const emit = defineEmits<{ close: [] }>();
const selectedIndex = ref(0);
const selected = computed(() => props.targets[selectedIndex.value] ?? null);
const leftItem = computed(() => selected.value === null ? null : props.compact ? selected.value.reference : selected.value.candidate);
const rightItem = computed(() => selected.value === null ? null : props.compact ? selected.value.candidate : selected.value.reference);
const leftTitle = computed(() => props.compact ? props.referenceTitle ?? "当前装配御魂" : "候选御魂");
const rightTitle = computed(() => props.compact ? "候选御魂" : props.referenceTitle ?? "最优搭配 · 对应位置");
const percentageStats = new Set(["attackPercent", "defensePercent", "hpPercent", "crit", "critDamage", "effectHit", "effectResist"]);

function statValue(stat: string, value: number): string {
  const percent = percentageStats.has(stat);
  const display = percent ? value * 100 : value;
  return `${display >= 0 ? "+" : ""}${display.toFixed(2).replace(/\.?0+$/, "")}${percent ? "%" : ""}`;
}

function rowValue(item: YuhunPotentialPieceDTO | null, label: string): string {
  return detailRows(item).find((row) => row.label === label)?.value ?? "—";
}

function different(item: YuhunPotentialPieceDTO | null, other: YuhunPotentialPieceDTO | null, label: string): boolean {
  return item !== null && other !== null && rowValue(item, label) !== rowValue(other, label);
}

function detailRows(item: YuhunPotentialPieceDTO | null): Array<{ label: string; value: string }> {
  if (item === null) return [];
  return [
    { label: "位置", value: `${item.position}号` },
    { label: "套装", value: item.suit },
    { label: "星级", value: `${item.star}星` },
    { label: "等级", value: `+${item.level}` },
    { label: "主属性", value: `${STAT_LABELS[item.mainStat]} ${"mainValue" in item && item.mainValue !== undefined ? statValue(item.mainStat, item.mainValue) : ""}` },
    ...(item.intrinsicStats?.map((entry) => ({ label: `固有属性 · ${STAT_LABELS[entry.stat]}`, value: statValue(entry.stat, entry.value) })) ?? []),
    ...(item.subStats?.map((entry) => ({ label: `副属性 · ${STAT_LABELS[entry.stat]}`, value: statValue(entry.stat, entry.value) })) ?? [])
  ];
}

const comparisonRows = computed(() => {
  const rows = new Map<string, { label: string; value: string }>();
  for (const row of [...detailRows(leftItem.value), ...detailRows(rightItem.value)]) rows.set(row.label, row);
  return [...rows.values()];
});

function strategyLabel(target: YuhunPotentialTarget): string {
  if (target.strategy === "candidate-build") return "候选组合";
  if (target.strategy === "embryo-comparison") return target.exactEmbryo ? "胚子对比" : "胚子属性类型对比";
  return target.statesEvaluated > 0 ? `强化上界 · ${target.statesEvaluated} 状态` : "强化上界";
}

function displayShikigamiName(target: YuhunPotentialTarget): string {
  const raw = target.shikigamiName.trim();
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  return id === null ? raw || "未知式神" : shikigamiByHeroId(id)?.name ?? "未知式神";
}

function displayTeamLabel(target: YuhunPotentialTarget): string | null {
  return /^\d+$/.test(target.teamLabel.trim()) ? null : target.teamLabel;
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <section class="import-dialog potential-comparison-dialog" :class="{ compact: props.compact }" role="dialog" aria-modal="true" aria-labelledby="potential-comparison-title">
      <header><div><span class="eyebrow">潜力关联</span><h2 id="potential-comparison-title">{{ title ?? '御魂与阵容指标对比' }}</h2></div><button class="icon-button" aria-label="关闭" @click="emit('close')"><X :size="17" /></button></header>
      <div class="potential-comparison-content">
        <div v-if="!props.compact" class="potential-target-list">
          <button v-for="(target, index) in targets" :key="`${target.teamLabel}-${target.shikigamiName}-${target.metricName}-${target.strategy}-${index}`" :class="{ active: selectedIndex === index }" @click="selectedIndex = index">
            <strong>{{ displayShikigamiName(target) }}</strong><span>{{ target.metricName }}</span><small><template v-if="displayTeamLabel(target)">{{ displayTeamLabel(target) }} · </template>{{ strategyLabel(target) }}<template v-if="target.position"> · {{ target.position }}号</template></small>
          </button>
        </div>
        <template v-if="selected">
          <div class="potential-comparison-meta"><span>{{ strategyLabel(selected) }}</span><span v-if="selected.upperScore !== null">候选评分 {{ selected.upperScore.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</span><span v-if="selected.baselineScore !== null">参考评分 {{ selected.baselineScore.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</span></div>
          <div v-if="leftItem || rightItem" class="potential-diff-grid">
            <article><h3>{{ leftTitle }}</h3><div v-for="row in comparisonRows" :key="row.label" class="potential-diff-row" :class="{ changed: different(leftItem, rightItem, row.label) }"><span>{{ row.label }}</span><strong>{{ rowValue(leftItem, row.label) }}</strong></div><p v-if="!leftItem">旧报告未保存候选属性，请重新计算阵容。</p></article>
            <article><h3>{{ rightTitle }}</h3><div v-for="row in comparisonRows" :key="row.label" class="potential-diff-row" :class="{ changed: different(rightItem, leftItem, row.label) }"><span>{{ row.label }}</span><strong>{{ rowValue(rightItem, row.label) }}</strong></div><p v-if="!rightItem">该证据没有可对应的最优搭配位置（通常是候选组合）。</p></article>
          </div>
          <p v-else class="potential-comparison-empty">旧报告没有保存御魂明细，请重新计算阵容后再查看对比。</p>
        </template>
      </div>
    </section>
  </div>
</template>
