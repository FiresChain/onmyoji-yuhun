<script setup lang="ts">
import { computed } from "vue";
import { Ban, Check, Clipboard, Download, Play, ShieldCheck, Square } from "@lucide/vue";
import EChart from "../components/EChart.vue";
import { useWorkbenchStore } from "../store.js";

const store = useWorkbenchStore();
const funnelOption = computed(() => ({
  tooltip: { trigger: "axis" },
  grid: { left: 90, right: 34, top: 10, bottom: 25 },
  xAxis: { type: "value", splitLine: { lineStyle: { color: "#e3e6e8" } } },
  yAxis: { type: "category", inverse: true, data: ["正常池", "D 新弃置", "E 捡回", "最终新弃置"] },
  series: [{ type: "bar", data: [store.plan?.normalPoolCount ?? 0, store.plan?.newDiscardCount ?? 0, store.plan?.rescuedFromNewDiscardCount ?? 0, store.plan?.finalNewDiscardCount ?? 0], barWidth: 24, itemStyle: { color: (params: { dataIndex: number }) => ["#768086", "#a43c34", "#315c60", "#202426"][params.dataIndex], borderRadius: [0, 3, 3, 0] }, label: { show: true, position: "right" } }]
}));
const progressPercent = computed(() => store.progress ? Math.round(store.progress.completed / Math.max(1,store.progress.total) * 100) : 0);
const gateLabels: Record<string,string> = { snapshotValid:"快照有效",targetsAndThresholdsValid:"模板与阈值有效",staticPolicyConfirmed:"静态策略已确认",headerSourceValid:"Header 来源有效",groupLimitValid:"组数不超过 60",roundtripValid:"编码往返无警告",previewComplete:"账号预演完成",tier0ProofPassed:"Tier 0 证明通过",selectedTierSimulationPassed:"当前档位模拟通过" };
</script>

