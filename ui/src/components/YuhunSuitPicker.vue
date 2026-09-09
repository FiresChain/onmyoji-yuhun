<script setup lang="ts">
import { computed, ref } from "vue";
import { Check, Search, X } from "@lucide/vue";
import { YUHUN_CATEGORY_OPTIONS, yuhunCategory, yuhunImage, yuhunPlaceholder } from "../manual-target-config.js";
const props = defineProps<{ options: readonly string[]; selected: readonly string[]; filter?: boolean }>();
const emit = defineEmits<{ change: [values: string[]]; close: []; apply: [] }>();
const search = ref("");
const category = ref("全部");
const visible = computed(() => props.options.filter(name => (category.value === "全部" || yuhunCategory(name) === category.value) && name.includes(search.value.trim())));
function toggle(name: string): void {
  emit("change", props.selected.includes(name) ? props.selected.filter(value => value !== name) : [...props.selected, name]);
}
</script>

<template>
  <div class="modal-backdrop rule-yuhun-picker-overlay" @click.self="emit('close')" @keydown.esc="emit('close')">
    <section class="rule-yuhun-picker" role="dialog" aria-modal="true" aria-label="选择御魂套装">
      <header><div><span>多选</span><h3>选择御魂套装</h3></div><button class="icon-button" aria-label="关闭御魂套装选择" @click="emit('close')"><X :size="18" /></button></header>
      <div class="rule-yuhun-picker-body">
        <nav class="rule-yuhun-categories" aria-label="御魂分类"><button v-for="value in YUHUN_CATEGORY_OPTIONS" :key="value" :class="{ active: category === value }" @click="category = value">{{ value }}</button></nav>
        <div class="rule-yuhun-results">
          <label class="rule-yuhun-search"><Search :size="16" /><input v-model="search" autofocus placeholder="搜索御魂套装" /></label>
          <div class="rule-yuhun-grid" data-testid="rule-yuhun-grid"><button v-for="name in visible" :key="name" :class="{ selected: selected.includes(name) }" :aria-pressed="selected.includes(name)" @click="toggle(name)"><span class="rule-yuhun-image"><img v-if="yuhunImage(name)" :src="yuhunImage(name)!" :alt="name" /><span v-else>{{ yuhunPlaceholder(name) }}</span></span><span><strong>{{ name }}</strong><small>{{ yuhunCategory(name) }}</small></span><Check v-if="selected.includes(name)" :size="15" /></button></div>
          <div v-if="visible.length === 0" class="rule-yuhun-no-result">没有匹配的御魂套装</div>
        </div>
      </div>
      <footer><span>已选择 {{ selected.length }} 个御魂套装</span><div><button @click="emit('change', [...options])">全选</button><button @click="emit('change', [])">清空</button><button class="primary" @click="emit('apply')">{{ filter ? '应用' : '完成' }}</button></div></footer>
    </section>
  </div>
</template>
