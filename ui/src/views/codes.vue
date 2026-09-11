<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Clipboard, Download, Play, Save, ShieldCheck, Eye, X, LoaderCircle, Search } from "@lucide/vue";
import { STAT_LABELS, type PlanSummaryDTO, type InventoryRowDTO, type PageDTO, type StatId } from "../../../src/browser.js";
import YuhunConditionEditor from "../components/YuhunConditionEditor.vue";
import { yuhunImage, yuhunDisplayName } from "../manual-target-config.js";
import { useWorkbenchStore } from "../store.js";

const store = useWorkbenchStore();
const saveOpen = ref(false);
const saveName = ref("");
const saveError = ref("");
const saving = ref(false);
function openSave(): void {
  saveName.value = `方案 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  saveError.value = "";
  saveOpen.value = true;
}
async function savePlan(): Promise<void> {
  saving.value = true;
  saveError.value = "";
  try {
    await store.saveCurrentPlan(saveName.value);
    saveOpen.value = false;
    store.notice = "方案已保存";
  } catch (reason) {
    saveError.value = reason instanceof Error ? reason.message : "保存失败";
  } finally { saving.value = false; }
}
const targetShortfall = computed(() => Math.max(0, (store.plan?.requiredRelease ?? 0) - (store.plan?.finalNewDiscardCount ?? 0)));
function updateDesiredFreeSlots(event: Event): void {
  const input = event.target as HTMLInputElement;
  store.setDesiredFreeSlots(input.value === "" ? 500 : Number(input.value));
  input.value = String(store.desiredFreeSlots);
}
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
</script>

<template>
  <section class="page-heading"><div><span class="eyebrow">04 / CODES</span><h1>双码与预演</h1></div><span class="tag" :class="store.copyAllowed ? 'success-tag' : 'danger-tag'"><ShieldCheck :size="14" />{{ store.copyAllowed ? '复制门禁通过' : '复制已阻塞' }}</span></section>

  <div class="code-generation-actions">
    <div v-if="store.analysis" class="capacity-target">
      <label for="desired-free-slots">预期空位
        <input id="desired-free-slots" type="number" inputmode="numeric" min="0" :max="store.desiredFreeSlotsMaximum" step="100" :value="store.desiredFreeSlots" :disabled="!!store.busy || store.desiredFreeSlotsMaximum === 0" aria-describedby="capacity-target-help" @change="updateDesiredFreeSlots" />
      </label>
      <span id="capacity-target-help">清理后希望保留的总空位；本次至少需清理 {{ store.requiredReleaseForTarget.toLocaleString() }} 件。上限 {{ store.desiredFreeSlotsMaximum.toLocaleString() }}（严格小于标记数的最大整百数）。</span>
      <span v-if="store.desiredFreeSlotsMaximum === 0">标记不超过 100 件，整百目标为 0；若背包已超容，仍会尝试清理超出部分。</span>
    </div>
    <div class="code-generation-buttons">
      <button v-if="store.plan" class="secondary" :disabled="!store.copyAllowed || !!store.busy || store.planLibraryBusy" @click="openSave"><Save :size="17" />保存方案</button>
      <button class="primary" :disabled="!store.analysis || !!store.busy || saving" @click="store.generatePlan"><LoaderCircle v-if="store.busy === '正在生成并预演 D/E'" class="spin" :size="17" /><Play v-else :size="17" />{{ store.busy === '正在生成并预演 D/E' ? '正在生成…' : store.plan ? '重新生成并预演' : '生成并预演' }}</button>
    </div>
  </div>

  <template v-if="store.plan">
    <div v-if="store.plan.desiredFreeSlots !== undefined" class="capacity-target-result" role="status" :class="{ 'target-unmet': !store.plan.desiredFreeSlotsReached }">
      <strong>预期空位 {{ store.plan.desiredFreeSlots.toLocaleString() }} · {{ store.plan.desiredFreeSlotsReached ? '预演达标' : `尚差 ${targetShortfall.toLocaleString()} 件清理` }}</strong>
      <span v-if="store.plan.requiredRelease === 0">当前库存已满足空位目标，本次无需弃置。</span>
      <span v-else-if="store.plan.desiredFreeSlotsReached">本次预计清理 {{ store.plan.finalNewDiscardCount.toLocaleString() }} 件；规则整组执行，可能超过目标。</span>
      <span v-else>当前方案受规则表达及每码 60 组限制，尚未达到目标。实际清理量以预演为准。</span>
      <span>仅标记弃置不会立即增加空位；这里预估的是最终消耗或移除这些御魂后的容量。</span>
    </div>
    <div v-if="store.plan.capacityProjection && store.plan.cleanupComparison" class="metric-strip six capacity-strip" aria-label="双码预演清理对账">
      <div data-testid="plan-marked-count"><span>标记数量</span><strong>{{ store.plan.cleanupComparison.markedCount.toLocaleString() }}</strong></div>
      <div data-testid="plan-cleanup-count"><span>方案清理数量</span><strong>{{ store.plan.cleanupComparison.planCleanupCount.toLocaleString() }}</strong></div>
      <div data-testid="plan-cleanup-difference"><span title="方案清理数量 - 全部标记数量；容量目标不要求清理所有标记">与标记数之差</span><strong>{{ store.plan.cleanupComparison.netDifference > 0 ? '+' : '' }}{{ store.plan.cleanupComparison.netDifference.toLocaleString() }}</strong></div>
      <div data-testid="plan-affected-count"><span :title="`未纳入方案 ${store.plan.cleanupComparison.missedMarkedCount.toLocaleString()} 件，额外清理 ${store.plan.cleanupComparison.extraCleanupCount.toLocaleString()} 件`">与标记不一致</span><strong>{{ store.plan.cleanupComparison.affectedCount.toLocaleString() }}</strong></div>
      <div data-testid="plan-capacity-after-count"><span>应用后御魂</span><strong>{{ store.plan.capacityProjection.after.totalCount.toLocaleString() }}</strong></div>
      <div data-testid="plan-capacity-after-free"><span>应用后空位</span><strong>{{ store.plan.capacityProjection.after.overCapacityCount > 0 ? `超出 ${store.plan.capacityProjection.after.overCapacityCount.toLocaleString()}` : store.plan.capacityProjection.after.freeSlots.toLocaleString() }}</strong></div>
    </div>
    <div v-if="store.plan.cleanupComparison && store.plan.cleanupComparison.affectedCount > 0" class="inline-warning cleanup-difference-note">未纳入方案 {{ store.plan.cleanupComparison.missedMarkedCount.toLocaleString() }} 件 · 额外清理 {{ store.plan.cleanupComparison.extraCleanupCount.toLocaleString() }} 件。达到空位目标即可，无需清理全部标记。</div>
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
  </template>
  <div v-else class="empty-state"><ShieldCheck :size="32" /><strong>尚未生成双码</strong><span>完成账号分析后，即可生成并预演。</span></div>
  <div v-if="saveOpen" class="modal-backdrop" @click.self="!saving && (saveOpen = false)" @keydown.esc="!saving && (saveOpen = false)">
    <form class="import-dialog save-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="save-plan-title" @submit.prevent="savePlan">
      <header><h2 id="save-plan-title">保存方案</h2><button type="button" class="icon-button" aria-label="关闭" :disabled="saving" @click="saveOpen = false"><X :size="18" /></button></header>
      <div class="rule-form"><label class="rule-name"><span>方案名称</span><input v-model="saveName" maxlength="80" required :disabled="saving" /></label><p v-if="saveError" class="inline-warning" role="alert">{{ saveError }}</p></div>
      <footer><button type="button" :disabled="saving" @click="saveOpen = false">取消</button><button class="primary" type="submit" :disabled="saving || !saveName.trim()"><Save :size="16" />{{ saving ? '正在保存…' : '保存' }}</button></footer>
    </form>
  </div>
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
.code-generation-actions { display: flex; align-items: center; justify-content: space-between; gap: 18px; flex-wrap: wrap; margin-bottom: 16px; }
.code-generation-buttons { display: flex; gap: 10px; margin-left: auto; flex-wrap: wrap; }
.save-plan-dialog { width: min(460px, 100%); }
.capacity-target { display: grid; gap: 7px; flex: 1; min-width: 240px; }
.capacity-target label { display: flex; align-items: center; gap: 12px; font-weight: 600; }
.capacity-target input { width: 110px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; }
.capacity-target > span, .capacity-target-result > span { font-size: 12px; color: var(--muted); line-height: 1.6; }
.capacity-target-result { display: grid; gap: 5px; padding: 12px 14px; margin-bottom: 16px; border: 1px solid var(--line); border-left: 3px solid var(--green); border-radius: 6px; }
.capacity-target-result.target-unmet { border-left-color: var(--red); }
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
