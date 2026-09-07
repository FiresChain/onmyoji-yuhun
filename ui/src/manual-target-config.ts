import { canonicalYuhunName } from "../../src/browser.js";

const ASSET_BASE_URL = (import.meta.env.VITE_ASSET_BASE_URL ?? "https://onmyoji-assets.fireschain.org").replace(/\/$/, "");
const CATALOG_URL = `${ASSET_BASE_URL}/assets/catalog.json`;

interface RawLocalizedNames {
  readonly zh?: string;
  readonly en?: string;
  readonly ja?: string;
}

interface RawShikigamiOption {
  readonly id?: string | number;
  readonly avatar?: string;
  readonly names?: RawLocalizedNames;
  readonly rarity?: string;
}

interface RawYuhunOption {
  readonly id?: string | number;
  readonly avatar?: string;
  readonly names?: RawLocalizedNames;
  readonly type?: string;
}

interface AssetCatalog {
  readonly schemaVersion: 1;
  readonly libraries: {
    readonly shikigami: readonly RawShikigamiOption[];
    readonly yuhun: readonly RawYuhunOption[];
  };
}

function assetUrl(value: unknown, fallback = ""): string {
  const path = String(value ?? fallback).trim();
  return path.startsWith("/assets/") ? `${ASSET_BASE_URL}${path}` : path;
}

export const MAIN_STAT_OPTIONS = {
  2: ["攻击加成", "生命加成", "防御加成", "速度"],
  4: ["攻击加成", "生命加成", "防御加成", "效果命中", "效果抵抗"],
  6: ["攻击加成", "生命加成", "防御加成", "暴击", "暴击伤害"]
} as const;

export type MainStatSlot = keyof typeof MAIN_STAT_OPTIONS;
export type MainStat = (typeof MAIN_STAT_OPTIONS)[MainStatSlot][number];

export interface MainStatPreset {
  readonly 2: readonly MainStat[];
  readonly 4: readonly MainStat[];
  readonly 6: readonly MainStat[];
}

export const METRIC_PRESETS = {
  "伤害输出": { 2: ["攻击加成"], 4: ["攻击加成"], 6: ["暴击", "暴击伤害"] },
  "效果命中": { 2: ["速度"], 4: ["效果命中"], 6: [] },
  "效果抵抗": { 2: ["速度"], 4: ["效果抵抗"], 6: [] },
  "生命": { 2: ["生命加成"], 4: ["生命加成"], 6: ["生命加成"] },
  "攻击": { 2: ["攻击加成"], 4: ["攻击加成"], 6: ["攻击加成"] },
  "防御": { 2: ["防御加成"], 4: ["防御加成"], 6: ["防御加成"] },
  "速度": { 2: ["速度"], 4: [], 6: [] },
  "暴击": { 2: [], 4: [], 6: ["暴击"] },
  "暴击伤害": { 2: [], 4: [], 6: ["暴击伤害"] },
  "治疗量": { 2: ["速度"], 4: ["生命加成"], 6: ["暴击", "暴击伤害"] },
  "命抗双修": { 2: ["速度"], 4: ["效果命中", "效果抵抗"], 6: ["生命加成"] },
  "防御输出": { 2: ["防御加成"], 4: ["防御加成"], 6: ["暴击", "暴击伤害"] }
} as const satisfies Record<string, MainStatPreset>;

export type MetricOption = keyof typeof METRIC_PRESETS;

export function metricPreset(metric: MetricOption): MainStatPreset {
  const preset = METRIC_PRESETS[metric];
  return {
    2: [...preset[2]],
    4: [...preset[4]],
    6: [...preset[6]]
  };
}

export const YUHUN_CATEGORY_OPTIONS = [
  "全部",
  "攻击加成",
  "暴击",
  "暴击伤害",
  "防御加成",
  "生命加成",
  "效果命中",
  "效果抵抗",
  "首领御魂",
  "其他"
] as const;

export type YuhunCategory = (typeof YUHUN_CATEGORY_OPTIONS)[number];

const YUHUN_CATEGORY_BY_TYPE: Readonly<Record<string, YuhunCategory>> = {
  attack: "攻击加成",
  Crit: "暴击",
  CritDamage: "暴击伤害",
  Defense: "防御加成",
  Health: "生命加成",
  ControlHit: "效果命中",
  ControlMiss: "效果抵抗",
  PVE: "首领御魂"
};

export interface YuhunOption {
  readonly id: string;
  readonly name: string;
  readonly category: YuhunCategory;
  readonly avatar: string;
  /** A text-only option representing every two-piece suit with one shared bonus. */
  readonly twoPieceEffect?: true;
}

const YUHUN_CATEGORY_BY_TWO_PIECE_STAT: Readonly<Record<string, YuhunCategory>> = {
  attackPercent: "攻击加成",
  crit: "暴击",
  critDamage: "暴击伤害",
  hpPercent: "生命加成",
  defensePercent: "防御加成",
  effectHit: "效果命中",
  effectResist: "效果抵抗"
};