<template>
  <section class="page-heading"><div><span class="eyebrow">04 / CODES</span><h1>双码、预演与验证</h1></div><span class="tag" :class="store.copyAllowed ? 'success-tag' : 'danger-tag'"><ShieldCheck :size="14" />{{ store.copyAllowed ? '复制门禁通过' : '复制已阻塞' }}</span></section>

  <section class="header-source"><div><h2>Header 来源</h2><span>只从现有筛选码提取 16 字节 Header，不猜测。</span></div><textarea v-model="store.existingFilterCode" @input="store.invalidateHeader" rows="3" spellcheck="false" placeholder="粘贴任意一条当前账号可导入的筛选码"></textarea><button class="primary" :disabled="!store.analysis || !store.staticPolicy.confirmed || !store.existingFilterCode || !!store.busy" @click="store.generatePlan"><Play :size="17" />生成并预演</button></section>

  <template v-if="store.plan">
    <div v-if="store.plan.capacityProjection && store.plan.cleanupComparison" class="metric-strip six capacity-strip" aria-label="双码预演清理对账">
      <div data-testid="plan-marked-count"><span>标记数量</span><strong>{{ store.plan.cleanupComparison.markedCount.toLocaleString() }}</strong></div>
      <div data-testid="plan-cleanup-count"><span>方案清理数量</span><strong>{{ store.plan.cleanupComparison.planCleanupCount.toLocaleString() }}</strong></div>
      <div data-testid="plan-cleanup-difference"><span title="方案清理数量 - 标记数量">清理误差</span><strong>{{ store.plan.cleanupComparison.netDifference > 0 ? '+' : '' }}{{ store.plan.cleanupComparison.netDifference.toLocaleString() }}</strong></div>
      <div data-testid="plan-affected-count"><span :title="`漏清 ${store.plan.cleanupComparison.missedMarkedCount.toLocaleString()} 件，额外清理 ${store.plan.cleanupComparison.extraCleanupCount.toLocaleString()} 件`">误差影响御魂</span><strong>{{ store.plan.cleanupComparison.affectedCount.toLocaleString() }}</strong></div>
      <div data-testid="plan-capacity-after-count"><span>应用后御魂</span><strong>{{ store.plan.capacityProjection.after.totalCount.toLocaleString() }}</strong></div>
      <div data-testid="plan-capacity-after-free"><span>应用后空位</span><strong>{{ store.plan.capacityProjection.after.overCapacityCount > 0 ? `超出 ${store.plan.capacityProjection.after.overCapacityCount.toLocaleString()}` : store.plan.capacityProjection.after.freeSlots.toLocaleString() }}</strong></div>
    </div>
    <div v-if="store.plan.cleanupComparison && store.plan.cleanupComparison.affectedCount > 0" class="inline-warning cleanup-difference-note">漏清 {{ store.plan.cleanupComparison.missedMarkedCount.toLocaleString() }} 件 · 额外清理 {{ store.plan.cleanupComparison.extraCleanupCount.toLocaleString() }} 件</div>
    <div class="codes-grid"><article><div class="code-head"><span class="code-letter discard">D</span><div><h2>弃置码</h2><span>{{ store.plan.discardGroupCount }} 组 · 正常池</span></div><div class="code-actions"><button class="icon-button" title="复制弃置码" :disabled="!store.copyAllowed || !store.plan.discardCode" @click="store.copyCode('discard')"><Clipboard :size="17" /></button><button class="icon-button" title="下载弃置码 JSON" :disabled="!store.copyAllowed || !store.plan.discardCode" @click="store.downloadCode('discard')"><Download :size="17" /></button></div></div><textarea readonly :value="store.plan.discardCode ?? '当前方案无需 D 码'" rows="4"></textarea></article><article><div class="code-head"><span class="code-letter rescue">E</span><div><h2>捡回码</h2><span>{{ store.plan.rescueGroupCount }} 组 · 弃置池</span></div><div class="code-actions"><button class="icon-button" title="复制捡回码" :disabled="!store.copyAllowed || !store.plan.rescueCode" @click="store.copyCode('rescue')"><Clipboard :size="17" /></button><button class="icon-button" title="下载捡回码 JSON" :disabled="!store.copyAllowed || !store.plan.rescueCode" @click="store.downloadCode('rescue')"><Download :size="17" /></button></div></div><textarea readonly :value="store.plan.rescueCode ?? '当前方案无需 E 码'" rows="4"></textarea></article></div>
    <section class="rule-manifest"><div class="block-title"><h2>只读规则组</h2><span>D/E 生成后不可在本页修改</span></div><div class="table-wrap"><table><thead><tr><th>码</th><th>组名</th><th>池</th><th>预期命中</th></tr></thead><tbody><tr v-for="group in store.plan.groups" :key="`${group.code}:${group.index}:${group.name}`"><td><span class="tag" :class="group.code === 'D' ? 'danger-tag' : 'success-tag'">{{ group.code }}</span></td><td><code>{{ group.name }}</code></td><td>{{ group.pool }}</td><td>{{ group.expected }}</td></tr><tr v-if="store.plan.groups.length === 0"><td colspan="4" class="empty-cell">当前方案没有可展示的规则组</td></tr></tbody></table></div></section>
    <div class="split-layout chart-band"><div class="panel-block"><div class="block-title"><h2>账号池漏斗</h2><span>D \ E</span></div><EChart :option="funnelOption" :height="250" /><div v-if="store.plan.incidentalRestoreCount > 0" class="inline-warning">历史弃置池额外命中 {{ store.plan.incidentalRestoreCount }} 件</div></div><div class="panel-block"><div class="block-title"><h2>严格门禁</h2><span>{{ Object.values(store.gateState).filter(Boolean).length }} / 9</span></div><div class="gate-list"><div v-for="(label,key) in gateLabels" :key="key" :class="{ passed: store.gateState[key] }"><Check v-if="store.gateState[key]" :size="16" /><Ban v-else :size="16" /><span>{{ label }}</span></div></div></div></div>
    <section class="simulation-band"><div><h2>100,000 件验证模拟</h2><span v-if="store.simulation">个性化 {{ (store.simulation.report.personalized.exactDiscardCoverage*100).toFixed(1) }}% · 实际 D\E {{ (store.simulation.report.realizedPlan.exactDiscardCoverage*100).toFixed(1) }}%</span><span v-else>固定种子 · Tier 0 完整结果空间证明 · 当前档位预算校验</span></div><div v-if="store.busy?.includes('100,000')" class="progress-wrap"><div><i :style="{width:`${progressPercent}%`}"></i></div><span>{{ progressPercent }}%</span><button class="icon-button danger" title="取消并重建 Worker" @click="store.cancelSimulation"><Square :size="15" /></button></div><button v-else class="primary" :disabled="!!store.busy" @click="store.runSimulation"><Play :size="17" />{{ store.simulation ? '重新模拟' : '运行模拟' }}</button></section>
  </template>
  <div v-else class="empty-state"><ShieldCheck :size="32" /><strong>尚未生成双码</strong><span>先完成账号分析、确认静态策略，再提供有效 Header 来源。</span></div>
</template>
