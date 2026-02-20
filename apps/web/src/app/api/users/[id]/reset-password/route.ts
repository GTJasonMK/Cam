// ============================================================
// API: /api/users/[id]/reset-password
// POST — 管理员重置用户密码
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, sessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/password';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

type RouteContext = { params: Promise<Record<string, string>> };

async function handler(request: AuthenticatedRequest, context: RouteContext) {
  try {
    const params = await context.params;
    const id = params.id;

    const existing = db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
    if (!existing) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: `用户 ${id} 不存在` } },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: '新密码长度不能少于 8 字符' } },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(newPassword);
    db.update(users)
      .set({ passwordHash, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id))
      .run();

    // 清除该用户所有 Session，强制重新登录
    db.delete(sessions).where(eq(sessions.userId, id)).run();

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API] 重置密码失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '重置密码失败' } },
      { status: 500 }
    );
  }
}

export const POST = withAuth(handler, 'user:update');
