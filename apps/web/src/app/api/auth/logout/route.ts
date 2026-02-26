import { NextRequest } from 'next/server';
import { AUTH_COOKIE_NAME } from '@/lib/auth/constants';
import { revokeSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { buildAuthCookieOptions } from '@/lib/auth/cookie-options';
import { apiSuccess } from '@/lib/http/api-response';
import { normalizeOptionalString } from '@/lib/validation/strings';

export async function POST(request: NextRequest) {
  const sessionToken = normalizeOptionalString(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (sessionToken) {
    try {
      await revokeSession(sessionToken);
    } catch {
      // 忽略吊销失败，仍然清 Cookie
    }
  }

  const response = apiSuccess(null);
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    ...buildAuthCookieOptions({ maxAge: 0 }),
  });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...buildAuthCookieOptions({ maxAge: 0 }),
  });
  return response;
}
