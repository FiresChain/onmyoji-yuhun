import type {
  TeamCodeInspectionDTO,
  YuhunFilterDraft,
  YuhunFilterShare
} from "../../src/browser.js";
import { canonicalYuhunName, TWO_PIECE_EFFECTS, YUHUN_SUIT_IDS_BY_NAME } from "../../src/mappings.js";

const API_URL = (import.meta.env.VITE_ONMYOJI_API_URL ?? "https://api.fireschain.org").replace(/\/$/, "");
const namesById = new Map<number, string>(Object.entries(YUHUN_SUIT_IDS_BY_NAME).map(([name, id]) => [id, name]));

function suitNameById(id: number): string {
  const name = namesById.get(id);
  if (!Number.isSafeInteger(id) || name === undefined) throw new Error(`未知御魂套装 ID：${id}`);
  return name;
}

interface ApiEnvelope<T> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: unknown;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("无法连接阵容码服务，请检查网络后重试");
  }
  const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || payload?.ok !== true || payload.data === undefined) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `服务请求失败（${response.status}）`);
  }
  return payload.data;
}

export async function decodeTeamCode(teamCode: string): Promise<TeamCodeInspectionDTO> {
  const data = await post<TeamCodeInspectionDTO>("/onmyoji/v1/team-code/decode", { teamCode });
  return { ...data, editableTargets: data.editableTargets.map(target => {
    const suitRequirements = target.suitRequirements?.map(requirement => {
      let name = canonicalYuhunName(requirement.name);
      if (requirement.suitId !== undefined) name = suitNameById(requirement.suitId);
      else if (requirement.effectId !== undefined) {
        const effect = TWO_PIECE_EFFECTS.find(item => item.teamCodeId === requirement.effectId);
        if (effect === undefined) throw new Error(`未知两件套效果 ID：${requirement.effectId}`);
        name = effect.name;
      }
      return { ...requirement, name };
    });
    return { ...target, ...(suitRequirements === undefined ? {} : { suitRequirements }), suits: suitRequirements?.map(item => item.name) ?? target.suits };
  }) };
}

export async function decodeYuhunCode(yuhunCode: string): Promise<YuhunFilterShare> {
  const data = await post<{ readonly share: YuhunFilterShare }>("/onmyoji/v1/yuhun-code/decode", { yuhunCode });
  return { ...data.share, groups: data.share.groups.map(group => ({
    ...group,
    criteria: { ...group.criteria, types: group.criteria.typeIds?.map(suitNameById) ?? group.criteria.types.map(canonicalYuhunName) }
  })) };
}

export async function encodeYuhunDraft(draft: Omit<YuhunFilterDraft, "headerHex"> & { readonly headerHex?: string; readonly id?: string }): Promise<{ readonly yuhunCode: string; readonly share: YuhunFilterShare }> {
  const groups = draft.groups.map(group => {
    const typeIds = group.criteria?.typeIds ?? (group.criteria?.types ?? []).map(name => {
      const id = YUHUN_SUIT_IDS_BY_NAME[canonicalYuhunName(name) as keyof typeof YUHUN_SUIT_IDS_BY_NAME];
      if (id === undefined) throw new Error(`未知御魂套装：${name}`);
      return id;
    });
    const types = typeIds.map(suitNameById);
    // Keep names during service migration: older encoders must not silently
    // interpret an ID-only condition as an unrestricted suit filter.
    return { ...group, criteria: { ...group.criteria, types, typeIds } };
  });
  return post("/onmyoji/v1/yuhun-code/encode", { draft: { ...draft, groups } });
}
