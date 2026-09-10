import type { IntrinsicStatId, LevelRange, StatId, SubStatCount } from "./types.js";

export const YUHUN_POSITIONS = [1, 2, 3, 4, 5, 6] as const;
export type YuhunPosition = (typeof YUHUN_POSITIONS)[number];

export const YUHUN_TYPES = [
  "雪幽魂",
  "地藏像",
  "蝠翼",
  "涅槃火",
  "三味",
  "魍魉之匣",
  "被服",
  "招财猫",
  "反枕",
  "轮入道",
  "日女巳时",
  "镜姬",
  "钟灵",
  "狰",
  "火灵",
  "鸣屋",
  "心眼",
  "树妖",
  "网切",
  "阴摩罗",
  "伤魂鸟",
  "破势",
  "镇墓兽",
  "珍珠",
  "骰子鬼",
  "蚌精",
  "魅妖",
  "针女",
  "木魅",
  "薙魂",
  "返魂香",
  "狂骨",
  "幽谷响",
  "土蜘蛛",
  "胧车",
  "荒骷髅",
  "地震鲶",
  "蜃气楼",
  "飞缘魔",
  "兵主部",
  "青女房",
  "涂佛",
  "鬼灵歌伎",
  "遗念火",
  "共潜",
  "恶楼",
  "贝吹坊",
  "海月火玉",
  "出世螺",
  "火之车",
  "隐念",
  "叠叩",
  "应声虫",
  "元兴寺",
  "钓瓶火",
  "夜荒魂",
  "无刀取",
  "奉海图",
  "八咫镜",
  "天羽羽斩",
  "预言星盘",
  "月之石",
  "纺缘锤",
  "稻荷穗箭",
  "片叶之苇",
  "尘冢",
  "油赤子",
  "夜啼石",
  "夜送犬",
  "雨降"
] as const;

export type YuhunType = (typeof YUHUN_TYPES)[number];

/** Canonicalize legacy names emitted by older snapshot/catalog versions. */
export function canonicalYuhunName(name: string): string {
  return name === "涅槃之火" ? "涅槃火" : name;
}

export const YUHUN_SUIT_IDS_BY_NAME = {
  雪幽魂: 300002,
  地藏像: 300003,
  蝠翼: 300004,
  涅槃火: 300006,
  三味: 300007,
  魍魉之匣: 300008,
  被服: 300009,
  招财猫: 300010,
  反枕: 300011,
  轮入道: 300012,
  日女巳时: 300013,
  镜姬: 300014,
  钟灵: 300015,
  狰: 300018,
  火灵: 300019,
  鸣屋: 300020,
  心眼: 300022,
  树妖: 300024,
  网切: 300026,
  阴摩罗: 300027,
  伤魂鸟: 300029,
  破势: 300030,
  镇墓兽: 300031,
  珍珠: 300032,
  骰子鬼: 300033,
  蚌精: 300034,
  魅妖: 300035,
  针女: 300036,
  木魅: 300023,
  薙魂: 300021,
  返魂香: 300039,
  狂骨: 300048,
  幽谷响: 300049,
  土蜘蛛: 300050,
  胧车: 300051,
  荒骷髅: 300052,
  地震鲶: 300053,
  蜃气楼: 300054,
  飞缘魔: 300073,
  兵主部: 300074,
  青女房: 300075,
  涂佛: 300076,
  鬼灵歌伎: 300077,
  遗念火: 300079,
  共潜: 300080,
  恶楼: 300081,
  贝吹坊: 300082,
  海月火玉: 300083,
  出世螺: 300084,
  火之车: 300085,
  隐念: 300086,
  叠叩: 300087,
  应声虫: 300088,
  元兴寺: 300089,
  钓瓶火: 300090,
  夜荒魂: 300091,
  无刀取: 300092,
  奉海图: 300093,
  八咫镜: 300094,
  天羽羽斩: 300095,
  预言星盘: 300096,
  月之石: 300097,
  纺缘锤: 300098,
  稻荷穗箭: 300099,
  片叶之苇: 300055,
  尘冢: 300056,
  油赤子: 300057,
  夜啼石: 300058,
  夜送犬: 300059,
  雨降: 300060
} as const satisfies Readonly<Record<YuhunType, number>>;

export type YuhunSuitId = (typeof YUHUN_SUIT_IDS_BY_NAME)[YuhunType];

/**
 * Team codes represent a broad two-piece effect with a config[3] enum. Keep
 * the enum and its candidate suits shared by the decoder bridge, manual
 * picker, and panel calculation.
 */
