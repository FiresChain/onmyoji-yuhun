<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Ban, Check, Clipboard, Download, Play, ShieldCheck, Eye, X, LoaderCircle, Search } from "@lucide/vue";
import { STAT_LABELS, type PlanSummaryDTO, type InventoryRowDTO, type PageDTO, type StatId } from "../../../src/browser.js";
import YuhunConditionEditor from "../components/YuhunConditionEditor.vue";
import { yuhunImage, yuhunDisplayName } from "../manual-target-config.js";
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
const codePools = computed(() => ([
  { kind: "discard" as const, code: "D", title: "弃置码", pool: "正常池", count: store.plan?.discardGroupCount ?? 0, value: store.plan?.discardCode, groups: store.plan?.groups.filter(group => group.code === "D") ?? [] },
  { kind: "rescue" as const, code: "E", title: "捡回码", pool: "弃置池", count: store.plan?.rescueGroupCount ?? 0, value: store.plan?.rescueCode, groups: store.plan?.groups.filter(group => group.code === "E" && group.pool === "combined") ?? [] }
]));
const poolLabels = { normal: "正常池", "new-garbage": "新弃置池", "historical-garbage": "历史弃置池", combined: "合并弃置池" };
type PreviewGroup = PlanSummaryDTO["groups"][number];
const viewedRule = ref<PreviewGroup | null>(null);
const hitRule = ref<PreviewGroup | null>(null);
const hitPool = ref<PreviewGroup["pool"]>("normal");
const hitSearch = ref("");
const hitPage = ref<PageDTO<InventoryRowDTO> | null>(null);
const hitBusy = ref(false);
const hitError = ref("");
let hitRequest = 0;
const hitCounts = computed(() => store.plan?.groups.filter(group => group.code === hitRule.value?.code && group.index === hitRule.value?.index) ?? []);
function closeHits(): void {
  hitRequest++;
  hitRule.value = null;
  hitPage.value = null;
  hitBusy.value = false;
}
watch(() => store.plan, () => { viewedRule.value = null; closeHits(); });
async function loadHits(page = 1): Promise<void> {
  if (!hitRule.value) return;
  const sequence = ++hitRequest;
  hitBusy.value = true;
  hitError.value = "";
  hitPage.value = null;
  try {
    const result = await store.queryPreviewYuhun(hitRule.value.code, hitRule.value.index, hitPool.value, page, hitSearch.value);
    if (sequence === hitRequest) hitPage.value = result;
  } catch (reason) {
    if (sequence === hitRequest) hitError.value = reason instanceof Error ? reason.message : "读取命中御魂失败";
  } finally {
    if (sequence === hitRequest) hitBusy.value = false;
  }
}
function viewHits(group: PreviewGroup): void {
  viewedRule.value = null;
  hitRule.value = group;
  hitPool.value = group.pool;
  hitSearch.value = "";
  void loadHits();
}
const percentageStats = new Set<StatId>(["attackPercent", "defensePercent", "hpPercent", "crit", "critDamage", "effectHit", "effectResist"]);
function statValue(stat: StatId, value: number): string {
  const percentage = percentageStats.has(stat);
  return `+${Number((value * (percentage ? 100 : 1)).toFixed(2))}${percentage ? "%" : ""}`;
}
const gateLabels: Record<string,string> = { snapshotValid:"快照有效",targetsAndThresholdsValid:"单件决策已生成",staticPolicyConfirmed:"按当前决策生成",headerSourceValid:"分享码标识有效",groupLimitValid:"每码不超过 60 组",roundtripValid:"编码往返一致",previewComplete:"当前库存预演完成",retainedItemsProtected:"未误弃保留项" };
</script>

