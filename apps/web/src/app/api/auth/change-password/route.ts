// ============================================================
// API: /api/auth/change-password
// POST — 当前用户修改自己的密码
// ============================================================

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { verifyPassword, hashPassword } from '@/lib/auth/password';
import { revokeAllUserSessions, createSession, getSessionCookieMaxAgeSeconds, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { buildAuthCookieOptions } from '@/lib/auth/cookie-options';
import { parseChangePasswordPayload } from '@/lib/validation/user-input';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { getRequestClientInfo } from '@/lib/auth/request-client';
import { apiBadRequest, apiError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

async function handlePost(request: AuthenticatedRequest) {
  const body = await readJsonBodyAsRecord(request);
  const validation = parseChangePasswordPayload(body);

  if (!validation.success) {
    return apiBadRequest(validation.errorMessage);
  }

  const { currentPassword, newPassword } = validation.data;

  // 获取当前用户（含密码哈希）
  const user = db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, request.user.id))
    .get();

  if (!user) {
    return apiNotFound('用户不存在');
  }

  // OAuth-only 用户无密码，不能用此接口
  if (!user.passwordHash) {
    return apiError('NO_PASSWORD', '当前账户无密码（OAuth 用户），请使用 OAuth 登录', { status: 400 });
  }

  // 验证当前密码
  const currentValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentValid) {
    return apiError('INVALID_PASSWORD', '当前密码错误', { status: 401 });
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
  const { ipAddress, userAgent } = getRequestClientInfo(request);
  const newToken = await createSession({ userId: request.user.id, ipAddress, userAgent });

  const response = apiSuccess(null);
  response.cookies.set(SESSION_COOKIE_NAME, newToken, {
    ...buildAuthCookieOptions({ maxAge: getSessionCookieMaxAgeSeconds() }),
  });

  return response;
}

export const POST = withAuth(handlePost);
