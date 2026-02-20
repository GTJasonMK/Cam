// ============================================================
// API: Dashboard 数据
// GET /api/dashboard  - 获取仪表盘汇总数据
// ============================================================

import { NextResponse } from 'next/server';
import { fetchDashboardData } from '@/lib/dashboard/queries';
import { API_COMMON_MESSAGES } from '@/lib/i18n/messages';
import { withAuth } from '@/lib/auth/with-auth';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';

async function handler() {
  ensureSchedulerStarted();
  try {
    const data = await fetchDashboardData();
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[API] Dashboard 数据获取失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.dataFetchFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler, 'task:read');
