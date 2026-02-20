// ============================================================
// API: /api/auth/change-password
// POST — 当前用户修改自己的密码
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { verifyPassword, hashPassword } from '@/lib/auth/password';
import { revokeAllUserSessions, createSession, getSessionCookieMaxAgeSeconds, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { parseChangePasswordPayload } from '@/lib/validation/user-input';

async function handlePost(request: AuthenticatedRequest) {
  const body = await request.json().catch(() => ({}));
  const validation = parseChangePasswordPayload(body);

  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_INPUT', message: validation.errorMessage } },
      { status: 400 }
    );
  }

  const { currentPassword, newPassword } = validation.data;

  // 获取当前用户（含密码哈希）
  const user = db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, request.user.id))
    .get();

  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: '用户不存在' } },
      { status: 404 }
    );
  }

  // OAuth-only 用户无密码，不能用此接口
  if (!user.passwordHash) {
    return NextResponse.json(
      { success: false, error: { code: 'NO_PASSWORD', message: '当前账户无密码（OAuth 用户），请使用 OAuth 登录' } },
      { status: 400 }
    );
  }

  // 验证当前密码
  const currentValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentValid) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_PASSWORD', message: '当前密码错误' } },
      { status: 401 }
    );
  }

  // 更新密码
  const newHash = await hashPassword(newPassword);
  db.update(users)
    .set({
      passwordHash: newHash,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(users.id, request.user.id))
    .run();

  // 吊销所有旧 Session
  await revokeAllUserSessions(request.user.id);

  // 创建新 Session
  const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  const userAgent = request.headers.get('user-agent') || undefined;
  const newToken = await createSession({ userId: request.user.id, ipAddress, userAgent });

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, newToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: getSessionCookieMaxAgeSeconds(),
  });

  return response;
}

export const POST = withAuth(handlePost);
