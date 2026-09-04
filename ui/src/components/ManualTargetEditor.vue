<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Check, ChevronDown, Plus, Search, Trash2, UserRoundPlus, X } from "@lucide/vue";
import type {
  ManualShikigamiCalculationInput,
  ManualSuitRequirement,
  PanelStatId,
  StatId,
  TeamMetricId
} from "../../../src/browser.js";
import {
  MAIN_STAT_OPTIONS,
  METRIC_PRESETS,
  SHIKIGAMI_OPTIONS,
  SHIKIGAMI_RARITY_OPTIONS,
  YUHUN_CATEGORY_OPTIONS,
  YUHUN_OPTIONS,
  metricPreset,
  yuhunCategory,
  yuhunImage,
  yuhunPlaceholder,
  type MainStat,
  type MainStatSlot,
  type MetricOption,
  type ShikigamiOption,
  type YuhunCategory,
  type YuhunOption
} from "../manual-target-config.js";

interface AttributeLimit {
  readonly id: number;
  stat: string;
  min: string;
  max: string;
}

interface ExtraAttributeInputs {
  attackPercent: string;
  attack: string;
  crit: string;
  critDamage: string;
}

interface ManualShikigamiTarget {
  readonly slot: number;
  shikigami: ShikigamiOption | null;
  suitRequirements: ManualSuitRequirement[];
  suitSelectionComplete: boolean;
  metric: MetricOption;
  targetScore: string;
  main2: MainStat[];
  main4: MainStat[];
  main6: MainStat[];
  highestStat: string;
  limits: AttributeLimit[];
  extraAttributes: ExtraAttributeInputs;
  scope: "all" | "unequipped";
  sixStarOnly: boolean;
  maxLevelOnly: boolean;
  excludeOccupied: boolean;
  yuhunConfigEnabled: boolean;
}

const props = withDefaults(defineProps<{
  initialTargets?: readonly ManualShikigamiCalculationInput[];
  readOnly?: boolean;
}>(), {
  initialTargets: () => [],
  readOnly: false
});

const emit = defineEmits<{
  configuredChange: [count: number];
  draftsChange: [drafts: readonly ManualShikigamiCalculationInput[]];
}>();

const METRIC_OPTIONS = Object.keys(METRIC_PRESETS) as MetricOption[];
const LIMIT_STAT_OPTIONS = ["攻击", "暴击", "暴击伤害", "速度", "防御", "生命", "效果命中", "效果抵抗"] as const;

const METRIC_IDS: Readonly<Record<MetricOption, TeamMetricId>> = {
  "伤害输出": 1, "效果命中": 2, "效果抵抗": 3, "生命": 4,
  "攻击": 5, "防御": 6, "速度": 7, "暴击": 8,
  "暴击伤害": 9, "治疗量": 10, "命抗双修": 11, "防御输出": 12
};

const MAIN_STAT_IDS: Readonly<Record<MainStat, StatId>> = {
  "攻击加成": "attackPercent",
  "生命加成": "hpPercent",
  "防御加成": "defensePercent",
  "速度": "speed",
  "效果命中": "effectHit",
  "效果抵抗": "effectResist",
  "暴击": "crit",
  "暴击伤害": "critDamage"
};

const PANEL_STAT_IDS: Readonly<Record<string, PanelStatId | "extra">> = {
  "攻击": "attack",
  "暴击": "crit",
  "暴击伤害": "critDamage",
  "速度": "speed",
  "防御": "defense",
  "生命": "hp",
  "效果命中": "effectHit",
  "效果抵抗": "effectResist",
  "额外属性": "extra"
};

const SHIKIGAMI_BY_HERO_ID = new Map(SHIKIGAMI_OPTIONS.map((item) => [item.heroId, item]));
const METRIC_BY_ID = new Map(Object.entries(METRIC_IDS).map(([label, id]) => [id, label as MetricOption]));
const MAIN_STAT_BY_ID = new Map(Object.entries(MAIN_STAT_IDS).map(([label, id]) => [id, label as MainStat]));
const PANEL_STAT_BY_ID = new Map(Object.entries(PANEL_STAT_IDS).map(([label, id]) => [id, label]));
let nextLimitId = 1;

