import { NextRequest, NextResponse } from 'next/server';
import { consumeRateLimitToken } from '@/lib/rate-limit/memory';
import { GATEWAY_MESSAGES } from '@/lib/i18n/messages';

const AUTH_COOKIE_NAME = 'cam_auth_token';
const AUTH_TOKEN_ENV = 'CAM_AUTH_TOKEN';

const PUBLIC_PAGE_PATHS = new Set<string>();
const PUBLIC_API_PREFIXES = ['/api/auth/login', '/api/auth/logout', '/api/health'];
const RATE_LIMIT_EXEMPT_API_PREFIXES = ['/api/health', '/api/events/stream'];

function getConfiguredToken(): string | null {
  const value = process.env[AUTH_TOKEN_ENV];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIntInRange(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.floor(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function isRateLimitEnabled(): boolean {
  const flag = (process.env.CAM_RATE_LIMIT_ENABLED || '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  return true;
}

function getRateLimitConfig() {
  return {
    windowMs: parseIntInRange(process.env.CAM_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000),
    maxRequests: parseIntInRange(process.env.CAM_RATE_LIMIT_MAX_REQUESTS, 240, 1, 20_000),
  };
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGE_PATHS.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function getRequestIp(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') || 'unknown';
}

function isWorkerInternalApi(pathname: string): boolean {
  if (!pathname.startsWith('/api/workers/')) return false;
  return pathname.endsWith('/heartbeat') || pathname.endsWith('/next-task');
}

function isRateLimitExemptApi(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return true;
  if (RATE_LIMIT_EXEMPT_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  if (isWorkerInternalApi(pathname)) return true;
  if (pathname.startsWith('/api/tasks/') && pathname.endsWith('/logs/append')) return true;
  return false;
}

function hasValidAuth(request: NextRequest, configuredToken: string): boolean {
  const cookieToken = request.cookies.get(AUTH_COOKIE_NAME)?.value?.trim();
  if (cookieToken === configuredToken) return true;

  const authorization = request.headers.get('authorization');
  if (!authorization) return false;
  const [scheme, token] = authorization.split(' ', 2);
  return scheme?.toLowerCase() === 'bearer' && token?.trim() === configuredToken;
}

function buildApiUnauthorizedResponse() {
  return NextResponse.json(
    { success: false, error: { code: 'UNAUTHORIZED', message: GATEWAY_MESSAGES.unauthorized } },
    { status: 401 }
  );
}

function applyRateLimitIfNeeded(request: NextRequest): NextResponse | null {
  if (!isRateLimitEnabled()) return null;
  const { pathname } = request.nextUrl;
  if (request.method === 'OPTIONS') return null;
  if (isRateLimitExemptApi(pathname)) return null;

  const { maxRequests, windowMs } = getRateLimitConfig();
  const key = `${getRequestIp(request)}:${pathname.startsWith('/api/auth/login') ? 'login' : 'api'}`;
  const decision = consumeRateLimitToken({
    key,
    limit: maxRequests,
    windowMs,
  });
  if (decision.allowed) return null;

  const retryAfterSec = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));
  const response = NextResponse.json(
    {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: GATEWAY_MESSAGES.rateLimited,
      },
    },
    { status: 429 }
  );
  response.headers.set('Retry-After', String(retryAfterSec));
  response.headers.set('X-RateLimit-Limit', String(decision.limit));
  response.headers.set('X-RateLimit-Remaining', String(decision.remaining));
  response.headers.set('X-RateLimit-Reset', String(Math.floor(decision.resetAt / 1000)));
  return response;
}

export function middleware(request: NextRequest) {
  const limited = applyRateLimitIfNeeded(request);
  if (limited) return limited;

  const configuredToken = getConfiguredToken();
  if (!configuredToken) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const authorized = hasValidAuth(request, configuredToken);

  if (pathname === '/login') {
    if (!authorized) return NextResponse.next();
    const nextParam = request.nextUrl.searchParams.get('next') || '/';
    const target = nextParam.startsWith('/') ? nextParam : '/';
    return NextResponse.redirect(new URL(target, request.url));
  }

  if (isPublicPath(pathname) || request.method === 'OPTIONS') return NextResponse.next();

  if (authorized) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return buildApiUnauthorizedResponse();
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
