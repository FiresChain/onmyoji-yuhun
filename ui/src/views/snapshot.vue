<script setup lang="ts">
import { computed, ref } from "vue";
import { FileJson, Filter, Upload } from "@lucide/vue";
import EChart from "../components/EChart.vue";
import { useWorkbenchStore } from "../store.js";

const store = useWorkbenchStore();
const dragging = ref(false);
const search = ref("");
const level = ref<string>("");

const distribution = computed(() => ({
  tooltip: { trigger: "axis" },
  grid: { left: 38, right: 16, top: 18, bottom: 28 },
  xAxis: { type: "category", data: Object.keys(store.snapshot?.levels ?? {}), axisTick: { show: false } },
  yAxis: { type: "value", splitLine: { lineStyle: { color: "#e3e6e8" } } },
  series: [{ type: "bar", data: Object.values(store.snapshot?.levels ?? {}), itemStyle: { color: "#315c60", borderRadius: [3, 3, 0, 0] }, barMaxWidth: 32 }]
}));

async function choose(files: FileList | null): Promise<void> {
  const file = files?.[0];
  if (file !== undefined) await store.importSnapshot(file);
}

async function applyFilters(page = 1): Promise<void> {
  await store.loadInventory(page, {
    ...(search.value === "" ? {} : { search: search.value }),
    ...(level.value === "" ? {} : { level: Number(level.value) })
  });
}
</script>

<template>
  <section class="page-heading">
    <div><span class="eyebrow">01 / SNAPSHOT</span><h1>数据快照</h1></div>
    <span v-if="store.snapshot" class="hash">SHA-256 · {{ store.snapshot.sha256.slice(0, 12) }}…</span>
  </section>

  <label class="drop-zone" :class="{ dragging }" @dragover.prevent="dragging = true" @dragleave.prevent="dragging = false" @drop.prevent="dragging = false; choose($event.dataTransfer?.files ?? null)">
    <input type="file" accept="application/json,.json" @change="choose(($event.target as HTMLInputElement).files)" />
    <Upload :size="28" />
    <strong>{{ store.snapshot ? "替换游戏快照" : "导入 OnmyojiHub / yyx JSON" }}</strong>
    <span>最大 64 MiB / 50,000 件 · 支持式神面板与御魂库存</span>
  </label>

  <template v-if="store.snapshot">
    <div class="metric-strip six">
      <div><span>总量</span><strong>{{ store.snapshot.total.toLocaleString() }}</strong></div>
      <div><span>六星</span><strong>{{ (store.snapshot.stars['6'] ?? 0).toLocaleString() }}</strong></div>
      <div><span>六星 +0</span><strong>{{ store.snapshot.sixStarUnleveled.toLocaleString() }}</strong></div>
      <div><span>锁定</span><strong>{{ store.snapshot.locked.toLocaleString() }}</strong></div>
      <div><span>历史弃置池</span><strong>{{ store.snapshot.garbage.toLocaleString() }}</strong></div>
      <div><span>初始 4 条</span><strong>{{ (store.snapshot.initialSubStats['4'] ?? 0).toLocaleString() }}</strong></div>
    </div>

    <div class="split-layout chart-band">
      <div class="panel-block"><h2>等级分布</h2><EChart :option="distribution" :height="210" /></div>
      <div class="panel-block"><h2>初始副属性条数</h2>
        <div class="count-bars">
          <div v-for="count in ['1','2','3','4']" :key="count"><span>{{ count }} 条</span><i :style="{ width: `${((store.snapshot.initialSubStats[count] ?? 0) / Math.max(1, store.snapshot.sixStarUnleveled)) * 100}%` }"></i><strong>{{ store.snapshot.initialSubStats[count] ?? 0 }}</strong></div>
        </div>
      </div>
    </div>

    <section class="data-section">
      <div class="section-toolbar"><div><h2>库存明细</h2><span>{{ store.inventory?.total ?? 0 }} 条 · 御魂 ID 默认隐藏</span></div>
        <div class="filters"><Filter :size="16" /><input v-model="search" placeholder="套装名称" @keyup.enter="applyFilters()" /><select v-model="level" @change="applyFilters()"><option value="">全部等级</option><option v-for="n in [0,3,6,9,12,15]" :key="n" :value="n">+{{ n }}</option></select></div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>套装</th><th>位置</th><th>星级</th><th>等级</th><th>主属性</th><th>副属性</th><th>状态</th></tr></thead><tbody>
        <tr v-for="row in store.inventory?.rows" :key="row.row"><td>{{ row.row }}</td><td><FileJson :size="14" /> {{ row.suit }}</td><td>{{ row.position }}</td><td>{{ row.star }}★</td><td>+{{ row.level }}</td><td>{{ row.mainStat }}</td><td>{{ row.subStats.join(' / ') }}</td><td><span v-if="row.locked" class="tag neutral">锁定</span><span v-if="row.garbage" class="tag danger-tag">弃置池</span></td></tr>
      </tbody></table></div>
      <div class="pagination"><button :disabled="(store.inventory?.page ?? 1) <= 1" @click="applyFilters((store.inventory?.page ?? 1)-1)">上一页</button><span>{{ store.inventory?.page ?? 1 }} / {{ Math.max(1, Math.ceil((store.inventory?.total ?? 0)/25)) }}</span><button :disabled="(store.inventory?.page ?? 1)*25 >= (store.inventory?.total ?? 0)" @click="applyFilters((store.inventory?.page ?? 1)+1)">下一页</button></div>
    </section>
  </template>
</template>
