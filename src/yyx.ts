import { calculatePanel, parseCbgYuhun, type CbgYuhunItem, type Panel, type Yuhun } from "./calculation.js";
import { canonicalYuhunName, YUHUN_SUIT_IDS_BY_NAME } from "./mappings.js";
import type { IntrinsicStatId, StatId } from "./types.js";

export interface YyxYuhun extends Yuhun {
  lock: boolean;
  garbage: boolean;
  born: number;
  suitId: number;
  equipped?: boolean;
  /** Known before the first +3 event; null once the initial state can no longer be recovered. */
  initialSubStats: Partial<Record<StatId, number>> | null;
}

export interface SnapshotHeroBase {
  readonly id: number;
  readonly name: string;
  readonly panel: Panel;
}

export interface ParsedGameSnapshot {
  readonly format: "yyx" | "onmyoji-hub";
  readonly items: readonly YyxYuhun[];
  readonly heroBases: ReadonlyMap<number, SnapshotHeroBase>;
}

type UnknownRecord = Record<string, unknown>;

const YYX_STAT_IDS: Readonly<Record<string, StatId>> = {
  Hp: "hp",
  Attack: "attack",
  Defense: "defense",
  Speed: "speed",
  CritRate: "crit",
  CritPower: "critDamage",
  HpRate: "hpPercent",
  AttackRate: "attackPercent",
  DefenseRate: "defensePercent",
  EffectHitRate: "effectHit",
  EffectResistRate: "effectResist"
};

const INTRINSIC_STAT_IDS = new Set<StatId>([
  "attackPercent",
  "defensePercent",
  "hpPercent",
  "effectHit",
  "effectResist",
  "crit"
] satisfies IntrinsicStatId[]);

const SUIT_NAMES_BY_ID = new Map<number, string>();
for (const [name, suitId] of Object.entries(YUHUN_SUIT_IDS_BY_NAME)) {
  if (SUIT_NAMES_BY_ID.has(suitId)) {
    throw new Error("Yuhun suit mapping contains duplicate suit IDs");
  }
  SUIT_NAMES_BY_ID.set(suitId, name);
}

function optionalInteger(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}

function optionalBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parseDisplayNumber(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return invalid(path, "expected a numeric display value");
  const trimmed = value.trim();
  const parsed = Number.parseFloat(trimmed.endsWith("%") ? trimmed.slice(0, -1) : trimmed);
  if (!Number.isFinite(parsed)) return invalid(path, "expected a numeric display value");
  return trimmed.endsWith("%") ? parsed / 100 : parsed;
}

function removeUnreportedEquippedStats(display: Panel, equipped: readonly Yuhun[]): Panel {
  if (equipped.length === 0) return display;
  const zero: Panel = {
    attack: 0, hp: 0, defense: 0, speed: 0,
    crit: 0, critDamage: 0, effectHit: 0, effectResist: 0
  };
  const additive = calculatePanel(zero, equipped);
  return {
    attack: display.attack,
    hp: display.hp,
    defense: display.defense,
    speed: display.speed,
    crit: display.crit,
    critDamage: display.critDamage - additive.critDamage,
    effectHit: display.effectHit - additive.effectHit,
    effectResist: display.effectResist - additive.effectResist
  };
}

