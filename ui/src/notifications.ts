export const NOTIFICATION_STORAGE_KEY = "onmyoji-yuhun-notifications-v1";
export const WARNING_READING_MS = 5_000;

export const TEST_WARNING = {
  title: "测试阶段警告",
  paragraphs: [
    "目前处于测试阶段，请勿直接将生成的御魂码用于游戏。",
    "预计在特邀测试服测试约 3 个月。"
  ]
} as const;

export interface ReleaseNotification {
  readonly version: string;
  readonly date: string;
  readonly title: string;
  readonly changes: readonly string[];
}

// Add new releases at the beginning with a new, stable version identifier.
export const RELEASE_NOTIFICATIONS: readonly ReleaseNotification[] = [{
  version: "2026.09.11.1",
  date: "2026-09-11",
  title: "方案比对与设置更新",
  changes: [
    "新增方案保存、导入、导出和比对。",
    "新增预期空位、用户 ID 设置和独立数据共享开关。",
    "新增通知中心和首次使用确认。"
  ]
}];

export interface NotificationState {
  readonly warningAcknowledged: boolean;
  readonly sharingConfirmed: boolean;
  readonly readVersions: readonly string[];
}

export function loadNotificationState(): NotificationState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(NOTIFICATION_STORAGE_KEY) ?? "null");
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const state = value as Partial<NotificationState>;
      return {
        warningAcknowledged: state.warningAcknowledged === true,
        sharingConfirmed: state.sharingConfirmed === true,
        readVersions: Array.isArray(state.readVersions) ? state.readVersions.filter((version): version is string => typeof version === "string") : []
      };
    }
  } catch { /* A fresh browser starts with the warning. */ }
  return { warningAcknowledged: false, sharingConfirmed: false, readVersions: [] };
}

export function saveNotificationState(state: NotificationState): void {
  try { localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(state)); }
  catch { throw new Error("无法保存通知状态，请允许本地存储后重试"); }
}