<template>
  <section class="page-heading"><div><span class="eyebrow">04 / CODES</span><h1>双码、预演与验证</h1></div><span class="tag" :class="store.copyAllowed ? 'success-tag' : 'danger-tag'"><ShieldCheck :size="14" />{{ store.copyAllowed ? '复制门禁通过' : '复制已阻塞' }}</span></section>

  <div class="code-generation-actions"><button class="primary" :disabled="!store.analysis || !!store.busy" @click="store.generatePlan"><LoaderCircle v-if="store.busy === '正在生成并预演 D/E'" class="spin" :size="17" /><Play v-else :size="17" />{{ store.busy === '正在生成并预演 D/E' ? '正在生成…' : store.plan ? '重新生成并预演' : '生成并预演' }}</button></div>

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
    <div class="section-toolbar unframed"><div><h2>双码规则</h2></div><span class="tag">只读</span></div>
    <div class="preset-pools generated-code-pools">
      <article v-for="pool in codePools" :key="pool.code" class="preset-pool" :class="{ 'discard-pool': pool.kind === 'discard' }" :aria-label="pool.title">
        <header class="preset-pool-header">
          <div><span>{{ pool.code === 'D' ? 'DISCARD / D' : 'RESCUE / E' }}</span><h3>{{ pool.title }}</h3><p>{{ pool.count }} 组 · {{ pool.pool }}</p></div>
          <div class="code-actions">
            <button class="icon-button" :title="`复制${pool.title}`" :disabled="!store.copyAllowed || !pool.value" @click="store.copyCode(pool.kind)"><Clipboard :size="17" /></button>
            <button class="icon-button" :title="`导出${pool.title}二维码图片`" :disabled="!store.copyAllowed || !pool.value" @click="store.downloadCode(pool.kind)"><Download :size="17" /></button>
          </div>
        </header>
        <div class="generated-code-value"><label :for="`generated-code-${pool.code}`">{{ pool.title }}</label><textarea :id="`generated-code-${pool.code}`" readonly :value="pool.value ?? `当前方案无需 ${pool.code} 码`" rows="3"></textarea></div>
        <div class="generated-rule-list">
          <div v-for="group in pool.groups" :key="`${pool.code}:${group.index}`" class="generated-rule" :data-testid="`preview-rule-${pool.code}-${group.index}`">
            <div class="generated-rule-row"><span class="generated-rule-name"><strong>{{ group.name }}</strong><small>{{ group.criteria?.types.join(' / ') || '全部御魂套装' }}</small></span><span class="generated-rule-count">命中 {{ group.expected.toLocaleString() }} 件</span>
              <div class="generated-rule-actions"><button class="icon-button" title="查看规则" aria-label="查看规则" @click="viewedRule = group"><Eye :size="16" /></button><button class="icon-button" title="查看命中御魂" aria-label="查看命中御魂" @click="viewHits(group)"><Search :size="16" /></button></div>
            </div>
          </div>
          <div v-if="pool.groups.length === 0" class="preset-empty"><strong>暂无{{ pool.title }}规则</strong><span>当前方案无需执行此步骤。</span></div>
        </div>
      </article>
    </div>
    <div class="split-layout chart-band"><div class="panel-block"><div class="block-title"><h2>账号池漏斗</h2><span>D \ E</span></div><EChart :option="funnelOption" :height="250" /><div v-if="store.plan.incidentalRestoreCount > 0" class="inline-warning">历史弃置池额外命中 {{ store.plan.incidentalRestoreCount }} 件</div></div><div class="panel-block"><div class="block-title"><h2>严格门禁</h2><span>{{ Object.values(store.gateState).filter(Boolean).length }} / 8</span></div><div class="gate-list"><div v-for="(label,key) in gateLabels" :key="key" :class="{ passed: store.gateState[key] }"><Check v-if="store.gateState[key]" :size="16" /><Ban v-else :size="16" /><span>{{ label }}</span></div></div></div></div>
    <section class="simulation-band"><div><h2>当前库存覆盖验证</h2><span>生成时自动检查 D−E：不误弃保留项，仅清理正常池未锁定的六星 +0 御魂。无法区分的御魂一并保留，组数限制可能导致少清理；更换快照或修改决策后需重新生成。</span></div><span class="tag success-tag" v-if="store.gateState.retainedItemsProtected">验证通过</span></section>
  </template>
  <div v-else class="empty-state"><ShieldCheck :size="32" /><strong>尚未生成双码</strong><span>完成账号分析后，即可生成并预演。</span></div>
  <div v-if="viewedRule" class="modal-backdrop" @click.self="viewedRule = null" @keydown.esc="viewedRule = null">
    <section class="import-dialog rule-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-rule-title">
      <header><div><span class="eyebrow">PRESET RULE / {{ viewedRule.code }}</span><h2 id="preview-rule-title">查看{{ viewedRule.code === 'D' ? '弃置' : '捡回' }}规则</h2></div><button class="icon-button" title="关闭" @click="viewedRule = null"><X :size="18" /></button></header>
      <div class="rule-form"><label class="rule-name"><span>规则名称</span><input :value="viewedRule.name" readonly /></label><YuhunConditionEditor v-if="viewedRule.criteria" :model-value="viewedRule.criteria" readonly /><p v-else class="inline-warning">此方案未保存筛选条件，请重新生成双码后查看详情。</p></div>
      <footer class="icon-footer"><button class="icon-button" title="查看命中御魂" aria-label="查看命中御魂" @click="viewHits(viewedRule)"><Search :size="16" /></button></footer>
    </section>
  </div>
  <div v-if="hitRule" class="modal-backdrop" @click.self="closeHits" @keydown.esc="closeHits">
    <section class="import-dialog hit-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-hits-title" :aria-busy="hitBusy">
      <header><div><span class="eyebrow">{{ hitRule.code }} / MATCHED YUHUN</span><h2 id="preview-hits-title">命中御魂 · {{ hitRule.name }}</h2></div><button class="icon-button" title="关闭" @click="closeHits"><X :size="18" /></button></header>
      <div class="target-entry-tabs" role="tablist" aria-label="命中御魂池"><button v-for="group in hitCounts" :key="group.pool" role="tab" :aria-selected="hitPool === group.pool" :class="{ active: hitPool === group.pool }" @click="hitPool = group.pool; loadHits()">{{ poolLabels[group.pool] }} · {{ group.expected.toLocaleString() }} 件</button></div>
      <form class="hit-search" @submit.prevent="loadHits()"><input v-model="hitSearch" aria-label="搜索命中御魂套装" placeholder="搜索御魂套装" /><button class="icon-button" type="submit" title="搜索" aria-label="搜索"><Search :size="16" /></button></form>
      <div v-if="hitBusy" class="empty-state" role="status"><LoaderCircle class="spin" :size="24" /><span>正在读取命中御魂…</span></div>
      <div v-else-if="hitError" class="inline-warning" role="alert">{{ hitError }} <button @click="loadHits()">重试</button></div>
      <template v-else-if="hitPage">
        <div class="table-wrap"><table class="inventory-table"><thead><tr><th>#</th><th>套装</th><th>位置</th><th>星级</th><th>等级</th><th>主属性 / 固有属性</th><th>副属性</th><th>原始状态</th></tr></thead><tbody>
          <tr v-for="row in hitPage.rows" :key="row.row"><td>{{ row.row }}</td><td><span class="inventory-suit"><img v-if="yuhunImage(row.suit)" :src="yuhunImage(row.suit)!" :alt="yuhunDisplayName(row.suit)" /><span>{{ yuhunDisplayName(row.suit) }}</span></span></td><td>{{ row.position }} 号</td><td>{{ row.star }}★</td><td>+{{ row.level }}</td><td><div class="inventory-stat-list"><span class="inventory-stat"><small>{{ STAT_LABELS[row.mainStat] }}</small><strong>{{ statValue(row.mainStat, row.mainValue) }}</strong></span><span v-for="stat in row.intrinsicStats" :key="stat.stat" class="inventory-stat intrinsic"><small>{{ STAT_LABELS[stat.stat] }}</small><strong>{{ statValue(stat.stat, stat.value) }}</strong></span></div></td><td><div class="inventory-stat-list"><span v-for="stat in row.subStatValues" :key="stat.stat" class="inventory-stat"><small>{{ STAT_LABELS[stat.stat] }}</small><strong>{{ statValue(stat.stat, stat.value) }}</strong></span></div></td><td>{{ row.garbage ? '历史弃置池' : '正常池' }}</td></tr>
          <tr v-if="hitPage.rows.length === 0"><td colspan="8" class="empty-cell">{{ hitSearch ? '没有符合搜索条件的命中御魂' : '此规则在当前池中没有命中御魂' }}</td></tr>
        </tbody></table></div>
        <div class="pagination"><button :disabled="hitPage.page <= 1" @click="loadHits(hitPage.page - 1)">上一页</button><span>{{ hitPage.total }} 件 · {{ hitPage.page }} / {{ Math.max(1, Math.ceil(hitPage.total / hitPage.pageSize)) }}</span><button :disabled="hitPage.page * hitPage.pageSize >= hitPage.total" @click="loadHits(hitPage.page + 1)">下一页</button></div>
      </template>

    </section>
  </div>

