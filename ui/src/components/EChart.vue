<script setup lang="ts">
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EChartsCoreOption } from "echarts/core";

echarts.use([BarChart, HeatmapChart, PieChart, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

const props = defineProps<{ option: EChartsCoreOption; height?: number }>();
const root = ref<HTMLDivElement | null>(null);
let chart: ReturnType<typeof echarts.init> | null = null;
let observer: ResizeObserver | null = null;

onMounted(() => {
  chart = echarts.init(root.value!, undefined, { renderer: "canvas" });
  chart.setOption(props.option, true);
  observer = new ResizeObserver(() => chart?.resize());
  observer.observe(root.value!);
});

watch(() => props.option, (option) => chart?.setOption(option, true), { deep: true });
onBeforeUnmount(() => {
  observer?.disconnect();
  chart?.dispose();
});
</script>

<template>
  <div ref="root" class="chart" :style="{ height: `${height ?? 240}px` }" role="img" aria-label="分析图表"></div>
</template>
