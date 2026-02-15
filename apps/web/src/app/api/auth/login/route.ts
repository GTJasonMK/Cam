import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, getConfiguredAuthToken } from '@/lib/auth/constants';
import { AUTH_MESSAGES } from '@/lib/i18n/messages';

export async function POST(request: NextRequest) {
  try {
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
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 12,
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
