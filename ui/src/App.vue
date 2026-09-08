<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { Activity, AlertTriangle, Cpu, Database, DatabaseBackup, Download, FolderOpen, Gauge, LockKeyhole, Save, Settings2, ShieldCheck, Smartphone, Trash2, Upload, X } from "@lucide/vue";
import { STEPS } from "./router.js";
import { useWorkbenchStore } from "./store.js";
import {
  CALCULATION_RESOURCE_PROFILES,
  capturePerformanceDevice,
  loadPerformanceBenchmark,
  parseDiagnosticsExport,
  type CalculationResourceProfile,
  type DiagnosticsExport,
  type ImportedDiagnostics,
  type PerformanceBenchmark,
  type PerformanceRecord,
  type PerformanceTargetTiming
} from "./performance.js";
import { inspectPerformanceDevice, runPerformanceBenchmark } from "./hardware-benchmark.js";
import { formatTeamCalculationError } from "./team-calculation-errors.js";
import { shikigamiByHeroId } from "./manual-target-config.js";
import { parseSceneDataExport } from "./persistence.js";
import { setTelemetryConsent, telemetryApiUrl, telemetryConsent } from "./telemetry.js";

const route = useRoute();
const store = useWorkbenchStore();
const activeIndex = computed(() => STEPS.findIndex((step) => step.id === route.name));
const performanceOpen = ref(false);
const diagnosticsSection = ref<"device" | "performance" | "imported" | "errors">("device");
const deviceInfo = ref(capturePerformanceDevice());
const benchmarkRunning = ref(false);
const benchmark = ref<PerformanceBenchmark | null>(loadPerformanceBenchmark());
const telemetryEnabled = ref(telemetryConsent());
const sceneDataInput = ref<HTMLInputElement | null>(null);
const diagnosticsInput = ref<HTMLInputElement | null>(null);
const importedDiagnostics = ref<ImportedDiagnostics | null>(null);
const calculationErrors = computed(() => store.teamCalculations.filter((report) =>
  report.entities.some((entity) => entity.status === "unsupported")
));
const resolveShikigamiName = (id: number | null, fallback: string): string => id === null ? fallback : shikigamiByHeroId(id)?.name ?? fallback;

async function inspectDevice(): Promise<void> {
  deviceInfo.value = await inspectPerformanceDevice();
}

async function runPerformanceTest(): Promise<void> {
  benchmarkRunning.value = true;
  try {
    benchmark.value = await runPerformanceBenchmark();
    deviceInfo.value = capturePerformanceDevice();
  } finally {
    benchmarkRunning.value = false;
  }
}

function openPerformanceDialog(): void {
  benchmark.value = loadPerformanceBenchmark();
  deviceInfo.value = capturePerformanceDevice();
  performanceOpen.value = true;
}

function updateTelemetryConsent(enabled: boolean): void {
  telemetryEnabled.value = enabled;
  setTelemetryConsent(enabled);
}

function updateTeamCalculationResourceProfile(value: string): void {
  if (!CALCULATION_RESOURCE_PROFILES.some((profile) => profile.id === value)) return;
  const profile = value as CalculationResourceProfile;
  store.setTeamCalculationResourceProfile(profile);
  if (profile === "custom" && store.customTeamCalculationWorkerCount === null) {
    store.setCustomTeamCalculationWorkerCount(1);
  }
}

function updateCustomTeamCalculationWorkerCount(value: string): void {
  if (value.trim() === "") {
    store.setCustomTeamCalculationWorkerCount(null);
    return;
  }
  const workerCount = Number(value);
  if (!Number.isSafeInteger(workerCount) || workerCount < 1 || workerCount > 64) return;
  store.setCustomTeamCalculationWorkerCount(workerCount);
}

function updateTeamCalculationSchedulerDebugEnabled(enabled: boolean): void {
  store.setTeamCalculationSchedulerDebugEnabled(enabled);
}

const operationLabels = {
  "team-calculation": "阵容计算",
  analysis: "完整分析",
  simulation: "验证模拟"
} as const;

