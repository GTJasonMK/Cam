// ============================================================
// API: Task 依赖关系
// GET /api/tasks/[id]/relations  - 返回 dependencies + dependents（不含日志/明文）
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks } from '@/lib/db/schema';
import { eq, inArray, sql } from 'drizzle-orm';
import { API_COMMON_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

type TaskMini = {
  id: string;
  title: string;
  status: string;
  groupId: string | null;
  createdAt: string;
};

async function handler(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const row = await db
      .select({
        id: tasks.id,
        dependsOn: tasks.dependsOn,
      })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);

    if (row.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: TASK_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    const deps = ((row[0].dependsOn as unknown) || []) as string[];

    const dependencies: TaskMini[] =
      deps.length === 0
        ? []
        : await db
            .select({
              id: tasks.id,
              title: tasks.title,
              status: tasks.status,
              groupId: tasks.groupId,
              createdAt: tasks.createdAt,
            })
            .from(tasks)
            .where(inArray(tasks.id, deps))
            .orderBy(tasks.createdAt);

    // SQLite JSON array contains: EXISTS (SELECT 1 FROM json_each(depends_on) WHERE value = ?)
    const dependents: TaskMini[] = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        groupId: tasks.groupId,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .where(
        sql`EXISTS (SELECT 1 FROM json_each(${tasks.dependsOn}) WHERE value = ${id})`
      )
      .orderBy(tasks.createdAt)
      .limit(200);

    return NextResponse.json({
      success: true,
      data: {
        dependencies,
        dependents,
      },
    });
  } catch (err) {
    console.error(`[API] 获取任务 ${id} relations 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.queryFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handler, 'task:read');
