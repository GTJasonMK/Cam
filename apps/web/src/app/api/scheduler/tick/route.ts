// ============================================================
// API: 手动触发调度器
// POST /api/scheduler/tick  - 执行一次调度循环
// ============================================================

import { runSchedulerTick } from '@/lib/scheduler';
import { API_COMMON_MESSAGES } from '@/lib/i18n/messages';
import { withAuth } from '@/lib/auth/with-auth';
import { apiInternalError, apiMessageSuccess } from '@/lib/http/api-response';

async function handler() {
  try {
    await runSchedulerTick();
    return apiMessageSuccess(API_COMMON_MESSAGES.schedulerTickExecuted);
  } catch (err) {
    console.error('[API] 调度器执行异常:', err);
    return apiInternalError((err as Error).message);
  }
}

export const POST = withAuth(handler, 'worker:manage');