function parseHubHeroBases(
  payload: UnknownRecord,
  itemsById: ReadonlyMap<string, YyxYuhun>
): ReadonlyMap<number, SnapshotHeroBase> {
  const rawHeroes = payload.heroes;
  if (typeof rawHeroes !== "object" || rawHeroes === null || Array.isArray(rawHeroes)) return new Map();
  const selected = new Map<number, { rank: number; value: SnapshotHeroBase }>();
  for (const [key, value] of Object.entries(rawHeroes as UnknownRecord)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const hero = value as UnknownRecord;
    const id = optionalInteger(hero.heroId, -1);
    if (id < 0 || typeof hero.name !== "string") continue;
    const attrs = requireRecord(hero.attrs, `equip_desc.heroes.${key}.attrs`);
    const statValue = (label: string): number => {
      const stat = requireRecord(attrs[label], `equip_desc.heroes.${key}.attrs.${label}`);
      return parseDisplayNumber(stat.val, `equip_desc.heroes.${key}.attrs.${label}.val`);
    };
    const displayPanel: Panel = {
      attack: statValue("攻击"),
      hp: statValue("生命"),
      defense: statValue("防御"),
      speed: statValue("速度"),
      crit: statValue("暴击"),
      critDamage: statValue("暴击伤害"),
      effectHit: statValue("效果命中"),
      effectResist: statValue("效果抵抗")
    };
    const equipped = Array.isArray(hero.equips)
      ? hero.equips
        .filter((equipId): equipId is string => typeof equipId === "string")
        .map((equipId) => itemsById.get(equipId))
        .filter((item): item is YyxYuhun => item !== undefined)
      : [];
    const candidate: SnapshotHeroBase = {
      id,
      name: hero.name,
      panel: removeUnreportedEquippedStats(displayPanel, equipped)
    };
    const rank = optionalInteger(hero.level) * 100 + optionalInteger(hero.star) * 10 + optionalInteger(hero.awake);
    if ((selected.get(id)?.rank ?? -1) < rank) selected.set(id, { rank, value: candidate });
  }
  return new Map([...selected].map(([id, entry]) => [id, entry.value]));
}

function parseYyxHeroBases(data: UnknownRecord): ReadonlyMap<number, SnapshotHeroBase> {
  if (!Array.isArray(data.heroes)) return new Map();
  const selected = new Map<number, { rank: number; value: SnapshotHeroBase }>();
  for (const [index, rawHero] of data.heroes.entries()) {
    if (typeof rawHero !== "object" || rawHero === null || Array.isArray(rawHero)) continue;
    const hero = rawHero as UnknownRecord;
    const id = optionalInteger(hero.hero_id, -1);
    if (id < 0) continue;
    const attrs = requireRecord(hero.attrs, `data.heroes[${index}].attrs`);
    const compoundBase = (key: string): number => {
      const stat = requireRecord(attrs[key], `data.heroes[${index}].attrs.${key}`);
      return requireFiniteNumber(stat.base, `data.heroes[${index}].attrs.${key}.base`);
    };
    const candidate: SnapshotHeroBase = {
      id,
      name: String(id),
      panel: {
        attack: compoundBase("attack"),
        hp: compoundBase("max_hp"),
        defense: compoundBase("defense"),
        speed: compoundBase("speed"),
        crit: compoundBase("crit_rate"),
        critDamage: 1 + compoundBase("crit_power"),
        effectHit: typeof attrs.effect_hit_rate === "number" ? attrs.effect_hit_rate : 0,
        effectResist: typeof attrs.effect_resist_rate === "number" ? attrs.effect_resist_rate : 0
      }
    };
    const rank = optionalInteger(hero.level) * 100 + optionalInteger(hero.star) * 10 + optionalInteger(hero.awake);
    if ((selected.get(id)?.rank ?? -1) < rank) selected.set(id, { rank, value: candidate });
  }
  return new Map([...selected].map(([id, entry]) => [id, entry.value]));
}

