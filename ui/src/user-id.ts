const USER_ID_KEY = "onmyoji-yuhun-code-user-id-v1";

export function normalizeYuhunUserId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{32}$/i.test(value) ? value.toLowerCase() : null;
}

export function loadYuhunUserId(): string | null {
  try { return normalizeYuhunUserId(localStorage.getItem(USER_ID_KEY)); } catch { return null; }
}

export function saveYuhunUserId(value: string): void {
  const id = normalizeYuhunUserId(value);
  if (id === null) throw new Error("御魂码中的用户 ID 无效");
  try { localStorage.setItem(USER_ID_KEY, id); } catch {
    throw new Error("无法保存用户 ID，请允许浏览器使用本地存储后重试");
  }
}
