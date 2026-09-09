<script setup lang="ts">
import { computed, ref } from "vue";
import { X } from "@lucide/vue";
import { STAT_LABELS, type YuhunPotentialPieceDTO, type YuhunPotentialTarget } from "../../../src/browser.js";
import { shikigamiByHeroId, shikigamiImage, yuhunImage } from "../manual-target-config.js";
import { useWorkbenchStore } from "../store.js";

const props = withDefaults(defineProps<{ targets: readonly YuhunPotentialTarget[]; title?: string; compact?: boolean; referenceTitle?: string }>(), { compact: false });
const emit = defineEmits<{ close: [] }>();
const selectedIndex = ref(0);
const selected = computed(() => props.targets[selectedIndex.value] ?? null);
const store = useWorkbenchStore();
const teamKey = (target: YuhunPotentialTarget): string => target.teamId ?? target.teamLabel;
const teams = computed(() => [...new Map(props.targets.map(target => [teamKey(target), target])).values()]);
const report = computed(() => store.teamCalculations.find(report => selected.value?.teamId ? report.id === selected.value.teamId : report.label === selected.value?.teamLabel));
const entity = computed(() => report.value?.entities.find(entity => selected.value?.entityIndex !== undefined ? entity.entityIndex === selected.value.entityIndex : entity.shikigamiName === selected.value?.shikigamiName));
const teamTargets = computed(() => props.targets.filter(target => selected.value && teamKey(target) === teamKey(selected.value)));
function memberTargets(index: number) {
  return teamTargets.value.filter(target => target.entityIndex !== undefined ? target.entityIndex === index : target.shikigamiName === report.value?.entities.find(member => member.entityIndex === index)?.shikigamiName);
}
function selectTarget(target: YuhunPotentialTarget): void { selectedIndex.value = props.targets.indexOf(target); }
function selectPosition(position: number): void {
  const target = memberTargets(entity.value?.entityIndex ?? -1).find(target => target.position === position);
  if (target) selectTarget(target);
}
function memberName(member: { shikigamiName: string; shikigamiId: number | null }): string {
  return /^\d+$/.test(member.shikigamiName) ? shikigamiByHeroId(member.shikigamiId ?? Number(member.shikigamiName))?.name ?? "未知式神" : member.shikigamiName;
}
const leftItem = computed(() => selected.value === null ? null : selected.value.reference);
const rightItem = computed(() => selected.value === null ? null : selected.value.candidate);
const leftTitle = computed(() => props.referenceTitle ?? "当前装配御魂");
const rightTitle = computed(() => "候选御魂");
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
          <button v-for="target in teams" :key="teamKey(target)" :class="{ active: selected && teamKey(selected) === teamKey(target) }" @click="selectTarget(target)">
            <strong>{{ displayTeamLabel(target) ?? '未命名队伍' }}</strong>
          </button>
        </div>
        <template v-if="selected">
          <nav v-if="!props.compact && report" class="potential-roster" aria-label="队伍式神">
            <button v-for="member in report.entities" :key="member.entityIndex" :class="{ hit: memberTargets(member.entityIndex).length, active: member.entityIndex === entity?.entityIndex }" :disabled="!memberTargets(member.entityIndex).length" @click="selectTarget(memberTargets(member.entityIndex)[0]!)"><img v-if="shikigamiImage(member.shikigamiId ?? 0)" :src="shikigamiImage(member.shikigamiId ?? 0)!" :alt="memberName(member)" /><strong>{{ memberName(member) }}</strong></button>
          </nav>
          <section v-if="!props.compact && entity" class="potential-wheel yuhun-wheel-panel">
            <div class="yuhun-wheel">
              <button v-for="position in 6" :key="position" class="yuhun-wheel-slot" :class="[`position-${position}`, { active: memberTargets(entity.entityIndex).some(target => target.position === position), current: selected.position === position }]" :aria-label="`${position}号御魂`" @click="selectPosition(position)">
                <template v-for="piece in [entity.pieces.find(piece => piece.position === position)]" :key="position"><img v-if="piece && yuhunImage(piece.suit)" :src="yuhunImage(piece.suit)!" :alt="piece.suit" /><span v-else>{{ position }}</span><small>{{ position }}号<template v-if="piece"> · +{{ piece.level }}</template></small></template>
              </button>
              <div class="yuhun-wheel-center"><img v-if="shikigamiImage(entity.shikigamiId ?? 0)" :src="shikigamiImage(entity.shikigamiId ?? 0)!" :alt="memberName(entity)" /><strong>{{ memberName(entity) }}</strong></div>
            </div>
            <div class="yuhun-build-summary"><span><small>{{ entity.metricName }}</small><strong>{{ entity.score?.toLocaleString() ?? '—' }}</strong></span><span><small>套装</small><strong>{{ [...new Set(entity.pieces.map(piece => piece.suit))].join(' + ') }}</strong></span></div>
          </section>
          <div class="potential-comparison-meta"><span>{{ strategyLabel(selected) }}</span><span v-if="selected.upperScore !== null">候选评分 {{ selected.upperScore.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</span><span v-if="selected.baselineScore !== null">参考评分 {{ selected.baselineScore.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</span></div>
          <div v-if="leftItem || rightItem" class="potential-diff-grid">
            <article><h3>{{ leftTitle }}</h3><div v-for="row in comparisonRows" :key="row.label" class="potential-diff-row" :class="{ changed: different(leftItem, rightItem, row.label) }"><span>{{ row.label }}</span><strong>{{ rowValue(leftItem, row.label) }}</strong></div><p v-if="!leftItem">该证据没有对应的装配御魂明细。</p></article>
            <article><h3>{{ rightTitle }}</h3><div v-for="row in comparisonRows" :key="row.label" class="potential-diff-row" :class="{ changed: different(rightItem, leftItem, row.label) }"><span>{{ row.label }}</span><strong>{{ rowValue(rightItem, row.label) }}</strong></div><p v-if="!rightItem">旧报告未保存候选属性，请重新计算阵容。</p></article>
          </div>
          <p v-else class="potential-comparison-empty">旧报告没有保存御魂明细，请重新计算阵容后再查看对比。</p>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.potential-comparison-dialog:not(.compact) { width: min(1280px, calc(100vw - 24px)); }
.potential-comparison-dialog:not(.compact) .potential-comparison-content { grid-template-columns: 190px minmax(300px, .9fr) minmax(400px, 1.1fr); grid-template-rows: auto auto 1fr; align-items: start; }
.potential-target-list { grid-column: 1; grid-row: 1 / 4; }
.potential-target-list strong { white-space: normal; overflow-wrap: anywhere; font-size: 12px; }
.potential-roster { grid-column: 2 / 4; grid-row: 1; display: flex; gap: 6px; overflow-x: auto; padding: 3px; }
.potential-roster button { flex: 0 0 115px; min-height: 62px; display: flex; align-items: center; gap: 6px; padding: 8px; border: 1px solid #ccc; border-radius: 3px; font-size: 11px; }
.potential-roster button.hit { color: #244e4b; border-color: #83a9a4; background: #e3f0ed; }
.potential-roster button.active { outline: 2px solid #3f806f; }
.potential-roster img { width: 32px; height: 32px; object-fit: cover; border-radius: 50%; }
.potential-roster button:disabled { opacity: .65; }
.potential-wheel { grid-column: 2; grid-row: 2 / 4; min-height: 390px; width: 100%; padding: 24px 12px; }
.potential-wheel .yuhun-wheel { width: 280px; max-width: 90%; }
.potential-wheel .yuhun-wheel-center { width: 86px; height: 105px; }
.potential-wheel .yuhun-wheel-slot { width: 56px; height: 56px; }
.potential-wheel .current { outline: 2px solid #fff; }
.potential-comparison-dialog:not(.compact) .potential-comparison-meta { grid-column: 3; grid-row: 2; }
.potential-comparison-dialog:not(.compact) .potential-diff-grid { grid-column: 3; grid-row: 3; }
@media (max-width: 1000px) {
  .potential-comparison-dialog:not(.compact) .potential-comparison-content { grid-template-columns: 160px minmax(0, 1fr); grid-template-rows: auto auto auto auto; }
  .potential-roster { grid-column: 2; }
  .potential-wheel { grid-column: 2; grid-row: 2; }
  .potential-comparison-dialog:not(.compact) .potential-comparison-meta { grid-column: 2; grid-row: 3; }
  .potential-comparison-dialog:not(.compact) .potential-diff-grid { grid-column: 2; grid-row: 4; }
}
@media (max-width: 600px) {
  .potential-comparison-dialog:not(.compact) .potential-comparison-content { display: flex; flex-direction: column; }
  .potential-target-list, .potential-roster, .potential-diff-grid { width: 100%; }
}
</style>
