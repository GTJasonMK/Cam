// ============================================================
// Event: 系统事件，用于 SSE 推送和审计
// ============================================================

export const EVENT_TYPES = [
  'task.created',
  'task.queued',
  'task.started',
  'task.progress',
  'task.completed',
  'task.failed',
  'task.review_approved',
  'task.review_rejected',
  'worker.online',
  'worker.offline',
  'worker.heartbeat',
  'alert.triggered',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface SystemEvent {
  id: string;
  type: EventType;
  payload: Record<string, unknown>;
  timestamp: string;
}

/** 通用 API 响应包装 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
