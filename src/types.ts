export type PlanKind = "discard" | "enhance" | "unknown";
export type KnownPlanKind = Exclude<PlanKind, "unknown">;

export type StatId =
  | "attack"
  | "attackPercent"
  | "defense"
  | "defensePercent"
  | "hp"
  | "hpPercent"
  | "speed"
  | "effectHit"
  | "effectResist"
  | "crit"
  | "critDamage";

export type IntrinsicStatId =
  | "attackPercent"
  | "defensePercent"
  | "hpPercent"
  | "effectHit"
  | "effectResist"
  | "crit";

export type SubStatRequirement = "include" | "exclude";
export type SubStatCount = "lessThan2" | "2" | "3" | "4";
export type LevelRange = "0-2" | "3-5" | "6-8" | "9-11" | "12-14" | "15";

export interface SubStatFilter {
  stat: StatId;
  requirement: SubStatRequirement;
}

export interface FilterCriteria {
  types: string[];
  positions: number[];
  stars: number[];
  mainStats: StatId[];
  subStats: SubStatFilter[];
  subStatCounts: SubStatCount[];
  levelRanges: LevelRange[];
  intrinsicStats: IntrinsicStatId[];
  unknownTypeBits: number[];
  unknownOptionBits: number[];
}

export interface RawGroupMasks {
  typeMaskHex: string;
  optionMaskHex: string;
}

export interface YuhunFilterGroup {
  name: string;
  raw: RawGroupMasks;
  criteria: FilterCriteria;
}

export type DecodeWarningCode =
  | "UNKNOWN_PLAN_KIND"
  | "UNKNOWN_TYPE_BITS"
  | "UNKNOWN_OPTION_BITS";

export interface DecodeWarning {
  code: DecodeWarningCode;
  message: string;
  groupIndex?: number;
  bits?: number[];
}

export interface YuhunFilterShare {
  format: "onmyoji-yuhun-filter";
  schemaVersion: 1;
  headerHex: string;
  planKind: PlanKind;
  planKindValue: number;
  groups: YuhunFilterGroup[];
  warnings: DecodeWarning[];
}

/** Semantic input for creating a new share code. Omitted arrays mean no restriction. */
export interface FilterCriteriaDraft {
  types?: string[];
  positions?: number[];
  stars?: number[];
  mainStats?: StatId[];
  subStats?: SubStatFilter[];
  subStatCounts?: SubStatCount[];
  levelRanges?: LevelRange[];
  intrinsicStats?: IntrinsicStatId[];
  unknownTypeBits?: number[];
  unknownOptionBits?: number[];
}

export interface YuhunFilterDraftGroup {
  name: string;
  criteria?: FilterCriteriaDraft;
}

export interface YuhunFilterDraft {
  headerHex: string;
  planKind: KnownPlanKind;
  groups: YuhunFilterDraftGroup[];
}
