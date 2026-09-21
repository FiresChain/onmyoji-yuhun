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
  version: "2026.09.21.1",
  date: "2026-09-21",
  title: "保留项允许影响比例",
  changes: [
    "双码新增保留项允许影响比例，默认 0%；强化规则保留项继续严格保护。",
    "空位不足时按额度优化规则覆盖，预演可查看实际影响数量、比例和御魂明细。"
  ]
}, {
  version: "2026.09.16.3",
  date: "2026-09-16",
  title: "数值显示与基础设置更新",
  changes: [
    "属性、面板和评分默认显示两位小数，可在设置中调整显示位数。",
    "基础信息优先展示小数位数、阵容计算资源与性能诊断，设备和性能数据改为表格。"
  ]
}, {
  version: "2026.09.16.2",
  date: "2026-09-16",
  title: "双码规则合并更新",
  changes: [
    "方案生成支持安全规则合并与 D/E 联合优化，提高单组双码的清理覆盖。",
    "优化后的方案继续按预期空位停止，并保护保留项和历史弃置。"
  ]
}, {
  version: "2026.09.16.1",
  date: "2026-09-16",
  title: "方案导入与计算详情更新",
  changes: [
    "方案导入支持分别识别弃置码、强化码二维码及读取剪贴板。",
    "修复恢复旧计算结果时御魂属性详情缺失。",
    "移除侧栏底部状态提示。"
  ]
}, {
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
