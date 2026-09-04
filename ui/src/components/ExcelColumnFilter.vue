<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Check, Filter, X } from "@lucide/vue";

export type ExcelFilterValue = string | number;

export interface ExcelFilterOption {
  readonly value: ExcelFilterValue;
  readonly label: string;
}

const props = defineProps<{
  readonly label: string;
  readonly options: readonly ExcelFilterOption[];
  /** null means no filter; an empty array means explicitly no values selected. */
  readonly selected: readonly ExcelFilterValue[] | null;
  readonly open: boolean;
}>();

const emit = defineEmits<{
  (event: "toggle-open"): void;
  (event: "toggle", value: ExcelFilterValue): void;
  (event: "clear"): void;
  (event: "select-all"): void;
  (event: "apply"): void;
}>();

const search = ref("");

watch(() => props.open, (open) => {
  if (open) search.value = "";
});

const visibleOptions = computed(() => {
  const needle = search.value.trim().toLocaleLowerCase();
  if (needle === "") return props.options;
  return props.options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
});

function valueKey(value: ExcelFilterValue): string {
  return `${typeof value}:${String(value)}`;
}

function isSelected(value: ExcelFilterValue): boolean {
  return props.selected === null || props.selected.some((selected) => valueKey(selected) === valueKey(value));
}

function isFiltered(): boolean {
  return props.selected !== null;
}
</script>

<template>
  <div class="excel-filter">
    <button
      class="excel-filter-trigger"
      :class="{ active: isFiltered(), open }"
      type="button"
      :title="`筛选${label}`"
      :aria-label="`筛选${label}`"
      :aria-expanded="open"
      @click.stop="emit('toggle-open')"
    >
      <Filter :size="13" />
      <span v-if="isFiltered()">{{ selected?.length ?? 0 }}</span>
    </button>

    <div v-if="open" class="excel-filter-menu" @click.stop>
      <header>
        <strong>{{ label }}</strong>
        <button class="icon-button" type="button" title="应用并关闭" @click="emit('apply')"><X :size="14" /></button>
      </header>
      <div class="excel-filter-search"><input v-model="search" :placeholder="`搜索${label}`" autofocus /></div>
      <div class="excel-filter-actions">
        <button type="button" @click="emit('select-all')"><Check :size="12" />全选</button>
        <button type="button" @click="emit('clear')">清空</button>
      </div>
      <div class="excel-filter-options">
        <label v-for="option in visibleOptions" :key="valueKey(option.value)" class="excel-filter-option">
          <input type="checkbox" :checked="isSelected(option.value)" @change="emit('toggle', option.value)" />
          <span>{{ option.label }}</span>
        </label>
        <span v-if="visibleOptions.length === 0" class="excel-filter-empty">没有匹配选项</span>
      </div>
      <footer>
        <button type="button" @click="emit('select-all'); emit('apply')">全部显示</button>
        <button class="primary" type="button" @click="emit('apply')">应用</button>
      </footer>
    </div>
  </div>
</template>
