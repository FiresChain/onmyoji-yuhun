import { filterShareFromDraft, type PlanCriteria, type PlanSummaryDTO, type YuhunFilterShare } from "../../src/browser.js";

export interface SavedPlan {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly source: "generated" | "imported";
  readonly snapshotSha256: string | null;
  readonly discardCode: string | null;
  readonly rescueCode: string | null;
  readonly criteria: PlanCriteria;
}

export interface PlanFile {
  readonly schemaVersion: 1;
  readonly kind: "onmyoji-yuhun-plan";
  readonly name: string;
  readonly discardCode: string | null;
  readonly rescueCode: string | null;
  readonly containsAccountDerivedData: true;
  readonly doNotCommit: true;
}

export function planName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80) throw new Error("方案名称需为 1–80 个字符");
  return name;
}

export function normalizePlanCode(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new Error("御魂码格式无效");
  const code = value.replace(/\s+/g, "");
  if (code.length > 100_000) throw new Error("御魂码过长");
  return code || null;
}

export function criteriaFromShare(share: YuhunFilterShare, kind: "discard" | "enhance"): PlanCriteria["discard"] {
  if (share.planKind !== kind) throw new Error(kind === "discard" ? "弃置码类型不正确" : "捡回码类型不正确");
  if (share.warnings.length > 0) throw new Error("御魂码存在不支持的条件");
  if (share.groups.length === 0) throw new Error("御魂码不包含规则");
  return filterShareFromDraft({ headerHex: share.headerHex, planKind: kind, groups: share.groups }).groups.map(group => group.criteria);
}

export function criteriaFromPlan(plan: PlanSummaryDTO): PlanCriteria {
  function collect(code: "D" | "E", expectedCount: number): PlanCriteria["discard"] {
    const groups = plan.groups.filter(group => group.code === code && group.pool === (code === "D" ? "normal" : "combined")).sort((a, b) => a.index - b.index);
    if (groups.length !== expectedCount || groups.some((group, index) => !group.criteria || group.index !== index)) {
      throw new Error("方案缺少规则，请重新生成");
    }
    if (groups.length === 0) return [];
    return filterShareFromDraft({ headerHex: "00".repeat(16), planKind: code === "D" ? "discard" : "enhance", groups: groups.map(group => ({ name: group.name, criteria: group.criteria! })) }).groups.map(group => group.criteria);
  }
  if (Boolean(plan.discardCode) !== (plan.discardGroupCount > 0) || Boolean(plan.rescueCode) !== (plan.rescueGroupCount > 0)) throw new Error("方案码与规则不一致，请重新生成");
  return { discard: collect("D", plan.discardGroupCount), rescue: collect("E", plan.rescueGroupCount) };
}

export function exportPlanFile(plan: SavedPlan): PlanFile {
  return { schemaVersion: 1, kind: "onmyoji-yuhun-plan", name: plan.name, discardCode: plan.discardCode, rescueCode: plan.rescueCode, containsAccountDerivedData: true, doNotCommit: true };
}

export function parsePlanFile(value: unknown): PlanFile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("方案文件格式无效");
  const input = value as Partial<PlanFile>;
  if (input.schemaVersion !== 1 || input.kind !== "onmyoji-yuhun-plan" || typeof input.name !== "string" || !("discardCode" in input) || !("rescueCode" in input)) throw new Error("方案文件格式无效");
  return { schemaVersion: 1, kind: "onmyoji-yuhun-plan", name: planName(input.name), discardCode: normalizePlanCode(input.discardCode), rescueCode: normalizePlanCode(input.rescueCode), containsAccountDerivedData: true, doNotCommit: true };
}
