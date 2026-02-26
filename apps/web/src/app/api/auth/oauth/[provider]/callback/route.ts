// ============================================================
// API: /api/auth/oauth/[provider]/callback
// GET — OAuth 回调处理
// 验证 state → 用 code 换 token → 获取用户信息 → 查找/创建用户 → 创建 Session
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, oauthAccounts } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getProviderById } from '@/lib/auth/oauth/providers';
import { verifyOAuthState, exchangeCodeForToken, fetchOAuthUserInfo } from '@/lib/auth/oauth/flow';
import { createSession, getSessionCookieMaxAgeSeconds, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { invalidateAuthModeCache } from '@/lib/auth/config';
import { isValidRole, type Role } from '@/lib/auth/permissions';
import { resolvePublicOrigin } from '@/lib/auth/public-origin';
import { buildAuthCookieOptions } from '@/lib/auth/cookie-options';
import { getRequestClientInfo } from '@/lib/auth/request-client';
import { normalizeOptionalString } from '@/lib/validation/strings';
import { randomUUID } from 'crypto';

type RouteContext = { params: Promise<Record<string, string>> };

function resolveDefaultRole(): Role {
  const raw = process.env.CAM_DEFAULT_USER_ROLE?.trim().toLowerCase() || 'developer';
  return isValidRole(raw) ? raw : 'developer';
}

const DEFAULT_ROLE = resolveDefaultRole();

function normalizeUsernameSeed(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
}

function buildUniqueUsername(seed: string): string {
  const normalizedSeed = normalizeUsernameSeed(seed);
  let base = normalizedSeed || `user-${Date.now().toString(36)}`;
  if (base.length < 3) {
    base = `${base}-user`;
  }
  base = base.slice(0, 32);
  if (base.length < 3) {
    base = `user-${Date.now().toString(36)}`.slice(0, 32);
  }

  let candidate = base;
  let suffix = 1;
  while (db.select({ id: users.id }).from(users).where(eq(users.username, candidate)).get()) {
    const suffixText = `-${suffix++}`;
    const head = base.slice(0, Math.max(3, 32 - suffixText.length));
    candidate = `${head}${suffixText}`;
  }

  return candidate;
}

function clearOAuthStateCookie(response: NextResponse): void {
  response.cookies.set('cam_oauth_state', '', {
    ...buildAuthCookieOptions({ maxAge: 0 }),
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  const providerId = params.provider;
  const provider = getProviderById(providerId);
  const publicOrigin = resolvePublicOrigin(request);

  if (!provider) {
    return redirectToLoginWithError('OAuth 提供商未启用', publicOrigin);
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const stateParam = searchParams.get('state');
  const errorParam = searchParams.get('error');

  // OAuth 提供商返回错误
  if (errorParam) {
    const desc = searchParams.get('error_description') || errorParam;
    return redirectToLoginWithError(`OAuth 错误: ${desc}`, publicOrigin);
  }

  if (!code || !stateParam) {
    return redirectToLoginWithError('OAuth 回调缺少必要参数', publicOrigin);
  }

  // 验证 state（从 Cookie 比对）
  const storedState = request.cookies.get('cam_oauth_state')?.value;
  if (!storedState || storedState !== stateParam) {
    return redirectToLoginWithError('OAuth state 验证失败（可能已过期，请重试）', publicOrigin);
  }

  if (!verifyOAuthState(stateParam, providerId)) {
    return redirectToLoginWithError('OAuth state 签名无效', publicOrigin);
  }

  try {
    // 用 code 换 access_token
    const callbackUrl = `${publicOrigin}/api/auth/oauth/${providerId}/callback`;
    const accessToken = await exchangeCodeForToken(provider, code, callbackUrl);

    // 获取 OAuth 用户信息
    const oauthUser = await fetchOAuthUserInfo(provider, accessToken);

    if (!oauthUser.providerAccountId || !oauthUser.username) {
      return redirectToLoginWithError('无法获取 OAuth 用户信息', publicOrigin);
    }

    // 查找已关联的 OAuth 账户
    const existingOAuth = db
      .select({ userId: oauthAccounts.userId })
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, providerId),
          eq(oauthAccounts.providerAccountId, oauthUser.providerAccountId),
        )
      )
      .get();

    let userId: string;
    const now = new Date().toISOString();

    if (existingOAuth) {
      // 已有关联 → 更新 OAuth Token，使用现有用户
      userId = existingOAuth.userId;

      db.update(oauthAccounts)
        .set({
          providerUsername: oauthUser.username,
          accessToken,
          updatedAt: now,
        })
        .where(
          and(
            eq(oauthAccounts.provider, providerId),
            eq(oauthAccounts.providerAccountId, oauthUser.providerAccountId),
          )
        )
        .run();

      // 更新用户头像和最后登录
      db.update(users)
        .set({
          avatarUrl: oauthUser.avatarUrl,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, userId))
        .run();

      // 检查用户是否被禁用
      const user = db.select({ status: users.status }).from(users).where(eq(users.id, userId)).get();
      if (user?.status === 'disabled') {
        return redirectToLoginWithError('账户已被禁用', publicOrigin);
      }
    } else {
      // 先尝试按邮箱关联已有用户（常见于“先密码登录后改用 OAuth”）
      const normalizedEmail = normalizeOptionalString(oauthUser.email);
      const existingByEmail = normalizedEmail
        ? db.select({ id: users.id, status: users.status }).from(users).where(eq(users.email, normalizedEmail)).get()
        : null;

      if (existingByEmail) {
        if (existingByEmail.status === 'disabled') {
          return redirectToLoginWithError('账户已被禁用', publicOrigin);
        }

        userId = existingByEmail.id;
        db.insert(oauthAccounts)
          .values({
            userId,
            provider: providerId,
            providerAccountId: oauthUser.providerAccountId,
            providerUsername: oauthUser.username,
            accessToken,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        db.update(users)
          .set({
            avatarUrl: oauthUser.avatarUrl,
            lastLoginAt: now,
            updatedAt: now,
          })
          .where(eq(users.id, userId))
          .run();
      } else {
        // 新 OAuth 用户 → 创建用户 + OAuth 关联
        const countRow = db
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .get();
        const isFirstUser = (countRow?.count ?? 0) === 0;
        const roleForNewUser = isFirstUser ? 'admin' : DEFAULT_ROLE;

        // 生成唯一用户名（避免与已有用户冲突）
        const finalUsername = buildUniqueUsername(`${oauthUser.username}-${providerId}-${oauthUser.providerAccountId}`);

        userId = randomUUID();

        db.insert(users)
          .values({
            id: userId,
            username: finalUsername,
            displayName: oauthUser.displayName,
            email: normalizedEmail,
            passwordHash: null, // OAuth-only 用户无密码
            role: roleForNewUser,
            status: 'active',
            avatarUrl: oauthUser.avatarUrl,
            lastLoginAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        db.insert(oauthAccounts)
          .values({
            userId,
            provider: providerId,
            providerAccountId: oauthUser.providerAccountId,
            providerUsername: oauthUser.username,
            accessToken,
            createdAt: now,
            updatedAt: now,
          })
          .run();

        // 有了用户就切换到用户系统模式
        invalidateAuthModeCache();
      }
    }

    // 创建 Session
    const { ipAddress, userAgent } = getRequestClientInfo(request);

    const sessionToken = await createSession({ userId, ipAddress, userAgent });

    // 重定向到首页并设置 Session Cookie
    const response = NextResponse.redirect(new URL('/', `${publicOrigin}/`));

    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      ...buildAuthCookieOptions({ maxAge: getSessionCookieMaxAgeSeconds() }),
    });

    // 清除 OAuth state Cookie
    clearOAuthStateCookie(response);

    return response;
  } catch (err) {
    console.error(`[OAuth] ${providerId} 回调失败:`, err);
    const msg = err instanceof Error ? err.message : 'OAuth 登录失败';
    return redirectToLoginWithError(msg, publicOrigin);
  }
}

/** 重定向到登录页并附加错误信息 */
function redirectToLoginWithError(message: string, publicOrigin: string): NextResponse {
  const loginUrl = new URL('/login', `${publicOrigin}/`);
  loginUrl.searchParams.set('error', message);
  const response = NextResponse.redirect(loginUrl);
  clearOAuthStateCookie(response);
  return response;
}