function parseOnmyojiHubSnapshot(root: UnknownRecord): ParsedGameSnapshot {
  let payloadValue: unknown = root.equip_desc;
  if (typeof payloadValue === "string") {
    try {
      payloadValue = JSON.parse(payloadValue) as unknown;
    } catch {
      return invalid("equip_desc", "expected valid JSON text");
    }
  }
  const payload = requireRecord(payloadValue, "equip_desc");
  const inventory = requireRecord(payload.inventory, "equip_desc.inventory");
  const parsedItems = Object.entries(inventory).map(([inventoryId, rawValue], index): YyxYuhun => {
    const raw = requireRecord(rawValue, `equip_desc.inventory.${inventoryId}`) as unknown as CbgYuhunItem;
    const parsed = parseCbgYuhun(raw);
    const parsedName = canonicalYuhunName(parsed.name);
    const suitId = optionalInteger((raw as unknown as UnknownRecord).suitid, YUHUN_SUIT_IDS_BY_NAME[parsedName as keyof typeof YUHUN_SUIT_IDS_BY_NAME]);
    const normalizedName = canonicalYuhunName(SUIT_NAMES_BY_ID.get(suitId) ?? parsedName);
    return {
      ...parsed,
      id: parsed.id || `inventory-${index + 1}`,
      name: normalizedName,
      lock: optionalBoolean((raw as unknown as UnknownRecord).lock),
      garbage: optionalBoolean((raw as unknown as UnknownRecord).isuseless),
      born: optionalInteger((raw as unknown as UnknownRecord).born),
      suitId,
      equipped: typeof (raw as unknown as UnknownRecord).herouid === "string",
      initialSubStats: parsed.level <= 2 ? { ...parsed.subStats } : null
    };
  });
  const equippedIds = new Set<string>();
  if (typeof payload.heroes === "object" && payload.heroes !== null && !Array.isArray(payload.heroes)) {
    for (const rawHero of Object.values(payload.heroes as UnknownRecord)) {
      if (typeof rawHero !== "object" || rawHero === null || Array.isArray(rawHero)) continue;
      const equips = (rawHero as UnknownRecord).equips;
      if (!Array.isArray(equips)) continue;
      for (const equipId of equips) if (typeof equipId === "string") equippedIds.add(equipId);
    }
  }
  const items = parsedItems.map((item): YyxYuhun => ({
    ...item,
    equipped: item.equipped === true || equippedIds.has(item.id)
  }));
  return {
    format: "onmyoji-hub",
    items,
    heroBases: parseHubHeroBases(payload, new Map(items.map((item) => [item.id, item])))
  };
}

function invalid(path: string, message: string): never {
  throw new Error(`Invalid yyx snapshot at ${path}: ${message}`);
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "expected an object");
  }
  return value as UnknownRecord;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return invalid(path, "expected an array");
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "expected a string");
  return value;
}

function requireNonEmptyString(value: unknown, path: string): string {
  const result = requireString(value, path);
  if (result.length === 0) return invalid(path, "expected a non-empty string");
  return result;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return invalid(path, "expected a boolean");
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(path, "expected a finite number");
  }
  return value;
}

function requireInteger(value: unknown, path: string, minimum: number, maximum?: number): number {
  const result = requireFiniteNumber(value, path);
  if (!Number.isInteger(result) || result < minimum || (maximum !== undefined && result > maximum)) {
    const range = maximum === undefined ? `at least ${minimum}` : `from ${minimum} to ${maximum}`;
    return invalid(path, `expected an integer ${range}`);
  }
  return result;
}

interface ParsedAttribute {
  stat: StatId;
  value: number;
}

function parseAttribute(value: unknown, path: string): ParsedAttribute {
  const raw = requireRecord(value, path);
  const rawType = requireString(raw.type, `${path}.type`);
  const stat = YYX_STAT_IDS[rawType];
  if (stat === undefined) return invalid(`${path}.type`, `unknown attribute type ${rawType}`);
  return {
    stat,
    value: requireFiniteNumber(raw.value, `${path}.value`)
  };
}

function parseAttributes(
  value: unknown,
  path: string,
  options: { maximum: number; allowedStats?: ReadonlySet<StatId> }
): Partial<Record<StatId, number>> {
  const attributes = requireArray(value, path);
  if (attributes.length > options.maximum) {
    return invalid(path, `expected at most ${options.maximum} attributes`);
  }

  const result: Partial<Record<StatId, number>> = {};
  for (const [index, rawAttribute] of attributes.entries()) {
    const attribute = parseAttribute(rawAttribute, `${path}[${index}]`);
    if (options.allowedStats !== undefined && !options.allowedStats.has(attribute.stat)) {
      return invalid(`${path}[${index}].type`, "attribute is not valid in this field");
    }
    if (result[attribute.stat] !== undefined) {
      return invalid(`${path}[${index}].type`, "duplicate attribute type");
    }
    result[attribute.stat] = attribute.value;
  }
  return result;
}

