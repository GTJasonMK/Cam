import { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME, getConfiguredAuthToken } from '@/lib/auth/constants';
import { getAuthMode } from '@/lib/auth/config';
import { AUTH_MESSAGES } from '@/lib/i18n/messages';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, getSessionCookieMaxAgeSeconds, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { buildAuthCookieOptions } from '@/lib/auth/cookie-options';
import { parsePasswordLoginPayload } from '@/lib/validation/user-input';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { getRequestClientInfo } from '@/lib/auth/request-client';
import { apiBadRequest, apiError, apiInternalError, apiSuccess } from '@/lib/http/api-response';
import { normalizeOptionalString } from '@/lib/validation/strings';

export async function POST(request: NextRequest) {
  try {
    const authMode = await getAuthMode();

    // 用户系统模式：用户名 + 密码 → 创建 Session
    if (authMode === 'user_system') {
      const body = await readJsonBodyAsRecord(request);
      const parsed = parsePasswordLoginPayload(body);
      if (!parsed.success) {
        return apiBadRequest(parsed.errorMessage);
      }

      const { username, password } = parsed.data;

      const row = db
        .select({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          email: users.email,
          role: users.role,
          status: users.status,
          avatarUrl: users.avatarUrl,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.username, username))
        .get();

      // 统一返回“用户名或密码错误”，避免暴露用户名是否存在
      if (!row) {
        return apiError('INVALID_CREDENTIALS', '用户名或密码错误', { status: 401 });
      }

      if (row.status === 'disabled') {
        return apiError('USER_DISABLED', '账户已被禁用', { status: 403 });
      }

      if (!row.passwordHash) {
        return apiError('NO_PASSWORD', '该账户未设置密码，请使用 OAuth 登录', { status: 400 });
      }

      const ok = await verifyPassword(password, row.passwordHash);
      if (!ok) {
        return apiError('INVALID_CREDENTIALS', '用户名或密码错误', { status: 401 });
      }

      const { ipAddress, userAgent } = getRequestClientInfo(request);
      const token = await createSession({ userId: row.id, ipAddress, userAgent });
      const now = new Date().toISOString();

      db.update(users)
        .set({ lastLoginAt: now, updatedAt: now })
        .where(eq(users.id, row.id))
        .run();

      const response = apiSuccess({
        id: row.id,
        username: row.username,
        displayName: row.displayName,
        email: row.email,
        role: row.role,
        status: row.status,
        avatarUrl: row.avatarUrl,
      });

      response.cookies.set(SESSION_COOKIE_NAME, token, {
        ...buildAuthCookieOptions({ maxAge: getSessionCookieMaxAgeSeconds() }),
      });

      return response;
    }

    if (authMode === 'setup_required') {
      return apiError('SETUP_REQUIRED', AUTH_MESSAGES.setupRequired, { status: 409 });
    }

    const configuredToken = getConfiguredAuthToken();
    if (!configuredToken) {
      return apiError('AUTH_NOT_CONFIGURED', AUTH_MESSAGES.notConfigured, { status: 503 });
    }

    const body = await readJsonBodyAsRecord(request);
    const token = normalizeOptionalString(body.token) ?? '';
    if (!token) {
      return apiBadRequest(AUTH_MESSAGES.tokenRequired);
    }
    if (token !== configuredToken) {
      return apiError('INVALID_TOKEN', AUTH_MESSAGES.tokenInvalid, { status: 401 });
    }

    const response = apiSuccess(null);
    response.cookies.set(AUTH_COOKIE_NAME, configuredToken, {
      ...buildAuthCookieOptions({ maxAge: 60 * 60 * 12 }),
    });
    return response;
  } catch (err) {
    console.error('[API] 登录失败:', err);
    return apiInternalError(AUTH_MESSAGES.loginFailed);
  }
}
