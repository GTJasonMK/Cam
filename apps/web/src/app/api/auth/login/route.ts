import { NextRequest, NextResponse } from 'next/server';
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

export async function POST(request: NextRequest) {
  try {
    const authMode = await getAuthMode();

    // 用户系统模式：用户名 + 密码 → 创建 Session
    if (authMode === 'user_system') {
      const body = await request.json().catch(() => ({}));
      const parsed = parsePasswordLoginPayload(body);
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: { code: 'INVALID_INPUT', message: parsed.errorMessage } },
          { status: 400 }
        );
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
        return NextResponse.json(
          { success: false, error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } },
          { status: 401 }
        );
      }

      if (row.status === 'disabled') {
        return NextResponse.json(
          { success: false, error: { code: 'USER_DISABLED', message: '账户已被禁用' } },
          { status: 403 }
        );
      }

      if (!row.passwordHash) {
        return NextResponse.json(
          { success: false, error: { code: 'NO_PASSWORD', message: '该账户未设置密码，请使用 OAuth 登录' } },
          { status: 400 }
        );
      }

      const ok = await verifyPassword(password, row.passwordHash);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码错误' } },
          { status: 401 }
        );
      }

      const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'unknown';
      const userAgent = request.headers.get('user-agent') || undefined;

      const token = await createSession({ userId: row.id, ipAddress, userAgent });
      const now = new Date().toISOString();

      db.update(users)
        .set({ lastLoginAt: now, updatedAt: now })
        .where(eq(users.id, row.id))
        .run();

      const response = NextResponse.json({
        success: true,
        data: {
          id: row.id,
          username: row.username,
          displayName: row.displayName,
          email: row.email,
          role: row.role,
          status: row.status,
          avatarUrl: row.avatarUrl,
        },
      });

      response.cookies.set(SESSION_COOKIE_NAME, token, {
        ...buildAuthCookieOptions({ maxAge: getSessionCookieMaxAgeSeconds() }),
      });

      return response;
    }

    if (authMode === 'setup_required') {
      return NextResponse.json(
        { success: false, error: { code: 'SETUP_REQUIRED', message: AUTH_MESSAGES.setupRequired } },
        { status: 409 }
      );
    }

    const configuredToken = getConfiguredAuthToken();
    if (!configuredToken) {
      return NextResponse.json(
        { success: false, error: { code: 'AUTH_NOT_CONFIGURED', message: AUTH_MESSAGES.notConfigured } },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: AUTH_MESSAGES.tokenRequired } },
        { status: 400 }
      );
    }
    if (token !== configuredToken) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_TOKEN', message: AUTH_MESSAGES.tokenInvalid } },
        { status: 401 }
      );
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set(AUTH_COOKIE_NAME, configuredToken, {
      ...buildAuthCookieOptions({ maxAge: 60 * 60 * 12 }),
    });
    return response;
  } catch (err) {
    console.error('[API] 登录失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: AUTH_MESSAGES.loginFailed } },
      { status: 500 }
    );
  }
}
