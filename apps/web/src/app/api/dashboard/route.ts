// ============================================================
// API: Dashboard 数据
// GET /api/dashboard  - 获取仪表盘汇总数据
// ============================================================

import { fetchDashboardData } from '@/lib/dashboard/queries';
import { API_COMMON_MESSAGES } from '@/lib/i18n/messages';
import { withAuth } from '@/lib/auth/with-auth';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { apiInternalError, apiSuccess } from '@/lib/http/api-response';

async function handler() {
  ensureSchedulerStarted();
  try {
    const data = await fetchDashboardData();
    return apiSuccess(data);
  } catch (err) {
    console.error('[API] Dashboard 数据获取失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.dataFetchFailed);
  }
}

export const GET = withAuth(handler, 'task:read');