function makeTarget(slot: number, input?: ManualShikigamiCalculationInput): ManualShikigamiTarget {
  const preset = metricPreset("伤害输出");
  if (input !== undefined) {
    const catalogShikigami = SHIKIGAMI_BY_HERO_ID.get(input.shikigamiId);
    const shikigami: ShikigamiOption = catalogShikigami ?? {
      id: `unknown-${input.shikigamiId}`,
      heroId: input.shikigamiId,
      name: input.shikigamiName || `式神 #${input.shikigamiId}`,
      rarity: "",
      avatar: ""
    };
    const rangeLabel = (stat: PanelStatId | "extra") => PANEL_STAT_BY_ID.get(stat) ?? "额外属性";
    return {
      slot,
      shikigami,
      suitRequirements: manualSuitRequirementsFromInput(input),
      suitSelectionComplete: input.suitSelectionComplete === true,
      metric: METRIC_BY_ID.get(input.metricId) ?? "伤害输出",
      targetScore: input.targetScore === null ? "" : String(input.targetScore),
      main2: (input.mainStats[2] ?? []).flatMap((stat) => MAIN_STAT_BY_ID.get(stat) ?? []),
      main4: (input.mainStats[4] ?? []).flatMap((stat) => MAIN_STAT_BY_ID.get(stat) ?? []),
      main6: (input.mainStats[6] ?? []).flatMap((stat) => MAIN_STAT_BY_ID.get(stat) ?? []),
      highestStat: input.highestStat === null ? "不限" : rangeLabel(input.highestStat),
      limits: input.ranges.map((range) => ({
        id: nextLimitId++,
        stat: rangeLabel(range.stat),
        min: range.min === undefined ? "" : String(range.min),
        max: range.max === undefined ? "" : String(range.max)
      })),
      extraAttributes: {
        attackPercent: input.extraAttributes?.attackPercent === undefined ? "" : String(input.extraAttributes.attackPercent * 100),
        attack: input.extraAttributes?.attack === undefined ? "" : String(input.extraAttributes.attack),
        crit: input.extraAttributes?.crit === undefined ? "" : String(input.extraAttributes.crit * 100),
        critDamage: input.extraAttributes?.critDamage === undefined ? "" : String(input.extraAttributes.critDamage * 100)
      },
      scope: input.scope,
      sixStarOnly: input.sixStarOnly,
      maxLevelOnly: input.maxLevelOnly,
      excludeOccupied: input.excludeOccupied,
      yuhunConfigEnabled: input.yuhunConfigEnabled !== false
    };
  }
  return {
    slot,
    shikigami: null,
    suitRequirements: [],
    suitSelectionComplete: false,
    metric: "伤害输出",
    targetScore: "",
    main2: [...preset[2]],
    main4: [...preset[4]],
    main6: [...preset[6]],
    highestStat: "不限",
    limits: [],
    extraAttributes: { attackPercent: "", attack: "", crit: "", critDamage: "" },
    scope: "all",
    sixStarOnly: true,
    maxLevelOnly: true,
    excludeOccupied: false,
    yuhunConfigEnabled: true
  };
}

const targets = ref<ManualShikigamiTarget[]>(Array.from({ length: 6 }, (_, index) => {
  const slot = index + 1;
  return makeTarget(slot, props.initialTargets.find((target) => target.entityIndex === slot));
}));
const activeSlot = ref(props.initialTargets[0]?.entityIndex ?? 1);
const shikigamiPickerOpen = ref(false);
const shikigamiSearch = ref("");
const shikigamiRarity = ref<(typeof SHIKIGAMI_RARITY_OPTIONS)[number]>("全部");
const yuhunPickerOpen = ref(false);
const activeSuitIndex = ref<number | null>(null);
const activeSuitCount = ref<2 | 4>(4);
const yuhunSearch = ref("");
const activeYuhunCategory = ref<YuhunCategory>("全部");

const activeTarget = computed(() => targets.value[activeSlot.value - 1] ?? null);
const configuredCount = computed(() => targets.value.filter((target) => target.shikigami !== null && target.yuhunConfigEnabled).length);
const visibleShikigami = computed(() => {
  const query = shikigamiSearch.value.trim().toLocaleLowerCase();
  return SHIKIGAMI_OPTIONS.filter((item) => {
    const matchesRarity = shikigamiRarity.value === "全部" || item.rarity === shikigamiRarity.value;
    const matchesSearch = query === "" || item.name.toLocaleLowerCase().includes(query) || item.rarity.toLocaleLowerCase().includes(query);
    return matchesRarity && matchesSearch;
  });
});
const visibleYuhun = computed(() => {
  const query = yuhunSearch.value.trim().toLocaleLowerCase();
  const options = YUHUN_OPTIONS.filter((item) => {
    const category = item.category;
    const matchesCategory = activeYuhunCategory.value === "全部" || category === activeYuhunCategory.value;
    const validForSlot = activeSuitCount.value === 2 || (item.twoPieceEffect !== true && category !== "首领御魂");
    return validForSlot && matchesCategory && (query === "" || item.name.toLocaleLowerCase().includes(query) || category.includes(query));
  });
  if (activeSuitCount.value !== 2) return options;
  return [...options].sort((left, right) => twoPieceOptionOrder(left) - twoPieceOptionOrder(right));
});

watch(configuredCount, (count) => emit("configuredChange", count), { immediate: true });
watch(targets, () => emit("draftsChange", calculationDrafts()), { deep: true, immediate: true });

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function calculationDrafts(): ManualShikigamiCalculationInput[] {
  return targets.value.flatMap((target) => {
    if (target.shikigami === null || !Number.isSafeInteger(target.shikigami.heroId)) return [];
    return [{
      entityIndex: target.slot,
      shikigamiId: target.shikigami.heroId,
      shikigamiName: target.shikigami.name,
      metricId: METRIC_IDS[target.metric],
      suits: target.suitRequirements.map((requirement) => requirement.name),
      suitRequirements: target.suitRequirements.map((requirement) => ({ ...requirement })),
      suitSelectionComplete: target.suitSelectionComplete,
      mainStats: {
        2: target.main2.map((stat) => MAIN_STAT_IDS[stat]),
        4: target.main4.map((stat) => MAIN_STAT_IDS[stat]),
        6: target.main6.map((stat) => MAIN_STAT_IDS[stat])
      },
      ranges: target.limits.map((limit) => {
        const min = optionalNumber(limit.min);
        const max = optionalNumber(limit.max);
        return {
          stat: PANEL_STAT_IDS[limit.stat]!,
          ...(min === undefined ? {} : { min }),
          ...(max === undefined ? {} : { max }),
          percentage: ["暴击", "暴击伤害", "效果命中", "效果抵抗"].includes(limit.stat)
        };
      }),
      extraAttributes: {
        ...(optionalNumber(target.extraAttributes.attackPercent) === undefined ? {} : { attackPercent: optionalNumber(target.extraAttributes.attackPercent)! / 100 }),
        ...(optionalNumber(target.extraAttributes.attack) === undefined ? {} : { attack: optionalNumber(target.extraAttributes.attack)! }),
        ...(optionalNumber(target.extraAttributes.crit) === undefined ? {} : { crit: optionalNumber(target.extraAttributes.crit)! / 100 }),
        ...(optionalNumber(target.extraAttributes.critDamage) === undefined ? {} : { critDamage: optionalNumber(target.extraAttributes.critDamage)! / 100 })
      },
      sixStarOnly: target.sixStarOnly,
      maxLevelOnly: target.maxLevelOnly,
      highestStat: target.highestStat === "不限"
        ? null
        : PANEL_STAT_IDS[target.highestStat]!,
      scope: target.scope,
      excludeOccupied: target.excludeOccupied,
      targetScore: optionalNumber(target.targetScore) ?? null,
      yuhunConfigEnabled: target.yuhunConfigEnabled
    }];
  });
}

