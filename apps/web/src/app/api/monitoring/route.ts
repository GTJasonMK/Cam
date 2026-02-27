// ============================================================
// API: 监控面板数据
// GET /api/monitoring?minutes=30
// ============================================================

import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { apiBadRequest, apiInternalError, apiSuccess } from '@/lib/http/api-response';
import { getMonitoringOverview } from '@/lib/monitoring/service';

const DEFAULT_HISTORY_WINDOW_MINUTES = 30;

async function handler(request: AuthenticatedRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawMinutes = searchParams.get('minutes');

  let minutes = DEFAULT_HISTORY_WINDOW_MINUTES;
  if (rawMinutes) {
    const parsed = Number.parseInt(rawMinutes, 10);
    if (!Number.isFinite(parsed)) {
      return apiBadRequest('minutes 参数必须为整数');
    }
    minutes = parsed;
  }

  try {
    const data = await getMonitoringOverview({ historyWindowMinutes: minutes });
    return apiSuccess(data);
  } catch (error) {
    console.error('[API] 读取监控数据失败:', error);
    return apiInternalError('读取监控数据失败');
  }
}

export const GET = withAuth(handler, 'worker:read');

export const runtime = 'nodejs';
