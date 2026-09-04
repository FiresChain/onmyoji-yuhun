import type {
  TeamCodeInspectionDTO,
  YuhunFilterDraft,
  YuhunFilterShare
} from "../../src/browser.js";

const API_URL = (import.meta.env.VITE_ONMYOJI_API_URL ?? "https://api.fireschain.org").replace(/\/$/, "");

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

export function inspectTeamCode(teamCode: string): Promise<TeamCodeInspectionDTO> {
  return post("/onmyoji/v1/team-code/inspect", { teamCode });
}

export async function decodeYuhunCode(yuhunCode: string): Promise<YuhunFilterShare> {
  const data = await post<{ readonly share: YuhunFilterShare }>("/onmyoji/v1/yuhun-code/decode", { yuhunCode });
  return data.share;
}

export async function encodeYuhunDraft(draft: YuhunFilterDraft): Promise<{ readonly yuhunCode: string; readonly share: YuhunFilterShare }> {
  return post("/onmyoji/v1/yuhun-code/encode", { draft });
}
