<script setup lang="ts">
import { computed } from "vue";
import { CheckCircle2, Download, Smartphone, Upload } from "@lucide/vue";
import { useWorkbenchStore } from "../store.js";

const store = useWorkbenchStore();
const completed = computed(() => store.reconciliationComplete);

async function importFile(files: FileList | null): Promise<void> {
  const file = files?.[0];
  if (file !== undefined) await store.importHandoff(file);
}
</script>

<template>
  <section class="page-heading"><div><span class="eyebrow">05 / RECONCILE</span><h1>游戏对账</h1></div><span class="tag" :class="completed ? 'success-tag' : 'warning-tag'"><CheckCircle2 :size="14" />{{ completed ? '本次实机对账完成' : '等待实际命中数' }}</span></section>

  <div v-if="!store.checklist" class="handoff-import"><Smartphone :size="32" /><strong>导入手机私有交接包</strong><span>桌面生成的交接包包含 D/E 码、聚合结果和清单，不包含快照与御魂 ID。</span><label class="primary"><Upload :size="17" />选择交接包<input type="file" accept="application/json,.json" @change="importFile(($event.target as HTMLInputElement).files)" /></label></div>

  <template v-else>
    <div class="reconcile-summary"><div><span>预计最终新弃置</span><strong>{{ store.checklist.expectedFinalDiscard }}</strong></div><div><span>历史弃置额外命中</span><strong :class="{ 'danger-text': store.checklist.incidentalRestoreWarning > 0 }">{{ store.checklist.incidentalRestoreWarning }}</strong></div><div><span>完成状态</span><strong>{{ completed ? '一致' : '核对中' }}</strong></div><button class="icon-button" title="导出对账 CSV" @click="store.exportReconciliationCsv"><Download :size="18" /></button></div>
    <section v-for="(section,sectionIndex) in store.checklist.sections" :key="section.id" class="checklist-section">
      <div class="checklist-title"><span class="operation-index">{{ sectionIndex + 1 }}</span><div><h2>{{ section.title }}</h2><span>{{ section.groups.length }} 条规则</span></div><span class="pool-tag">{{ section.pool }}</span></div>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>规则名</th><th>Expected</th><th>Actual</th><th>Delta</th><th>状态</th></tr></thead><tbody><tr v-for="group in section.groups" :key="group.index"><td>{{ group.index + 1 }}</td><td>{{ group.name }}</td><td>{{ group.expected }}</td><td><input v-model="store.actuals[section.id + ':' + group.index]" class="actual-input" type="number" min="0" inputmode="numeric" /></td><td :class="{ 'danger-text': store.actuals[section.id + ':' + group.index] !== undefined && Number(store.actuals[section.id + ':' + group.index]) !== group.expected }">{{ store.actuals[section.id + ':' + group.index] === undefined || store.actuals[section.id + ':' + group.index] === '' ? '—' : Number(store.actuals[section.id + ':' + group.index]) - group.expected }}</td><td><span class="tag" :class="Number(store.actuals[section.id + ':' + group.index]) === group.expected && store.actuals[section.id + ':' + group.index] !== '' ? 'success-tag' : 'neutral'"><CheckCircle2 v-if="Number(store.actuals[section.id + ':' + group.index]) === group.expected && store.actuals[section.id + ':' + group.index] !== ''" :size="14" />{{ Number(store.actuals[section.id + ':' + group.index]) === group.expected && store.actuals[section.id + ':' + group.index] !== '' ? '一致' : '待录入' }}</span></td></tr></tbody></table></div>
    </section>
    <div class="completion-band" :class="{ complete: completed }"><CheckCircle2 :size="24" /><div><strong>{{ completed ? '本次实机对账完成' : '对账尚未完成' }}</strong><span>{{ completed ? '所有 expected / actual 一致。该状态不扩展为规则绝对安全声明。' : '逐条填写游戏实际命中数后自动计算 delta。' }}</span></div></div>
  </template>
</template>