export const TWO_PIECE_EFFECTS = [
  {
    id: "two-piece-effect:attackPercent",
    name: "攻击加成",
    teamCodeId: 0,
    stat: "attackPercent",
    suitNames: ["隐念", "贝吹坊", "兵主部", "狂骨", "阴摩罗", "心眼", "鸣屋", "狰", "轮入道", "蝠翼", "尘冢"]
  },
  {
    id: "two-piece-effect:crit",
    name: "暴击",
    teamCodeId: 1,
    stat: "crit",
    suitNames: ["应声虫", "海月火玉", "青女房", "针女", "镇墓兽", "破势", "伤魂鸟", "网切", "三味", "片叶之苇"]
  },
  {
    id: "two-piece-effect:critDamage",
    name: "暴击伤害",
    teamCodeId: 2,
    stat: "critDamage",
    suitNames: ["无刀取"]
  },
  {
    id: "two-piece-effect:hpPercent",
    name: "生命加成",
    teamCodeId: 6,
    stat: "hpPercent",
    suitNames: ["叠叩", "恶楼", "涂佛", "树妖", "薙魂", "钟灵", "镜姬", "被服", "涅槃火", "地藏像", "夜啼石"]
  },
  {
    id: "two-piece-effect:defensePercent",
    name: "防御加成",
    teamCodeId: 7,
    stat: "defensePercent",
    suitNames: ["火之车", "出世螺", "魅妖", "珍珠", "木魅", "日女巳时", "反枕", "招财猫", "雪幽魂", "奉海图", "雨降"]
  },
  {
    id: "two-piece-effect:effectHit",
    name: "效果命中",
    teamCodeId: 4,
    stat: "effectHit",
    suitNames: ["元兴寺", "遗念火", "飞缘魔", "蚌精", "火灵", "油赤子"]
  },
  {
    id: "two-piece-effect:effectResist",
    name: "效果抵抗",
    teamCodeId: 5,
    stat: "effectResist",
    suitNames: ["钓瓶火", "共潜", "幽谷响", "返魂香", "骰子鬼", "魍魉之匣", "夜送犬"]
  }
] as const satisfies readonly {
  readonly id: string;
  readonly name: string;
  readonly teamCodeId: number;
  readonly stat: StatId;
  readonly suitNames: readonly YuhunType[];
}[];

export type TwoPieceEffect = (typeof TWO_PIECE_EFFECTS)[number];

export function findTwoPieceEffectByName(name: string): TwoPieceEffect | undefined {
  return TWO_PIECE_EFFECTS.find((effect) => effect.name === name);
}

export function findTwoPieceEffectByTeamCodeId(id: number): TwoPieceEffect | undefined {
  return TWO_PIECE_EFFECTS.find((effect) => effect.teamCodeId === id);
}

/** Match only a complete group so ordinary set alternatives are not mislabeled as effects. */
export function findTwoPieceEffectBySuitNames(
  suitNames: readonly string[]
): TwoPieceEffect | undefined {
  const selected = new Set(suitNames);
  if (selected.size !== suitNames.length) return undefined;
  return TWO_PIECE_EFFECTS.find((effect) => (
    selected.size === effect.suitNames.length
    && effect.suitNames.every((name) => selected.has(name))
  ));
}

export const SPEED_MAIN_STAT_POSITIONS: readonly YuhunPosition[] = [2];
export const SIX_STAR_SPEED_MAIN_STAT_MAX = 57;

export const MAIN_STATS: ReadonlyArray<readonly [bit: number, stat: StatId]> = [
  [12, "attack"],
  [13, "attackPercent"],
  [14, "defense"],
  [15, "defensePercent"],
  [16, "hp"],
  [17, "hpPercent"],
  [18, "speed"],
  [19, "effectHit"],
  [20, "effectResist"],
  [21, "crit"],
  [22, "critDamage"]
];

export const SUB_STATS: ReadonlyArray<
  readonly [includeBit: number, excludeBit: number, stat: StatId]
> = [
  [23, 24, "attack"],
  [25, 26, "attackPercent"],
  [27, 28, "defense"],
  [29, 30, "defensePercent"],
  [31, 32, "hp"],
  [33, 34, "hpPercent"],
  [35, 36, "speed"],
  [37, 38, "effectHit"],
  [39, 40, "effectResist"],
  [41, 42, "crit"],
  [43, 44, "critDamage"]
];

export const SUB_STAT_COUNTS: ReadonlyArray<readonly [bit: number, count: SubStatCount]> = [
  [45, "lessThan2"],
  [46, "2"],
  [47, "3"],
  [48, "4"]
];

export const LEVEL_RANGES: ReadonlyArray<readonly [bit: number, range: LevelRange]> = [
  [49, "0-2"],
  [50, "3-5"],
  [51, "6-8"],
  [52, "9-11"],
  [53, "12-14"],
  [54, "15"]
];

export const INTRINSIC_STATS: ReadonlyArray<
  readonly [bit: number, stat: IntrinsicStatId]
> = [
  [55, "attackPercent"],
  [56, "defensePercent"],
  [57, "hpPercent"],
  [58, "effectHit"],
  [59, "effectResist"],
  [60, "crit"]
];

export const STAT_LABELS: Readonly<Record<StatId, string>> = {
  attack: "攻击",
  attackPercent: "攻击加成",
  defense: "防御",
  defensePercent: "防御加成",
  hp: "生命",
  hpPercent: "生命加成",
  speed: "速度",
  effectHit: "命中",
  effectResist: "抵抗",
  crit: "暴击",
  critDamage: "暴击伤害"
};

export const SUB_STAT_MAX_ROLLS: Readonly<Record<StatId, number>> = {
  attack: 27,
  attackPercent: 0.03,
  defense: 5,
  defensePercent: 0.03,
  hp: 114,
  hpPercent: 0.03,
  speed: 3,
  effectHit: 0.04,
  effectResist: 0.04,
  crit: 0.03,
  critDamage: 0.04
};
