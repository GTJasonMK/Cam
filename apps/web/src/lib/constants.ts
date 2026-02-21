// ============================================================
// 前端常量定义
// 统一管理状态颜色等 UI 常量，避免各页面重复定义
// ============================================================

/** 任务状态 -> 颜色 token */
export const TASK_STATUS_COLORS: Record<string, string> = {
  draft: 'muted-foreground',
  queued: 'accent',
  waiting: 'muted-foreground',
  running: 'primary',
  awaiting_review: 'warning',
  approved: 'success',
  completed: 'success',
  rejected: 'destructive',
  failed: 'destructive',
  cancelled: 'muted-foreground',
};

/** Worker 状态 -> 颜色 token */
export const WORKER_STATUS_COLORS: Record<string, string> = {
  idle: 'success',
  busy: 'primary',
  offline: 'destructive',
  draining: 'warning',
};

/** 用户状态 -> 颜色 token */
export const USER_STATUS_COLORS: Record<string, string> = {
  active: 'success',
  disabled: 'destructive',
};

/** 事件类型前缀 -> 颜色 token */
export const EVENT_TYPE_COLORS: Record<string, string> = {
  task: 'primary',
  worker: 'cyan',
  alert: 'warning',
  system: 'muted-foreground',
};

/** 状态文案映射（用于统一 UI 语言） */
export const STATUS_DISPLAY_LABELS: Record<string, string> = {
  draft: '草稿',
  queued: '排队中',
  waiting: '等待依赖',
  running: '运行中',
  awaiting_review: '待审批',
  approved: '已通过',
  completed: '已完成',
  rejected: '已拒绝',
  failed: '失败',
  cancelled: '已取消',
  idle: '空闲',
  busy: '忙碌',
  offline: '离线',
  draining: '排空中',
};

// ---- 颜色映射（适配新调色板） ----

const COLOR_HEX: Record<string, string> = {
  primary: '#2f6fed',
  success: '#22a06b',
  destructive: '#e35d6a',
  warning: '#f59e0b',
  accent: '#1f9b87',
  cyan: '#2aa8d8',
  'muted-foreground': '#95a4ba',
};

const COLOR_RGB: Record<string, string> = {
  primary: '47, 111, 237',
  success: '34, 160, 107',
  destructive: '227, 93, 106',
  warning: '245, 158, 11',
  accent: '31, 155, 135',
  cyan: '42, 168, 216',
  'muted-foreground': '149, 164, 186',
};

export function getColorVar(token: string): string {
  return `var(--color-${token})`;
}

export function getColorHex(token: string): string {
  return COLOR_HEX[token] || COLOR_HEX['muted-foreground'];
}

export function getBadgeBg(token: string): string {
  const rgb = COLOR_RGB[token] || COLOR_RGB['muted-foreground'];
  return `rgba(${rgb}, 0.18)`;
}

/** 获取徽章边框色 */
export function getBadgeBorder(token: string): string {
  const rgb = COLOR_RGB[token] || COLOR_RGB['muted-foreground'];
  return `rgba(${rgb}, 0.25)`;
}

/** 获取发光阴影（用于 KPI 卡片等） */
export function getGlowShadow(token: string, intensity = 0.15): string {
  const rgb = COLOR_RGB[token] || COLOR_RGB['muted-foreground'];
  return `0 0 20px rgba(${rgb}, ${intensity}), 0 0 40px rgba(${rgb}, ${intensity * 0.5})`;
}

/** 获取渐变背景 */
export function getGradientBg(token: string): string {
  const hex = COLOR_HEX[token];
  if (!hex) return 'var(--card)';
  return `linear-gradient(135deg, rgba(${COLOR_RGB[token]}, 0.08) 0%, transparent 60%)`;
}

/** 获取状态显示文案（未定义时回退原值） */
export function getStatusDisplayLabel(status: string): string {
  return STATUS_DISPLAY_LABELS[status] || status;
}
