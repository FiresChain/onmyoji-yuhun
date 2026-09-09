<script setup lang="ts">
import { computed, ref } from "vue";
import { Circle, Plus, X } from "@lucide/vue";
import { STAT_LABELS, YUHUN_TYPES, type FilterCriteria, type StatId, type SubStatRequirement } from "../../../src/browser.js";
import { yuhunCategory, yuhunImage, yuhunDisplayName } from "../manual-target-config.js";
import RuleOptionGroup from "./RuleOptionGroup.vue";
import YuhunSuitPicker from "./YuhunSuitPicker.vue";
const props = defineProps<{ modelValue: FilterCriteria }>();
const emit = defineEmits<{ 'update:modelValue': [value: FilterCriteria] }>();
const pickerOpen = ref(false);
const stats = Object.entries(STAT_LABELS).map(([value, label]) => ({ value: value as StatId, label }));
const levels = ['0-2', '3-5', '6-8', '9-11', '12-14', '15'].map(value => ({ value, label: value }));
const numbers = (suffix: string) => Array.from({ length: 6 }, (_, index) => ({ value: index + 1, label: `${index + 1}${suffix}` }));
const intrinsic = stats.filter(stat => ['attackPercent', 'defensePercent', 'hpPercent', 'effectHit', 'effectResist', 'crit'].includes(stat.value));
const hasBoss = computed(() => props.modelValue.types.some(name => yuhunCategory(name) === '首领御魂'));
function setTypes(types: string[]): void {
  emit('update:modelValue', { ...props.modelValue, types, intrinsicStats: types.some(name => yuhunCategory(name) === '首领御魂') ? props.modelValue.intrinsicStats : [] });
}
function toggle(key: 'positions' | 'stars' | 'mainStats' | 'levelRanges' | 'intrinsicStats' | 'subStatCounts', value: string | number): void {
  const values: readonly (string | number)[] = props.modelValue[key];
  emit('update:modelValue', { ...props.modelValue, [key]: values.includes(value) ? values.filter(item => item !== value) : [...values, value] });
}
function subStat(stat: StatId, requirement: SubStatRequirement): void {
  const old = props.modelValue.subStats.find(entry => entry.stat === stat);
  emit('update:modelValue', { ...props.modelValue, subStats: [...props.modelValue.subStats.filter(entry => entry.stat !== stat), ...(old?.requirement === requirement ? [] : [{ stat, requirement }])] });
}
</script>
<template>
  <section class="rule-field rule-yuhun-field"><div class="rule-yuhun-summary"><strong>御魂套装</strong><button type="button" data-testid="open-rule-yuhun-picker" @click="pickerOpen = true"><Plus :size="15" />选择御魂</button></div><div class="rule-selected-yuhun"><span v-if="!modelValue.types.length">全部御魂套装</span><span v-for="name in modelValue.types" :key="name"><img v-if="yuhunImage(name)" :src="yuhunImage(name)!" :alt="yuhunDisplayName(name)" /><strong>{{ yuhunDisplayName(name) }}</strong></span></div></section>
  <RuleOptionGroup label="位置" :options="numbers('号')" :selected="modelValue.positions" @toggle="toggle('positions', $event)" />
  <RuleOptionGroup label="星级" :options="numbers('星')" :selected="modelValue.stars" @toggle="toggle('stars', $event)" />
  <RuleOptionGroup label="等级" :options="levels" :selected="modelValue.levelRanges" @toggle="toggle('levelRanges', $event)" />
  <RuleOptionGroup label="主属性" :options="stats" :selected="modelValue.mainStats" @toggle="toggle('mainStats', $event)" />
  <fieldset class="rule-field" :disabled="!hasBoss" data-testid="rule-intrinsic-field"><legend>固有属性（首领御魂）</legend><div class="option-grid"><label v-for="stat in intrinsic" :key="stat.value"><input type="checkbox" :checked="modelValue.intrinsicStats.includes(stat.value as FilterCriteria['intrinsicStats'][number])" @change="toggle('intrinsicStats', stat.value)" /><span>{{ stat.label }}</span></label></div></fieldset>
  <section class="rule-field"><strong>副属性</strong><div class="rule-sub-stat-grid"><div v-for="stat in stats" :key="stat.value" class="rule-sub-stat-option"><span>{{ stat.label }}</span><button v-for="requirement in (['include', 'exclude'] as const)" :key="requirement" type="button" :class="{ selected: modelValue.subStats.some(entry => entry.stat === stat.value && entry.requirement === requirement) }" :aria-pressed="modelValue.subStats.some(entry => entry.stat === stat.value && entry.requirement === requirement)" :title="`${stat.label}：${requirement === 'include' ? '必须有' : '必须没有'}`" :aria-label="`${stat.label}：${requirement === 'include' ? '必须有' : '必须没有'}`" @click="subStat(stat.value, requirement)"><Circle v-if="requirement === 'include'" :size="14" /><X v-else :size="15" /></button></div></div></section>
  <RuleOptionGroup label="副属性数量" :options="[{ value: 'lessThan2', label: '不足2条' }, ...['2', '3', '4'].map(value => ({ value, label: `${value}条` }))]" :selected="modelValue.subStatCounts" @toggle="toggle('subStatCounts', $event)" />
  <YuhunSuitPicker v-if="pickerOpen" :options="YUHUN_TYPES" :selected="modelValue.types" @change="setTypes" @close="pickerOpen = false" @apply="pickerOpen = false" />
</template>