function formatMs(value: number): string {
  if (value < 1000) return `${value.toFixed(0)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function formatCount(value: number | null): string {
  return value === null ? "-" : value.toLocaleString();
}

function formatRecordedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function downloadJson(payload: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportDiagnostics(): void {
  const exportedAt = new Date();
  const payload: DiagnosticsExport = {
    schemaVersion: 1,
    kind: "onmyoji-yuhun-diagnostics-export",
    exportedAt: exportedAt.toISOString(),
    benchmark: benchmark.value,
    records: store.performanceHistory,
    schedulerLog: store.teamCalculationSchedulerDebugLog
  };
  downloadJson(payload, `onmyoji-yuhun-diagnostics-${exportedAt.toISOString().slice(0, 10)}.json`);
}

async function importDiagnostics(files: FileList | null): Promise<void> {
  const file = files?.[0];
  if (diagnosticsInput.value !== null) diagnosticsInput.value.value = "";
  if (file === undefined) return;
  try {
    const imported = parseDiagnosticsExport(JSON.parse(await file.text()) as unknown);
    if (imported === null) {
      window.alert("不是可识别的性能诊断文件");
      return;
    }
    importedDiagnostics.value = imported;
    diagnosticsSection.value = "imported";
  } catch {
    window.alert("不是可识别的性能诊断文件");
  }
}

async function chooseSceneData(files: FileList | null): Promise<void> {
  const file = files?.[0];
  if (sceneDataInput.value !== null) sceneDataInput.value.value = "";
  if (file === undefined) return;
  const payload = parseSceneDataExport(JSON.parse(await file.text()) as unknown);
  const confirmed = window.confirm(
    `将用文件中的 ${payload.summary.sceneCount} 个关卡、${payload.summary.targetCount} 条阵容覆盖浏览器当前关卡数据，并清空旧分析结果。是否继续？`
  );
  if (confirmed) store.importSceneData(payload);
}

const targetStageLabels: Readonly<Record<string, string>> = {
  "candidate-filter": "过滤",
  "combination-search": "搜索",
  "potential-evaluation": "潜力"
};

function formatTargetStages(target: PerformanceTargetTiming): string {
  return target.stageTimings.map((stage) => `${targetStageLabels[stage.name] ?? stage.name} ${formatMs(stage.elapsedMs)}`).join(" · ");
}

function formatAlgorithmParameters(entry: PerformanceRecord): string {
  const parameters = Object.entries(entry.algorithm.parameters);
  if (parameters.length === 0) return "无额外参数";
  return parameters.map(([key, value]) => `${key}=${String(value)}`).join(" · ");
}

function resourceAllocationLabel(entry: PerformanceRecord): string | null {
  const allocation = entry.scheduler.resourceAllocation;
  if (allocation === null) return null;
  if (allocation.source === "custom") return `资源 自定义 ${entry.scheduler.workerCount} Worker`;
  const label = CALCULATION_RESOURCE_PROFILES.find((profile) => profile.id === allocation.profile)?.label ?? allocation.profile;
  const estimate = allocation.estimatedCapacityRatio === null
    ? ""
    : ` · 预计 ${(allocation.estimatedCapacityRatio * 100).toFixed(0)}%`;
  return `资源 ${label} · 目标 ${(allocation.targetCapacityRatio * 100).toFixed(0)}%${estimate}`;
}

function comparisonLabel(index: number, entry: PerformanceRecord): string | null {
  const previous = store.performanceHistory.slice(index + 1).find((candidate) =>
    candidate.operation === entry.operation
    && candidate.workloadKey === entry.workloadKey
    && candidate.device.logicalCores === entry.device.logicalCores
    && candidate.device.platform === entry.device.platform
    && candidate.device.browserName === entry.device.browserName
    && candidate.device.browserMajorVersion === entry.device.browserMajorVersion
    && candidate.algorithm.id === entry.algorithm.id
    && candidate.algorithm.runtime === entry.algorithm.runtime
    && candidate.scheduler.id === entry.scheduler.id
    && candidate.scheduler.mode === entry.scheduler.mode
    && candidate.scheduler.workerCount === entry.scheduler.workerCount
    && candidate.scheduler.resourceAllocation?.profile === entry.scheduler.resourceAllocation?.profile
    && candidate.scheduler.resourceAllocation?.targetCapacityRatio === entry.scheduler.resourceAllocation?.targetCapacityRatio
    && candidate.benchmark?.id === entry.benchmark?.id
    && candidate.benchmark?.environmentKey === entry.benchmark?.environmentKey
  );
  if (previous === undefined || previous.elapsedMs <= 0) return null;
  const sameQuality = previous.successfulCount === entry.successfulCount
    && previous.noMatchCount === entry.noMatchCount
    && previous.unsupportedCount === entry.unsupportedCount
    && previous.exactCount === entry.exactCount
    && previous.approximateCount === entry.approximateCount;
  if (!sameQuality) return "与上一同类记录的结果质量不同，不直接比较耗时";
  const improvement = (previous.elapsedMs - entry.elapsedMs) / previous.elapsedMs * 100;
  if (Math.abs(improvement) < 0.1) return "较上一同类记录基本持平";
  return `较上一同类记录${improvement > 0 ? "快" : "慢"} ${Math.abs(improvement).toFixed(1)}%`;
}

onMounted(() => {
  void run(store.restoreLocalSession);
  void inspectDevice();
});

async function run(action: () => void | Promise<void>): Promise<void> {
  try { await action(); } catch (error) {
    store.error = { stage: "analysis", code: "UI_FAILURE", path: null, message: error instanceof Error ? error.message : "操作失败" };
  }
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark"><ShieldCheck :size="19" /></span>
        <div>
          <strong>御魂决策工作台</strong>
          <span>{{ store.restoring ? '正在恢复本地会话' : '本机自动保存' }}</span>
        </div>
      </div>
      <div class="top-status">
        <span class="privacy-indicator"><LockKeyhole :size="14" /> 无网络 · 内存优先</span>
        <span v-if="store.snapshot" class="snapshot-ref"><Database :size="14" /> {{ store.snapshot.total.toLocaleString() }} 件</span>
      </div>
      <div class="toolbar-actions">
        <button class="icon-button" title="恢复本地项目设置" @click="run(store.loadLocal)"><FolderOpen :size="18" /></button>
        <button class="icon-button" title="保存本地项目" :disabled="!store.snapshot" @click="run(store.saveLocal)"><Save :size="18" /></button>
        <button class="toolbar-command" title="导入全部关卡数据 JSON" :disabled="store.restoring" @click="sceneDataInput?.click()"><Upload :size="17" /><span>导入关卡</span></button>
        <button class="toolbar-command" title="导出全部关卡数据 JSON" :disabled="store.restoring" @click="run(store.exportSceneData)"><DatabaseBackup :size="17" /><span>导出关卡</span></button>
        <input ref="sceneDataInput" class="visually-hidden" type="file" accept="application/json,.json" @change="run(() => chooseSceneData(($event.target as HTMLInputElement).files))" />
        <button class="icon-button" title="导出项目 JSON" :disabled="!store.snapshot" @click="run(store.exportProject)"><Download :size="18" /></button>
        <button class="icon-button" title="导出手机私有交接包" :disabled="!store.copyAllowed" @click="run(store.exportHandoff)"><Smartphone :size="18" /></button>
        <button class="icon-button" title="查看计算性能记录" @click="openPerformanceDialog"><Settings2 :size="18" /></button>
        <button class="icon-button danger" title="清空内存和本机会话" @click="run(store.clearSession)"><Trash2 :size="18" /></button>
      </div>
    </header>

    <aside class="sidebar">
      <nav aria-label="工作台步骤">
        <RouterLink v-for="(step, index) in STEPS" :key="step.id" :to="step.path" :class="{ active: route.name === step.id, complete: index < activeIndex }">
          <span class="step-number">{{ index + 1 }}</span>
          <span>{{ step.label }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar-foot">
        <div><span class="status-dot gold"></span>技术默认草案</div>
        <div><span class="status-dot green"></span>验证通过</div>
        <div><span class="status-dot red"></span>阻塞项</div>
      </div>
    </aside>

    <main class="workspace">
      <div v-if="store.error" class="message error-message" role="alert">
        <strong>{{ store.error.code }}</strong>
        <span>{{ store.error.message }}</span>
        <button title="关闭" @click="store.error = null">×</button>
      </div>
      <div v-if="store.notice" class="message notice-message" role="status">
        <span>{{ store.notice }}</span>
        <button title="关闭" @click="store.notice = null">×</button>
      </div>
      <RouterView />
    </main>

    <div v-if="performanceOpen" class="performance-layer" role="presentation" @click.self="performanceOpen = false">
      <section class="performance-dialog diagnostics-dialog" role="dialog" aria-modal="true" aria-labelledby="performance-title">
        <header>
          <div><span class="eyebrow">LOCAL DIAGNOSTICS</span><h2 id="performance-title">计算性能记录</h2></div>
          <div class="performance-dialog-actions">
            <button class="icon-button" title="导出性能诊断 JSON" :disabled="benchmark === null && store.performanceHistory.length === 0 && store.teamCalculationSchedulerDebugLog === null" @click="exportDiagnostics"><Download :size="16" /></button>
            <button class="icon-button" title="导入性能诊断 JSON" @click="diagnosticsInput?.click()"><Upload :size="16" /></button>
            <button class="icon-button" title="清空性能记录" :disabled="store.performanceHistory.length === 0" @click="store.clearPerformanceRecords"><Trash2 :size="16" /></button>
            <button class="icon-button" title="清空调度调试日志" :disabled="store.teamCalculationSchedulerDebugLog === null" @click="store.clearTeamCalculationSchedulerDebugLog"><Trash2 :size="16" /></button>
            <button class="icon-button" title="关闭" @click="performanceOpen = false"><X :size="18" /></button>
            <input ref="diagnosticsInput" class="visually-hidden" type="file" accept="application/json,.json" @change="importDiagnostics(($event.target as HTMLInputElement).files)" />
          </div>
        </header>
        <div class="diagnostics-layout">
          <nav class="diagnostics-nav" aria-label="诊断设置">
            <button :class="{ active: diagnosticsSection === 'device' }" @click="diagnosticsSection = 'device'"><Cpu :size="16" /><span>基础信息</span></button>
            <button :class="{ active: diagnosticsSection === 'performance' }" @click="diagnosticsSection = 'performance'"><Activity :size="16" /><span>计算性能记录</span><small>{{ store.performanceHistory.length }}</small></button>
            <button v-if="importedDiagnostics !== null" :class="{ active: diagnosticsSection === 'imported' }" @click="diagnosticsSection = 'imported'"><Upload :size="16" /><span>导入诊断</span><small>{{ importedDiagnostics.records.length + (importedDiagnostics.schedulerLog === null ? 0 : 1) }}</small></button>
            <button :class="{ active: diagnosticsSection === 'errors' }" @click="diagnosticsSection = 'errors'"><AlertTriangle :size="16" /><span>错误信息</span><small>{{ calculationErrors.length }}</small></button>
          </nav>
          <div class="performance-dialog-body diagnostics-content">
          <section v-if="diagnosticsSection === 'device'" class="diagnostics-section">
            <header><div><span class="eyebrow">DEVICE</span><h3>基础信息</h3></div><button class="primary" :disabled="benchmarkRunning" @click="run(runPerformanceTest)"><Gauge :size="15" />{{ benchmarkRunning ? '正在测试…' : '性能测试' }}</button></header>
            <div class="telemetry-setting">
              <div><strong>匿名数据收集</strong><span>仅上传性能聚合记录和你主动保存的自定义阵容，不上传快照、御魂 ID 或账号信息。</span><small>接口：{{ telemetryApiUrl() }}</small></div>
              <label class="switch"><input type="checkbox" :checked="telemetryEnabled" @change="updateTelemetryConsent(($event.target as HTMLInputElement).checked)" /><span></span><b>{{ telemetryEnabled ? '已允许' : '已关闭' }}</b></label>
            </div>
            <dl class="device-information">
              <div><dt>系统平台</dt><dd>{{ deviceInfo.platform ?? '浏览器未提供' }}</dd></div>
              <div><dt>浏览器</dt><dd>{{ deviceInfo.browserName === null ? '浏览器未识别' : `${deviceInfo.browserName} ${deviceInfo.browserMajorVersion ?? ''}` }}</dd></div>
              <div><dt>CPU</dt><dd>{{ deviceInfo.logicalCores === null ? '型号不可读取' : `${deviceInfo.logicalCores} 个逻辑核心（浏览器不提供型号）` }}</dd></div>
              <div><dt>内存</dt><dd>{{ deviceInfo.memoryGiB === null ? '浏览器未提供' : `${deviceInfo.memoryGiB} GiB` }}</dd></div>
              <div><dt>GPU</dt><dd>{{ deviceInfo.gpuAdapter ?? (deviceInfo.webGpu ? 'WebGPU 可用，型号不可读取' : '浏览器未提供') }}</dd></div>
              <div><dt>WebGPU 限制</dt><dd>{{ deviceInfo.gpuMaxBufferSize === null ? '浏览器未提供' : `缓冲区 ${Math.round(deviceInfo.gpuMaxBufferSize / 1024 / 1024)} MiB · 工作组 ${deviceInfo.gpuMaxComputeInvocationsPerWorkgroup ?? '-'} / ${deviceInfo.gpuMaxComputeWorkgroupsPerDimension ?? '-'}` }}</dd></div>
              <div><dt>运行环境</dt><dd>WASM {{ deviceInfo.wasm ? '可用' : '不可用' }} · {{ deviceInfo.crossOriginIsolated ? '跨源隔离' : '普通环境' }}</dd></div>
              <div><dt>CPU 单核</dt><dd>{{ benchmark === null ? '尚未测试' : `${benchmark.cpuSingle.evaluationsPerSecond.toLocaleString()} 组合/秒` }}</dd></div>
              <div><dt>CPU 多核</dt><dd>{{ benchmark === null ? '尚未测试' : `${benchmark.cpuMulti.evaluationsPerSecond.toLocaleString()} 组合/秒 · ${benchmark.cpuMultiWorkerCount} Worker` }}</dd></div>
              <div><dt>CPU 并行倍率</dt><dd>{{ benchmark === null ? '尚未测试' : `${benchmark.cpuParallelSpeedup.toFixed(2)}×` }}</dd></div>
              <div><dt>阵容计算资源</dt><dd><select :value="store.teamCalculationResourceProfile" :disabled="store.busy !== null" aria-label="阵容计算资源档位" @change="updateTeamCalculationResourceProfile(($event.target as HTMLSelectElement).value)"><option v-for="profile in CALCULATION_RESOURCE_PROFILES" :key="profile.id" :value="profile.id">{{ profile.label }}</option></select></dd></div>
              <div><dt>性能诊断</dt><dd><label class="switch"><input type="checkbox" :checked="store.teamCalculationSchedulerDebugEnabled" :disabled="store.busy !== null" aria-label="记录性能诊断" @change="updateTeamCalculationSchedulerDebugEnabled(($event.target as HTMLInputElement).checked)" /><span></span><b>{{ store.teamCalculationSchedulerDebugEnabled ? '开启' : '关闭' }}</b></label></dd></div>
              <div v-if="store.teamCalculationResourceProfile === 'custom'"><dt>自定义 Worker</dt><dd><input :value="store.customTeamCalculationWorkerCount ?? 1" :disabled="store.busy !== null" type="number" min="1" max="64" step="1" inputmode="numeric" aria-label="自定义阵容计算 Worker 数" @change="updateCustomTeamCalculationWorkerCount(($event.target as HTMLInputElement).value)" /></dd></div>
              <div><dt>内存吞吐</dt><dd>{{ benchmark === null ? '尚未测试' : `${benchmark.memory.mebibytesPerSecond.toLocaleString()} MiB/秒` }}</dd></div>
              <div><dt>GPU 计算</dt><dd>{{ benchmark === null ? '尚未测试' : benchmark.gpu.status === 'completed' ? `${benchmark.gpu.iterationsPerSecond?.toLocaleString()} f32 迭代/秒` : `${benchmark.gpu.status} · ${benchmark.gpu.reason ?? '无详情'}` }}</dd></div>
              <div><dt>GPU 传输</dt><dd>{{ benchmark?.gpu.status !== 'completed' ? '尚无数据' : `上传 ${benchmark.gpu.uploadMebibytesPerSecond?.toLocaleString() ?? '-'} · 回读 ${benchmark.gpu.readbackMebibytesPerSecond?.toLocaleString() ?? '-'} MiB/秒` }}</dd></div>
              <div><dt>GPU 初始化</dt><dd>{{ benchmark?.gpu.initializationMs == null ? '尚无数据' : formatMs(benchmark.gpu.initializationMs) }}</dd></div>
              <div><dt>测试总耗时</dt><dd>{{ benchmark === null ? '尚未测试' : formatMs(benchmark.totalDurationMs) }}</dd></div>
              <div><dt>基准版本</dt><dd>{{ benchmark === null ? 'onmyoji-hardware-profile-v1' : `${benchmark.id} · ${formatRecordedAt(benchmark.measuredAt)}` }}</dd></div>
            </dl>
            <p class="performance-notice">真实计算开始前会自动刷新超过 24 小时的画像；一次测试依次测量御魂搜索 1 至 N Worker 的吞吐曲线、内存与 WebGPU。阵容计算按所选档位从曲线中选择并发数，结果保存在本机并附加到之后的计算记录。</p>
          </section>
          <section v-else-if="diagnosticsSection === 'performance'" class="diagnostics-section">
            <div v-if="store.performanceHistory.length === 0" class="performance-empty">
              <Activity :size="20" />
              <span>完成一次阵容计算、完整分析或验证模拟后，这里会显示性能摘要。</span>
            </div>
            <template v-else>
            <div class="performance-notice">仅保存在本机浏览器；当前未上传网络。记录不包含阵容码、御魂 ID 或原始快照。</div>
            <article v-for="(entry, index) in store.performanceHistory" :key="entry.id" class="performance-entry">
              <div class="performance-entry-head">
                <div><strong>{{ operationLabels[entry.operation] }}</strong><span>{{ formatRecordedAt(entry.recordedAt) }}</span></div>
                <b>{{ formatMs(entry.elapsedMs) }}</b>
              </div>
              <dl class="performance-metrics">
                <div><dt>御魂数量</dt><dd>{{ formatCount(entry.itemCount) }}</dd></div>
                <div><dt>计算目标</dt><dd>{{ formatCount(entry.targetCount) }}</dd></div>
                <div><dt>指标数量</dt><dd>{{ formatCount(entry.metricCount) }}</dd></div>
                <div><dt>候选御魂</dt><dd>{{ formatCount(entry.candidateCount) }}</dd></div>
                <div><dt>候选组合</dt><dd>{{ entry.candidateCombinations.toLocaleString() }}</dd></div>
                <div><dt>实际评估</dt><dd>{{ entry.evaluatedCombinations.toLocaleString() }}</dd></div>
                <div v-if="entry.categoryCount !== null"><dt>分析类别</dt><dd>{{ entry.categoryCount.toLocaleString() }}</dd></div>
                <div v-if="entry.sampleSize !== null"><dt>模拟样本</dt><dd>{{ entry.sampleSize.toLocaleString() }}</dd></div>
              </dl>
              <div class="performance-stages">
                <span v-for="stage in entry.stages" :key="stage.name">{{ stage.name }} <b>{{ formatMs(stage.elapsedMs) }}</b></span>
              </div>
              <div class="performance-comparison">算法 {{ entry.algorithm.id }} · {{ entry.algorithm.runtime }} · 调度 {{ entry.scheduler.id }} / {{ entry.scheduler.mode }} · Worker {{ entry.scheduler.workerCount }}<template v-if="resourceAllocationLabel(entry)"> · {{ resourceAllocationLabel(entry) }}</template> · 剪枝 {{ entry.pruningRate === null ? "-" : `${(entry.pruningRate * 100).toFixed(1)}%` }} · 搜索吞吐 {{ entry.evaluatedPerSecond === null ? "-" : `${Math.round(entry.evaluatedPerSecond).toLocaleString()}/s` }} · 端到端吞吐 {{ entry.endToEndEvaluatedPerSecond === null ? "-" : `${Math.round(entry.endToEndEvaluatedPerSecond).toLocaleString()}/s` }} · 精确 {{ entry.exactCount }} / 近似 {{ entry.approximateCount }}</div>
              <div class="performance-parameters">参数：{{ formatAlgorithmParameters(entry) }}</div>
              <details v-if="entry.analysisDiagnostics" class="performance-targets">
                <summary>查看分析诊断</summary>
                <div class="performance-metrics">
                  <div><dt>+15 御魂</dt><dd>{{ entry.analysisDiagnostics.level15Count.toLocaleString() }}</dd></div>
                  <div><dt>六星 +0 样本</dt><dd>{{ entry.analysisDiagnostics.level0SampleCount.toLocaleString() }}</dd></div>
                  <div><dt>有样本类别</dt><dd>{{ entry.analysisDiagnostics.observedCategoryCount.toLocaleString() }} / {{ entry.analysisDiagnostics.categoryCount.toLocaleString() }}</dd></div>
                  <div><dt>规则扫描</dt><dd>{{ entry.analysisDiagnostics.ruleCount.toLocaleString() }} 条</dd></div>
                  <div><dt>阵容报告 / 实体</dt><dd>{{ entry.analysisDiagnostics.teamReportCount.toLocaleString() }} / {{ entry.analysisDiagnostics.teamEntityCount.toLocaleString() }}</dd></div>
                  <div><dt>潜力证据 / 御魂</dt><dd>{{ entry.analysisDiagnostics.potentialEvidenceCount.toLocaleString() }} / {{ entry.analysisDiagnostics.potentialYuhunCount.toLocaleString() }}</dd></div>
                  <div><dt>Tier 1 候选</dt><dd>{{ entry.analysisDiagnostics.tier1CandidateCount.toLocaleString() }}</dd></div>
                  <div><dt>Tier 1 覆盖上限</dt><dd>{{ entry.analysisDiagnostics.tier1MaximumCoverage.toLocaleString() }}</dd></div>
                  <div><dt>背包状态转移</dt><dd>{{ entry.analysisDiagnostics.tier1TransitionCount.toLocaleString() }}</dd></div>
                  <div><dt>背包状态更新</dt><dd>{{ entry.analysisDiagnostics.tier1UpdatedStateCount.toLocaleString() }}</dd></div>
                </div>
                <div class="performance-stages"><span v-for="stage in entry.analysisDiagnostics.stages" :key="stage.name">{{ stage.name }} <b>{{ formatMs(stage.elapsedMs) }}</b></span></div>
              </details>
              <div v-if="comparisonLabel(index, entry)" class="performance-delta">{{ comparisonLabel(index, entry) }}</div>
              <details v-if="entry.targets.length > 0" class="performance-targets">
                <summary>查看各目标耗时（{{ entry.targets.length }}）</summary>
                <div v-for="target in entry.targets" :key="`${entry.id}-${target.index}`" class="performance-target-row">
                  <span>目标 {{ target.index }}</span><span>{{ formatMs(target.elapsedMs) }}</span><span>评估 {{ target.evaluatedCombinations.toLocaleString() }}</span><span>{{ formatTargetStages(target) }}</span>
                </div>
              </details>
              <div class="performance-device">环境：{{ entry.device.platform ?? "未知平台" }} · {{ entry.device.browserName ?? "未知浏览器" }} {{ entry.device.browserMajorVersion ?? "" }} · {{ entry.device.logicalCores === null ? "核心数未知" : `${entry.device.logicalCores} 逻辑核心` }} · {{ entry.device.memoryGiB === null ? "内存未知" : `${entry.device.memoryGiB} GiB` }} · WASM {{ entry.device.wasm ? "可用" : "不可用" }} · WebGPU {{ entry.device.webGpu ? (entry.device.gpuAdapter ?? "可用") : "不可用" }}</div>
              <div class="performance-device">基准：{{ entry.benchmark === null ? "记录时未测试" : `${entry.benchmark.id} · CPU ${entry.benchmark.cpuSingle.evaluationsPerSecond.toLocaleString()} / ${entry.benchmark.cpuMulti.evaluationsPerSecond.toLocaleString()} 组合/秒 · 内存 ${entry.benchmark.memory.mebibytesPerSecond.toLocaleString()} MiB/秒 · GPU ${entry.benchmark.gpu.iterationsPerSecond?.toLocaleString() ?? entry.benchmark.gpu.status}` }} · 目标耗时合计 {{ formatMs(entry.targetElapsedMs) }} · 非目标阶段 {{ formatMs(entry.overheadMs) }}</div>
            </article>
            </template>
          </section>
          <section v-else-if="diagnosticsSection === 'imported' && importedDiagnostics !== null" class="diagnostics-section">
            <div class="performance-notice">导入文件只读查看，不会恢复快照、项目设置或计算结果。</div>
            <dl class="performance-metrics">
              <div><dt>导出时间</dt><dd>{{ formatRecordedAt(importedDiagnostics.exportedAt) }}</dd></div>
              <div><dt>来源</dt><dd>{{ importedDiagnostics.sourceKind === 'unified' ? '统一诊断包' : importedDiagnostics.sourceKind === 'performance' ? '旧性能记录' : '旧调度日志' }}</dd></div>
              <div><dt>性能记录</dt><dd>{{ importedDiagnostics.records.length.toLocaleString() }}</dd></div>
              <div><dt>调度事件</dt><dd>{{ importedDiagnostics.schedulerLog?.events.length.toLocaleString() ?? '-' }}</dd></div>
            </dl>
            <article v-for="entry in importedDiagnostics.records" :key="entry.id" class="performance-entry">
              <div class="performance-entry-head"><div><strong>{{ operationLabels[entry.operation] }}</strong><span>{{ formatRecordedAt(entry.recordedAt) }}</span></div><b>{{ formatMs(entry.elapsedMs) }}</b></div>
              <div class="performance-stages"><span v-for="stage in entry.stages" :key="stage.name">{{ stage.name }} <b>{{ formatMs(stage.elapsedMs) }}</b></span></div>
              <div v-if="entry.analysisDiagnostics" class="performance-comparison">分析：+0 样本 {{ entry.analysisDiagnostics.level0SampleCount.toLocaleString() }} · 潜力证据 {{ entry.analysisDiagnostics.potentialEvidenceCount.toLocaleString() }} · 背包转移 {{ entry.analysisDiagnostics.tier1TransitionCount.toLocaleString() }}</div>
            </article>
            <article v-if="importedDiagnostics.schedulerLog" class="performance-entry">
              <div class="performance-entry-head"><div><strong>阵容调度</strong><span>{{ formatRecordedAt(importedDiagnostics.schedulerLog.recordedAt) }}</span></div><b>{{ importedDiagnostics.schedulerLog.events.length.toLocaleString() }} 事件</b></div>
              <div class="performance-comparison">{{ importedDiagnostics.schedulerLog.resourceProfile }} · {{ importedDiagnostics.schedulerLog.requestedWorkerCount }} Worker · {{ importedDiagnostics.schedulerLog.requestCount }} 请求 · 丢弃 {{ importedDiagnostics.schedulerLog.droppedEventCount }} 事件</div>
            </article>
          </section>
          <section v-else class="diagnostics-section">
            <div v-if="calculationErrors.length === 0" class="performance-empty"><AlertTriangle :size="20" /><span>当前没有阵容计算错误。</span></div>
            <template v-else>
              <article v-for="report in calculationErrors" :key="report.id" class="diagnostics-error-entry">
                <strong>{{ report.label }}</strong>
                <pre>{{ formatTeamCalculationError(report, resolveShikigamiName) }}</pre>
              </article>
            </template>
          </section>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