function openShikigamiPicker(slot: number): void {
  activeSlot.value = slot;
  shikigamiSearch.value = "";
  shikigamiRarity.value = "全部";
  shikigamiPickerOpen.value = true;
}

function selectShikigami(shikigami: ShikigamiOption): void {
  const target = activeTarget.value;
  if (target === null) return;
  target.shikigami = shikigami;
  shikigamiPickerOpen.value = false;
}

function clearActiveTarget(): void {
  targets.value[activeSlot.value - 1] = makeTarget(activeSlot.value);
}

function manualSuitRequirementsFromInput(input: ManualShikigamiCalculationInput): ManualSuitRequirement[] {
  if (input.suitRequirements !== undefined) {
    return input.suitRequirements
      .filter((requirement) => requirement.name.trim() !== "" && (requirement.count === 2 || requirement.count === 4))
      .map((requirement) => ({ ...requirement }));
  }
  return input.suits.filter(Boolean).map((name, index) => ({ name, count: index === 0 ? 4 : 2 }));
}

function selectedSuitCapacity(target: ManualShikigamiTarget, excludingIndex: number | null = null): number {
  return target.suitRequirements.reduce((total, requirement, index) => (
    index === excludingIndex ? total : total + requirement.count
  ), 0);
}

function canSelectSuitCount(count: 2 | 4): boolean {
  const target = activeTarget.value;
  return target !== null && selectedSuitCapacity(target, activeSuitIndex.value) + count <= 6;
}

function addSuit(): void {
  if (activeTarget.value === null || activeTarget.value.suitSelectionComplete || selectedSuitCapacity(activeTarget.value) > 4) return;
  openYuhunPicker(null);
}

function openYuhunPicker(index: number | null): void {
  const target = activeTarget.value;
  if (target === null) return;
  activeSuitIndex.value = index;
  const remaining = 6 - selectedSuitCapacity(target, index);
  activeSuitCount.value = index === null
    ? remaining === 2 ? 2 : 4
    : target.suitRequirements[index]!.count;
  yuhunSearch.value = "";
  activeYuhunCategory.value = "全部";
  yuhunPickerOpen.value = true;
}

function selectSuitCount(count: 2 | 4): void {
  const target = activeTarget.value;
  if (target === null || !canSelectSuitCount(count)) return;
  activeSuitCount.value = count;
  activeYuhunCategory.value = "全部";
}

function selectYuhun(name: string): void {
  const target = activeTarget.value;
  if (target === null) return;
  if (name === "散件") {
    if (activeSuitIndex.value !== null) target.suitRequirements.splice(activeSuitIndex.value, 1);
    target.suitSelectionComplete = true;
    yuhunPickerOpen.value = false;
    return;
  }
  const requirement = { name, count: activeSuitCount.value } as const;
  if (activeSuitIndex.value === null) target.suitRequirements.push(requirement);
  else target.suitRequirements.splice(activeSuitIndex.value, 1, requirement);
  target.suitSelectionComplete = false;
  yuhunPickerOpen.value = false;
}

function isUnavailableYuhun(item: YuhunOption): boolean {
  const target = activeTarget.value;
  if (target === null) return true;
  return !canSelectSuitCount(activeSuitCount.value)
    || target.suitRequirements.some((requirement, index) => index !== activeSuitIndex.value && requirement.name === item.name);
}

function removeYuhun(index: number): void {
  const target = activeTarget.value;
  if (target === null) return;
  target.suitRequirements.splice(index, 1);
  target.suitSelectionComplete = false;
  if (activeSuitIndex.value === index) yuhunPickerOpen.value = false;
}

function clearScatteredSelection(): void {
  if (activeTarget.value === null) return;
  activeTarget.value.suitSelectionComplete = false;
}

function twoPieceOptionOrder(item: YuhunOption): number {
  if (item.twoPieceEffect === true) return 0;
  if (item.category === "首领御魂") return 1;
  return 2;
}

function applyMetricPreset(): void {
  const target = activeTarget.value;
  if (target === null) return;
  const preset = metricPreset(target.metric);
  target.main2 = [...preset[2]];
  target.main4 = [...preset[4]];
  target.main6 = [...preset[6]];
}

