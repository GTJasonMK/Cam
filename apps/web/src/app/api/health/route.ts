// ============================================================
// API: 健康检查
// GET /api/health
// ============================================================

import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { systemEvents } from '@/lib/db/schema';
import { HEALTH_MESSAGES } from '@/lib/i18n/messages';
import { ensureSchedulerStarted, getSchedulerRuntimeStatus } from '@/lib/scheduler/auto-start';

export async function GET() {
  const now = new Date().toISOString();

  // 兜底：即便启动钩子异常，也确保健康检查会拉起调度器
  ensureSchedulerStarted();

  try {
    await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(systemEvents)
      .limit(1);
    const scheduler = getSchedulerRuntimeStatus();
    return NextResponse.json({
      success: true,
      data: {
        status: 'ok',
        checkedAt: now,
        database: { ok: true },
        scheduler,
      },
    });
  } catch (err) {
    console.error('[API] 健康检查失败:', err);
    return NextResponse.json(
      {
        success: false,
        error: { code: 'HEALTHCHECK_FAILED', message: (err as Error).message || HEALTH_MESSAGES.failed },
        data: {
          status: 'degraded',
          checkedAt: now,
          database: { ok: false },
          scheduler: getSchedulerRuntimeStatus(),
        },
      },
      { status: 503 }
    );
  }
}