const TWO_PIECE_EFFECTS = [
  ["two-piece-effect:attackPercent", "攻击加成", "attackPercent"],
  ["two-piece-effect:crit", "暴击", "crit"],
  ["two-piece-effect:critDamage", "暴击伤害", "critDamage"],
  ["two-piece-effect:hpPercent", "生命加成", "hpPercent"],
  ["two-piece-effect:defensePercent", "防御加成", "defensePercent"],
  ["two-piece-effect:effectHit", "效果命中", "effectHit"],
  ["two-piece-effect:effectResist", "效果抵抗", "effectResist"]
] as const;

const TWO_PIECE_EFFECT_OPTIONS: readonly YuhunOption[] = TWO_PIECE_EFFECTS.map(([id, name, stat]) => ({
  id,
  name,
  category: YUHUN_CATEGORY_BY_TWO_PIECE_STAT[stat]!,
  avatar: "",
  twoPieceEffect: true
}));

export const YUHUN_OPTIONS: YuhunOption[] = [];

const YUHUN_BY_NAME = new Map<string, YuhunOption>();

function yuhunOptionForName(name: string): YuhunOption | undefined {
  return YUHUN_BY_NAME.get(name) ?? YUHUN_BY_NAME.get(canonicalYuhunName(name));
}

for (const item of YUHUN_OPTIONS) {
  if (!YUHUN_BY_NAME.has(item.name)) YUHUN_BY_NAME.set(item.name, item);
}

export function yuhunCategory(name: string): YuhunCategory {
  return yuhunOptionForName(name)?.category ?? "其他";
}

export function yuhunImage(name: string): string | null {
  return yuhunOptionForName(name)?.avatar || null;
}

export function yuhunDisplayName(name: string): string {
  return yuhunOptionForName(name)?.name ?? canonicalYuhunName(name);
}

export function isTwoPieceEffectOption(name: string): boolean {
  return yuhunOptionForName(name)?.twoPieceEffect === true;
}

export function yuhunPlaceholder(name: string): string {
  return isTwoPieceEffectOption(name) ? "2件" : name.slice(0, 1);
}
function localizedName(names: RawLocalizedNames | undefined, fallback: string): string {
  return names?.zh?.trim() || names?.en?.trim() || names?.ja?.trim() || fallback;
}

export interface ShikigamiOption {
  readonly id: string;
  readonly heroId: number;
  readonly name: string;
  readonly rarity: string;
  readonly avatar: string;
}

export const SHIKIGAMI_OPTIONS: ShikigamiOption[] = [];

const SHIKIGAMI_BY_HERO_ID = new Map<number, ShikigamiOption>();

let catalogLoad: Promise<void> | null = null;

function rebuildCatalog(catalog: AssetCatalog): void {
  SHIKIGAMI_OPTIONS.splice(0, SHIKIGAMI_OPTIONS.length, ...catalog.libraries.shikigami.map((item, index) => {
    const id = String(item.id ?? index);
    return {
      id: `${id}-${index}`,
      heroId: Number.parseInt(id, 10),
      name: localizedName(item.names, id),
      rarity: String(item.rarity ?? "").toUpperCase(),
      avatar: assetUrl(item.avatar, "/assets/Shikigami/default.png")
    };
  }).filter((item) => Number.isSafeInteger(item.heroId)));
  SHIKIGAMI_BY_HERO_ID.clear();
  for (const item of SHIKIGAMI_OPTIONS) SHIKIGAMI_BY_HERO_ID.set(item.heroId, item);

  YUHUN_OPTIONS.splice(0, YUHUN_OPTIONS.length, ...TWO_PIECE_EFFECT_OPTIONS, ...catalog.libraries.yuhun.map((item, index) => {
    const id = String(item.id ?? index);
    return {
      id,
      name: localizedName(item.names, id),
      category: YUHUN_CATEGORY_BY_TYPE[String(item.type ?? "")] ?? "其他",
      avatar: assetUrl(item.avatar)
    };
  }));
  YUHUN_BY_NAME.clear();
  for (const item of YUHUN_OPTIONS) {
    if (!YUHUN_BY_NAME.has(item.name)) YUHUN_BY_NAME.set(item.name, item);
  }
}

export function loadManualTargetCatalog(): Promise<void> {
  if (catalogLoad !== null) return catalogLoad;
  catalogLoad = fetch(CATALOG_URL)
    .then(async (response) => {
      if (!response.ok) throw new Error(`资产目录加载失败（${response.status}）`);
      return response.json() as Promise<AssetCatalog>;
    })
    .then((catalog) => {
      if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog?.libraries?.shikigami) || !Array.isArray(catalog?.libraries?.yuhun)) {
        throw new Error("资产目录格式不受支持");
      }
      rebuildCatalog(catalog);
    })
    .catch((error) => {
      catalogLoad = null;
      throw error;
    });
  return catalogLoad;
}

export function shikigamiByHeroId(heroId: number): ShikigamiOption | null {
  return SHIKIGAMI_BY_HERO_ID.get(heroId) ?? null;
}

export function shikigamiImage(heroId: number): string | null {
  return shikigamiByHeroId(heroId)?.avatar || null;
}

export const SHIKIGAMI_RARITY_OPTIONS = ["全部", "UR", "SP", "SSR", "SR", "R", "N", "L", "G"] as const;