function sameAttributes(
  left: Partial<Record<StatId, number>>,
  right: Partial<Record<StatId, number>>
): boolean {
  const leftEntries = Object.entries(left) as Array<[StatId, number]>;
  const rightEntries = Object.entries(right) as Array<[StatId, number]>;
  return leftEntries.length === rightEntries.length &&
    leftEntries.every(([stat, value]) => right[stat] === value);
}

function parseYuhun(value: unknown, index: number): YyxYuhun {
  const path = `data.hero_equips[${index}]`;
  const raw = requireRecord(value, path);

  const id = requireNonEmptyString(raw.id, `${path}.id`);
  requireInteger(raw.equip_id, `${path}.equip_id`, 0);
  const level = requireInteger(raw.level, `${path}.level`, 0, 15);
  const position = requireInteger(raw.pos, `${path}.pos`, 0, 5) + 1;
  const star = requireInteger(raw.quality, `${path}.quality`, 1, 6);
  const born = requireInteger(raw.born, `${path}.born`, 0);
  const lock = requireBoolean(raw.lock, `${path}.lock`);
  const garbage = requireBoolean(raw.garbage, `${path}.garbage`);
  const suitId = requireInteger(raw.suit_id, `${path}.suit_id`, 0);
  const name = SUIT_NAMES_BY_ID.get(suitId);
  if (name === undefined) return invalid(`${path}.suit_id`, `unknown suit ID ${suitId}`);

  const main = parseAttribute(raw.base_attr, `${path}.base_attr`);
  const attrs = parseAttributes(raw.attrs, `${path}.attrs`, { maximum: 4 });
  const subStats = parseAttributes(raw.random_attrs, `${path}.random_attrs`, { maximum: 4 });
  if (!sameAttributes(attrs, subStats)) {
    return invalid(`${path}.attrs`, "does not match random_attrs");
  }

  const randomAttrRates = requireArray(raw.random_attr_rates, `${path}.random_attr_rates`);
  if (randomAttrRates.length > 0) {
    return invalid(`${path}.random_attr_rates`, "non-empty values are not supported");
  }

  const intrinsicStats = parseAttributes(raw.single_attrs, `${path}.single_attrs`, {
    maximum: 1,
    allowedStats: INTRINSIC_STAT_IDS
  });

  return {
    id,
    name,
    position,
    level,
    star,
    mainStat: main.stat,
    mainValue: main.value,
    subStats,
    intrinsicStats,
    lock,
    garbage,
    born,
    suitId,
    ...(typeof raw.herouid === "string" ? { equipped: true } : {}),
    initialSubStats: level <= 2 ? { ...subStats } : null
  };
}

/** Parse an already decoded yyx account snapshot into calculation-ready yuhun records. */
export function parseYyxSnapshot(json: unknown): YyxYuhun[] {
  const root = requireRecord(json, "snapshot");
  requireString(root.version, "version");
  requireString(root.timestamp, "timestamp");
  const data = requireRecord(root.data, "data");
  return requireArray(data.hero_equips, "data.hero_equips").map(parseYuhun);
}

/** Parse either a yyx snapshot or an OnmyojiHub/CBG export. */
export function parseGameSnapshot(json: unknown): ParsedGameSnapshot {
  const root = requireRecord(json, "snapshot");
  if (Object.prototype.hasOwnProperty.call(root, "equip_desc")) return parseOnmyojiHubSnapshot(root);
  const items = parseYyxSnapshot(root);
  const data = requireRecord(root.data, "data");
  return { format: "yyx", items, heroBases: parseYyxHeroBases(data) };
}