function selectedMainStats(target: ManualShikigamiTarget, slot: MainStatSlot): MainStat[] {
  if (slot === 2) return target.main2;
  if (slot === 4) return target.main4;
  return target.main6;
}

function toggleMainStat(slot: MainStatSlot, stat: MainStat | "任意"): void {
  const target = activeTarget.value;
  if (target === null) return;
  const key = `main${slot}` as "main2" | "main4" | "main6";
  if (stat === "任意") {
    target[key] = [];
    return;
  }
  const current = target[key];
  target[key] = current.includes(stat) ? current.filter((item) => item !== stat) : [...current, stat];
}

function addLimit(): void {
  activeTarget.value?.limits.push({ id: nextLimitId++, stat: "速度", min: "", max: "" });
}

function removeLimit(id: number): void {
  const target = activeTarget.value;
  if (target === null) return;
  target.limits = target.limits.filter((limit) => limit.id !== id);
}
</script>

<template>
  <section class="manual-target-editor" :class="{ 'read-only': readOnly }" data-testid="manual-target-editor">
    <nav class="manual-team-strip" aria-label="阵容式神槽位">
      <button v-for="target in targets" :key="target.slot" :disabled="readOnly && target.shikigami === null" :class="{ active: activeSlot === target.slot, configured: target.shikigami !== null, 'calculation-disabled': target.shikigami !== null && !target.yuhunConfigEnabled }" :aria-label="target.shikigami ? `${readOnly ? '查看' : '编辑'}${target.shikigami.name}${target.yuhunConfigEnabled ? '' : '，无需配置御魂'}` : `选择槽位${target.slot}式神`" @click="target.shikigami ? activeSlot = target.slot : openShikigamiPicker(target.slot)">
        <span class="manual-slot-number">{{ target.slot }}</span>
        <template v-if="target.shikigami"><img v-if="target.shikigami.avatar" :src="target.shikigami.avatar" :alt="target.shikigami.name" /><span v-else class="avatar-fallback">{{ target.shikigami.name.slice(0, 1) }}</span><strong>{{ target.shikigami.name }}</strong><small>{{ target.yuhunConfigEnabled ? target.metric : '无需配置御魂' }}</small></template>
        <template v-else><span class="manual-slot-plus"><Plus :size="20" /></span><strong>添加式神</strong><small>未配置</small></template>
      </button>
    </nav>

    <fieldset class="manual-editor-main" :disabled="readOnly">
      <section v-if="activeTarget?.shikigami" class="manual-config" aria-label="御魂搭配设置">
        <header class="manual-config-title">
          <div class="selected-shikigami">
            <img v-if="activeTarget.shikigami.avatar" :src="activeTarget.shikigami.avatar" :alt="activeTarget.shikigami.name" />
            <span v-else class="avatar-fallback">{{ activeTarget.shikigami.name.slice(0, 1) }}</span>
            <div><span>槽位 {{ activeTarget.slot }} · {{ activeTarget.shikigami.rarity }}</span><h3>{{ activeTarget.shikigami.name }}</h3></div>
          </div>
          <div class="selected-shikigami-actions">
            <label class="yuhun-config-toggle"><input v-model="activeTarget.yuhunConfigEnabled" type="checkbox" :true-value="false" :false-value="true" />无需配置御魂</label>
            <button @click="openShikigamiPicker(activeTarget.slot)"><UserRoundPlus :size="15" />更换式神</button>
            <button class="danger" title="移除此式神" @click="clearActiveTarget"><Trash2 :size="15" /></button>
          </div>
        </header>

        <fieldset class="manual-config-columns" :disabled="!activeTarget.yuhunConfigEnabled">
          <section class="manual-config-panel">
            <header><span>YUHUN TARGET</span><h4>御魂指定</h4></header>
            <div class="manual-field-grid">
              <div class="wide-field suit-field"><span class="field-label">御魂套装</span><div class="suit-trigger-grid">
                <div v-for="(requirement, index) in activeTarget.suitRequirements" :key="`${requirement.name}-${index}`" class="suit-selection">
                  <button class="suit-trigger" :data-suit-count="requirement.count" @click="openYuhunPicker(index)">
                    <img v-if="yuhunImage(requirement.name)" :src="yuhunImage(requirement.name)!" alt="" />
                    <span v-else class="suit-mark">{{ yuhunPlaceholder(requirement.name) }}</span>
                    <span><small>{{ requirement.count }}件套</small><strong>{{ requirement.name }}</strong></span>
                    <ChevronDown :size="15" />
                  </button>
                  <button class="suit-remove" :title="`移除${requirement.name}`" :aria-label="`移除${requirement.name}`" @click="removeYuhun(index)"><X :size="13" /></button>
                </div>
                <div v-if="activeTarget.suitSelectionComplete" class="suit-selection">
                  <button class="suit-trigger scattered-suit-trigger" data-suit-count="0" @click="openYuhunPicker(null)">
                    <span class="suit-mark">散</span>
                    <span><small>散件</small><strong>散件</strong></span>
                    <ChevronDown :size="15" />
                  </button>
                  <button class="suit-remove" title="取消散件选择" aria-label="取消散件选择" @click="clearScatteredSelection"><X :size="13" /></button>
                </div>
                <button v-if="!activeTarget.suitSelectionComplete && selectedSuitCapacity(activeTarget) <= 4" class="suit-add" title="添加御魂套装" aria-label="添加御魂套装" @click="addSuit"><Plus :size="21" /></button>
              </div></div>
              <label><span>效果指标</span><select v-model="activeTarget.metric" data-testid="metric-select" @change="applyMetricPreset"><option v-for="metric in METRIC_OPTIONS" :key="metric">{{ metric }}</option></select></label>
              <label><span>目标评分</span><input v-model="activeTarget.targetScore" inputmode="decimal" placeholder="可选" /></label>
              <div class="wide-field main-stat-field">
                <div class="main-stat-heading"><span class="field-label">2 / 4 / 6 号位主属性</span><small>切换指标自动推荐，可继续多选</small></div>
                <div class="main-stat-slots">
                  <div v-for="slot in ([2, 4, 6] as const)" :key="slot" class="main-stat-slot" :data-slot="slot">
                    <strong>{{ slot }} 号位</strong>
                    <div role="group" :aria-label="`${slot}号位主属性`">
                      <button :class="{ selected: selectedMainStats(activeTarget, slot).length === 0 }" @click="toggleMainStat(slot, '任意')">任意</button>
                      <button v-for="stat in MAIN_STAT_OPTIONS[slot]" :key="stat" :class="{ selected: selectedMainStats(activeTarget, slot).includes(stat) }" @click="toggleMainStat(slot, stat)">{{ stat }}</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section class="manual-config-panel advanced-config-panel">
            <header><span>ADVANCED</span><h4>高级定制</h4></header>
            <div class="advanced-config-body">
              <label class="highest-stat-field"><span>最高属性</span><select v-model="activeTarget.highestStat"><option value="不限">不限制</option><option v-for="stat in LIMIT_STAT_OPTIONS" :key="stat">{{ stat }}</option></select></label>
              <div class="extra-attribute-fields">
                <strong>额外属性</strong>
                <div>
                  <label><span>攻击加成 (%)</span><input v-model="activeTarget.extraAttributes.attackPercent" data-testid="extra-attack-percent" inputmode="decimal" placeholder="0" /></label>
                  <label><span>固定攻击</span><input v-model="activeTarget.extraAttributes.attack" data-testid="extra-attack" inputmode="decimal" placeholder="0" /></label>
                  <label><span>暴击 (%)</span><input v-model="activeTarget.extraAttributes.crit" data-testid="extra-crit" inputmode="decimal" placeholder="0" /></label>
                  <label><span>暴击伤害 (%)</span><input v-model="activeTarget.extraAttributes.critDamage" data-testid="extra-crit-damage" inputmode="decimal" placeholder="0" /></label>
                </div>
              </div>
              <div class="attribute-limit-head"><div><strong>属性限制</strong><span>{{ activeTarget.limits.length }} 项</span></div><button title="添加属性限制" @click="addLimit"><Plus :size="15" />添加</button></div>
              <div v-if="activeTarget.limits.length === 0" class="attribute-limit-empty">暂未设置属性区间</div>
              <div v-else class="attribute-limit-list">
                <div v-for="limit in activeTarget.limits" :key="limit.id" class="attribute-limit-row">
                  <select v-model="limit.stat"><option v-for="stat in LIMIT_STAT_OPTIONS" :key="stat">{{ stat }}</option></select>
                  <input v-model="limit.min" inputmode="decimal" placeholder="最低" />
                  <span>至</span>
                  <input v-model="limit.max" inputmode="decimal" placeholder="最高" />
                  <button title="删除属性限制" @click="removeLimit(limit.id)"><X :size="14" /></button>
                </div>
              </div>
              <div class="advanced-checks">
                <label><input v-model="activeTarget.excludeOccupied" type="checkbox" />排除其他已启用阵容占用的御魂</label>
                <fieldset><legend>御魂选择范围</legend><label><input v-model="activeTarget.scope" value="all" type="radio" />全部</label><label><input v-model="activeTarget.scope" value="unequipped" type="radio" />未装备</label></fieldset>
                <fieldset><legend>星级等级限制</legend><label><input v-model="activeTarget.sixStarOnly" type="checkbox" />仅六星</label><label><input v-model="activeTarget.maxLevelOnly" type="checkbox" />仅满级</label></fieldset>
              </div>
            </div>
          </section>
        </fieldset>
      </section>

      <button v-else class="manual-config-empty" @click="openShikigamiPicker(activeSlot)">
        <UserRoundPlus :size="30" />
        <strong>选择槽位 {{ activeSlot }} 的式神</strong>
        <span>选中式神后设置御魂套装、指标、主属性和高级限制</span>
      </button>

      <div v-if="shikigamiPickerOpen" class="selector-layer" @click.self="shikigamiPickerOpen = false">
        <section class="asset-selector shikigami-picker" role="dialog" aria-modal="true" aria-label="选择式神">
          <header><div><span>槽位 {{ activeSlot }}</span><h3>选择式神</h3></div><button title="关闭式神选择" @click="shikigamiPickerOpen = false"><X :size="18" /></button></header>
          <div class="selector-toolbar">
            <label class="selector-search"><Search :size="16" /><input v-model="shikigamiSearch" autofocus placeholder="搜索式神" /></label>
            <nav aria-label="式神稀有度">
              <button v-for="rarity in SHIKIGAMI_RARITY_OPTIONS" :key="rarity" :class="{ active: shikigamiRarity === rarity }" @click="shikigamiRarity = rarity">{{ rarity }}</button>
            </nav>
          </div>
          <div class="asset-grid shikigami-grid">
            <button v-for="item in visibleShikigami" :key="item.id" :class="{ selected: activeTarget?.shikigami?.id === item.id }" @click="selectShikigami(item)">
              <span class="asset-image"><img v-if="item.avatar" :src="item.avatar" :alt="item.name" /><span v-else class="avatar-fallback">{{ item.name.slice(0, 1) }}</span></span>
              <span class="asset-copy"><strong>{{ item.name }}</strong><small>{{ item.rarity }}</small></span>
              <Check v-if="activeTarget?.shikigami?.id === item.id" :size="15" />
            </button>
          </div>
          <div v-if="visibleShikigami.length === 0" class="selector-no-result">没有匹配的式神</div>
        </section>
      </div>

      <div v-if="yuhunPickerOpen" class="selector-layer" @click.self="yuhunPickerOpen = false">
        <section class="asset-selector yuhun-picker" role="dialog" aria-modal="true" aria-label="选择御魂套装">
          <header><div><span>{{ activeSuitIndex === null ? "添加御魂套装" : "修改御魂套装" }}</span><h3>选择御魂套装</h3></div><button title="关闭御魂选择" @click="yuhunPickerOpen = false"><X :size="18" /></button></header>
          <nav class="suit-count-tabs" aria-label="御魂套装件数">
            <span :title="canSelectSuitCount(4) ? '' : `当前已选择${activeTarget ? selectedSuitCapacity(activeTarget, activeSuitIndex) : 0}个御魂，无法再添加四件套`"><button :class="{ active: activeSuitCount === 4 }" :disabled="!canSelectSuitCount(4)" data-testid="suit-count-four" @click="selectSuitCount(4)">四件套</button></span>
            <span :title="canSelectSuitCount(2) ? '' : `当前已选择${activeTarget ? selectedSuitCapacity(activeTarget, activeSuitIndex) : 0}个御魂，无法再添加两件套`"><button :class="{ active: activeSuitCount === 2 }" :disabled="!canSelectSuitCount(2)" data-testid="suit-count-two" @click="selectSuitCount(2)">两件套</button></span>
          </nav>
          <div class="yuhun-selector-body">
            <nav class="yuhun-categories" aria-label="御魂分类">
              <button v-for="category in YUHUN_CATEGORY_OPTIONS" :key="category" :class="{ active: activeYuhunCategory === category }" @click="activeYuhunCategory = category">{{ category }}</button>
            </nav>
            <div class="yuhun-results">
              <label class="selector-search"><Search :size="16" /><input v-model="yuhunSearch" autofocus placeholder="输入搜索的御魂名字…" /></label>
              <div class="asset-grid yuhun-grid">
                <button v-for="item in visibleYuhun" :key="item.id" :class="{ selected: activeSuitIndex !== null && activeTarget?.suitRequirements[activeSuitIndex]?.name === item.name, unavailable: isUnavailableYuhun(item) }" :disabled="isUnavailableYuhun(item)" @click="selectYuhun(item.name)">
                  <span class="asset-image"><img v-if="yuhunImage(item.name)" :src="yuhunImage(item.name)!" :alt="item.name" /><span v-else class="suit-mark">{{ yuhunPlaceholder(item.name) }}</span></span>
                  <span class="asset-copy"><strong>{{ item.name }}</strong><small>{{ yuhunCategory(item.name) }}</small></span>
                  <Check v-if="activeSuitIndex !== null && activeTarget?.suitRequirements[activeSuitIndex]?.name === item.name" :size="15" />
                </button>
              </div>
              <div v-if="visibleYuhun.length === 0" class="selector-no-result">没有匹配的御魂套装</div>
            </div>
          </div>
        </section>
      </div>
    </fieldset>

  </section>
