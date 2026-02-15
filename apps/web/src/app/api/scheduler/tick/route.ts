// ============================================================
// API: 手动触发调度器
// POST /api/scheduler/tick  - 执行一次调度循环
// ============================================================

import { NextResponse } from 'next/server';
import { runSchedulerTick } from '@/lib/scheduler';
import { API_COMMON_MESSAGES } from '@/lib/i18n/messages';

export async function POST() {
  try {
    await runSchedulerTick();
    return NextResponse.json({ success: true, message: API_COMMON_MESSAGES.schedulerTickExecuted });
  } catch (err) {
    console.error('[API] 调度器执行异常:', err);
    return NextResponse.json(
      { success: false, error: { message: (err as Error).message } },
      { status: 500 }
    );
  }
}