</template>

<style scoped>
.code-generation-actions { display: flex; justify-content: flex-end; margin-bottom: 16px; }
.generated-code-pools { margin-bottom: 18px; align-items: start; }
.generated-code-value { display: grid; gap: 6px; padding: 12px 13px; border-bottom: 1px solid var(--line); }
.generated-code-value label { font-size: 10px; color: var(--muted); }
.generated-code-value textarea { width: 100%; resize: vertical; }
.generated-rule + .generated-rule { border-top: 1px solid var(--line); }
.generated-rule { padding: 12px 13px; }
.generated-rule-row { display: flex; align-items: center; gap: 9px; }
.generated-rule-name { display: grid; gap: 4px; min-width: 0; flex: 1; }
.generated-rule-name strong { font-size: 11px; overflow-wrap: anywhere; }
.generated-rule-name small { color: var(--muted); font-size: 10px; overflow-wrap: anywhere; }
.generated-rule-count { font-size: 10px; white-space: nowrap; color: var(--green); }
.discard-pool .generated-rule-count { color: var(--red); }
.generated-rule-actions { display: flex; flex-shrink: 0; gap: 5px; }
.icon-footer { justify-content: flex-end; }
.hit-dialog { width: min(1120px,100%); }
.hit-dialog h2 { overflow-wrap: anywhere; }
.hit-dialog .target-entry-tabs { flex-wrap: wrap; }
.hit-search { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 14px; }

.hit-dialog .table-wrap { max-height: 55vh; overflow: auto; }
.hit-dialog table { min-width: 760px; }
@media (max-width: 760px) { .generated-code-pools { grid-template-columns: 1fr; } }
</style>