</template>

<style scoped>
.manual-target-editor { min-width: 0; }
.manual-editor-main { min-width: 0; min-height: 410px; margin: 12px 0 0; padding: 12px 14px; border: 0; }
.manual-target-editor.read-only .manual-editor-main { background: #fafafa; }
.manual-config { min-width: 0; }
.manual-config-title { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.selected-shikigami,.selected-shikigami-actions,.suit-trigger,.selector-search,.asset-grid button,.main-stat-heading { display: flex; align-items: center; }
.selected-shikigami { gap: 10px; }
.selected-shikigami > img,.selected-shikigami > .avatar-fallback { width: 44px; height: 44px; border-radius: 4px; object-fit: cover; }
.selected-shikigami div > span,.manual-config-panel > header span { color: var(--muted); font-size: 9px; }
.selected-shikigami h3,.manual-config-panel h4,.asset-selector h3 { margin: 2px 0 0; letter-spacing: 0; }
.selected-shikigami-actions { gap: 6px; }
.yuhun-config-toggle { min-height: 31px; display: inline-flex; align-items: center; gap: 6px; padding: 5px 8px; color: #e2e6e7; border: 1px solid #626a6d; border-radius: 3px; font-size: 9px; cursor: pointer; }.yuhun-config-toggle input { accent-color: var(--gold); }
.selected-shikigami-actions button,.attribute-limit-head button,.asset-selector > header button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.manual-config-columns { display: grid; grid-template-columns: minmax(0,1.45fr) minmax(280px,.75fr); margin: 0; padding: 0; border: 1px solid var(--line); }.manual-config-columns:disabled { opacity: .55; }
.manual-team-strip > button.calculation-disabled { opacity: .55; filter: grayscale(.8); }.manual-team-strip > button.calculation-disabled small { color: var(--red); }
.manual-config-panel { min-width: 0; padding: 16px; }
.manual-config-panel + .manual-config-panel { border-left: 1px solid var(--line); }
.manual-config-panel > header { margin-bottom: 12px; }
.manual-field-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.manual-field-grid label,.highest-stat-field { display: grid; gap: 5px; }
.manual-field-grid label > span,.field-label,.highest-stat-field > span { color: var(--muted); font-size: 10px; }
.manual-field-grid select,.manual-field-grid input,.highest-stat-field select,.attribute-limit-row select,.attribute-limit-row input { width: 100%; min-width: 0; }
.extra-attribute-fields { display: grid; gap: 7px; }.extra-attribute-fields > strong { font-size: 10px; }.extra-attribute-fields > div { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 7px; }.extra-attribute-fields label { display: grid; gap: 4px; }.extra-attribute-fields label span { color: var(--muted); font-size: 9px; }.extra-attribute-fields input { width: 100%; min-width: 0; }
.wide-field { grid-column: 1/-1; }
.suit-trigger-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(156px,1fr)); gap: 8px; margin-top: 5px; }
.suit-selection { position: relative; min-width: 0; }
.suit-trigger { position: relative; min-height: 58px; justify-content: flex-start; gap: 9px; padding: 7px 10px; text-align: left; }
.suit-selection .suit-trigger { width: 100%; padding-right: 31px; }
.suit-remove { position: absolute; top: 5px; right: 5px; display: inline-grid; width: 20px; height: 20px; padding: 0; place-items: center; color: var(--muted); border: 0; background: transparent; }
.suit-remove:hover { color: var(--danger); background: rgba(186,65,48,.08); }
.suit-add { min-height: 58px; display: grid; min-width: 0; place-items: center; color: var(--muted); border: 1px dashed var(--line); background: transparent; }
.suit-add:hover { color: var(--green); border-color: var(--green); background: transparent; }
.suit-trigger > img,.suit-trigger > .suit-mark { flex: 0 0 40px; width: 40px; height: 40px; }
.suit-trigger > span:nth-last-child(2) { display: grid; min-width: 0; gap: 2px; flex: 1; }
.suit-trigger small { color: var(--muted); font-size: 8px; }
.suit-trigger strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.main-stat-heading { justify-content: space-between; gap: 10px; margin-bottom: 7px; }
.main-stat-heading small { color: var(--muted); font-size: 9px; }
.main-stat-slots { display: grid; gap: 7px; }
.main-stat-slot { display: grid; grid-template-columns: 48px minmax(0,1fr); gap: 8px; align-items: start; }
.main-stat-slot > strong { padding-top: 7px; font-size: 10px; }
.main-stat-slot > div { display: flex; flex-wrap: wrap; gap: 5px; }
.main-stat-slot button { min-height: 28px; padding: 4px 8px; font-size: 9px; }
.main-stat-slot button.selected { color: #fff; background: var(--green); border-color: var(--green); }
.advanced-config-body { display: grid; gap: 13px; }
.attribute-limit-head { display: flex; justify-content: space-between; align-items: center; }
.attribute-limit-head > div { display: grid; gap: 2px; }
.attribute-limit-head span,.attribute-limit-empty { color: var(--muted); font-size: 9px; }
.attribute-limit-empty { padding: 16px 8px; text-align: center; border: 1px dashed var(--line); }
.attribute-limit-list { display: grid; gap: 6px; }
.attribute-limit-row { display: grid; grid-template-columns: minmax(72px,1fr) minmax(48px,.65fr) auto minmax(48px,.65fr) 28px; gap: 4px; align-items: center; }
.attribute-limit-row > span { color: var(--muted); font-size: 9px; }
.advanced-checks { display: grid; gap: 10px; font-size: 10px; }
.advanced-checks label { display: inline-flex; align-items: center; gap: 6px; }
.advanced-checks fieldset { display: flex; flex-wrap: wrap; gap: 12px; margin: 0; padding: 8px 10px; border: 1px solid var(--line); }
.advanced-checks legend { padding: 0 4px; color: var(--muted); font-size: 9px; }
.manual-config-empty { width: 100%; min-height: 390px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--muted); background: transparent; border: 1px dashed var(--line); }
.manual-config-empty strong { color: var(--ink); }
.manual-config-empty span { font-size: 10px; }
.manual-team-strip { display: grid; grid-template-columns: repeat(6,minmax(0,1fr)); border: 1px solid var(--line); }
.manual-team-strip > button { position: relative; min-width: 0; min-height: 76px; display: grid; justify-items: center; align-content: center; gap: 3px; padding: 7px; border: 0; border-right: 1px solid var(--line); border-radius: 0; }
.manual-team-strip > button:last-child { border-right: 0; }
.manual-team-strip > button.active { box-shadow: inset 0 -3px var(--green); }
.manual-team-strip img,.manual-team-strip .avatar-fallback,.manual-slot-plus { width: 30px; height: 30px; border-radius: 3px; object-fit: cover; }
.manual-team-strip strong,.manual-team-strip small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.manual-team-strip strong { font-size: 9px; }.manual-team-strip small { color: var(--muted); font-size: 8px; }
.manual-slot-number { position: absolute; top: 4px; left: 6px; color: var(--muted); font-size: 8px; }
.manual-slot-plus { display: grid; place-items: center; }
.avatar-fallback,.suit-mark { display: grid; place-items: center; color: #fff; background: #596a65; font-weight: 700; }
.suit-mark { border-radius: 4px; background: #7a5c38; }
.selector-layer { position: fixed; z-index: 80; inset: 0; display: grid; place-items: center; padding: 18px; background: rgba(26,31,29,.58); }
.asset-selector { width: min(900px,calc(100vw - 36px)); max-height: min(720px,calc(100vh - 36px)); display: flex; flex-direction: column; overflow: hidden; background: var(--paper); border: 1px solid var(--line); box-shadow: 0 18px 50px rgba(0,0,0,.26); }
.asset-selector > header { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; padding: 13px 16px; border-bottom: 1px solid var(--line); }
.asset-selector > header span { color: var(--muted); font-size: 9px; }
.asset-selector > header button { width: 34px; height: 34px; padding: 0; }
.suit-count-tabs { display: flex; gap: 4px; flex: 0 0 auto; padding: 10px 16px 0; }
.suit-count-tabs > span { display: inline-flex; }
.suit-count-tabs button { min-width: 76px; min-height: 30px; padding: 5px 10px; font-size: 10px; }
.suit-count-tabs button.active { color: #fff; background: var(--green); border-color: var(--green); }
.suit-count-tabs button:disabled { color: var(--muted); cursor: not-allowed; opacity: .55; }
.selector-toolbar { flex: 0 0 auto; padding: 12px 16px 0; }
.selector-search { min-height: 38px; gap: 8px; padding: 0 11px; background: #fff; border: 1px solid var(--line); }
.selector-search input { min-width: 0; flex: 1; padding: 0; background: transparent; border: 0; outline: none; }
.selector-toolbar nav { display: flex; gap: 4px; margin-top: 10px; border-bottom: 1px solid var(--line); }
.selector-toolbar nav button { min-width: 58px; flex: 0 0 auto; padding: 8px 10px; white-space: nowrap; border: 0; border-bottom: 2px solid transparent; border-radius: 0; }
.selector-toolbar nav button.active { color: var(--green); border-bottom-color: var(--green); }
.asset-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 7px; overflow-y: auto; padding: 14px 16px 18px; }
.asset-grid button { position: relative; min-width: 0; min-height: 72px; justify-content: flex-start; gap: 10px; padding: 7px; text-align: left; }
.asset-grid button.selected { border-color: var(--green); box-shadow: inset 0 0 0 1px var(--green); }
.asset-grid button.unavailable { opacity: .42; }
.asset-image,.asset-image img,.asset-image .avatar-fallback,.asset-image .suit-mark { flex: 0 0 54px; width: 54px; height: 54px; }
.asset-image { display: block; }.asset-image img { object-fit: contain; }
.asset-copy { display: grid; min-width: 0; gap: 4px; }
.asset-copy strong,.asset-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.asset-copy strong { font-size: 11px; }.asset-copy small { color: var(--muted); font-size: 8px; }
.asset-grid button > svg { position: absolute; top: 6px; right: 6px; color: var(--green); }
.selector-no-result { padding: 42px 16px; color: var(--muted); text-align: center; font-size: 10px; }
.yuhun-selector-body { min-height: 0; display: grid; grid-template-columns: 150px minmax(0,1fr); flex: 1; }
.yuhun-categories { overflow-y: auto; padding: 8px; border-right: 1px solid var(--line); }
.yuhun-categories button { width: 100%; min-height: 34px; padding: 7px 10px; text-align: left; border: 0; border-radius: 0; }
.yuhun-categories button.active { color: #fff; background: var(--green); }
.yuhun-results { position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding-top: 12px; }
.yuhun-results > .selector-search { margin: 0 16px; }
.yuhun-grid { grid-template-columns: repeat(3,minmax(0,1fr)); padding-top: 10px; }

@media (max-width: 800px) {
  .manual-config-columns { grid-template-columns: 1fr; }
  .manual-config-panel + .manual-config-panel { border-left: 0; border-top: 1px solid var(--line); }
  .asset-grid { grid-template-columns: repeat(3,minmax(0,1fr)); }
  .yuhun-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
}

@media (max-width: 560px) {
  .manual-config-title { align-items: flex-start; }
  .selected-shikigami-actions button:first-child { width: 34px; height: 34px; padding: 0; font-size: 0; }
  .manual-field-grid,.suit-trigger-grid { grid-template-columns: 1fr; }
  .manual-team-strip { grid-template-columns: repeat(3,1fr); }
  .manual-team-strip > button:nth-child(3) { border-right: 0; }
  .manual-team-strip > button:nth-child(-n+3) { border-bottom: 1px solid var(--line); }
  .selector-layer { padding: 0; }
  .asset-selector { width: 100vw; max-height: 100dvh; height: 100dvh; border: 0; }
  .selector-toolbar nav { overflow-x: auto; }
  .asset-grid { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .yuhun-selector-body { grid-template-columns: 104px minmax(0,1fr); }
  .yuhun-categories { padding: 6px; }
  .yuhun-categories button { padding: 7px 6px; font-size: 9px; }
  .yuhun-grid { grid-template-columns: 1fr; }
  .asset-grid button { min-height: 64px; }
  .asset-image,.asset-image img,.asset-image .avatar-fallback,.asset-image .suit-mark { flex-basis: 46px; width: 46px; height: 46px; }
  .main-stat-heading { align-items: flex-start; flex-direction: column; }
  .main-stat-slot { grid-template-columns: 42px minmax(0,1fr); }
}
</style>
