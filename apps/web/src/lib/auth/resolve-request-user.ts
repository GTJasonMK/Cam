// ============================================================
// 请求用户解析（三层认证 fallback）
// 1. cam_session Cookie → Session 系统用户
// 2. Bearer Token → API Token(cam_ 前缀) 或 Legacy CAM_AUTH_TOKEN
// 3. Legacy cam_auth_token Cookie → 虚拟 admin 用户
// ============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { apiTokens, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { resolveSessionUser, SESSION_COOKIE_NAME, type SessionUser } from './session';
import { getConfiguredAuthToken, AUTH_COOKIE_NAME } from './constants';
import { getAuthMode } from './config';
import { isLegacyTokenAllowedInUserSystemFromEnv } from './env-policy';

export type RequestUser = SessionUser & {
  /** 认证来源 */
  authSource: 'session' | 'api_token' | 'legacy_token' | 'legacy_cookie';
};

/** Legacy 模式下的虚拟 admin 用户 */
function createLegacyVirtualUser(source: 'legacy_token' | 'legacy_cookie'): RequestUser {
  return {
    id: '__legacy__',
    username: 'legacy-admin',
    displayName: 'Legacy Admin',
    email: null,
    role: 'admin',
    status: 'active',
    avatarUrl: null,
    authSource: source,
  };
}

/** 尝试通过 API Token (Bearer cam_xxx) 解析用户 */
async function resolveApiTokenUser(tokenRaw: string): Promise<RequestUser | null> {
  // API Token 以 cam_ 开头
  if (!tokenRaw.startsWith('cam_')) {
    return null;
  }

  const tokenHash = crypto.createHash('sha256').update(tokenRaw).digest('hex');

  const row = db
    .select({
      tokenId: apiTokens.id,
      userId: apiTokens.userId,
      expiresAt: apiTokens.expiresAt,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      role: users.role,
      status: users.status,
      avatarUrl: users.avatarUrl,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(eq(apiTokens.tokenHash, tokenHash))
    .get();

  if (!row) return null;

  // Token 过期
  if (row.expiresAt && row.expiresAt < new Date().toISOString()) {
    return null;
  }

  // 用户被禁用
  if (row.status === 'disabled') {
    return null;
  }

  // 更新最后使用时间（异步不阻塞）
  db.update(apiTokens)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiTokens.id, row.tokenId))
    .run();

  return {
    id: row.userId,
    username: row.username,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    status: row.status,
    avatarUrl: row.avatarUrl,
    authSource: 'api_token',
  };
}

/** 解析请求中的认证用户 */
export async function resolveRequestUser(request: NextRequest): Promise<RequestUser | null> {
  const authMode = await getAuthMode();

  // 1. 尝试 Session Cookie（仅用户系统模式）
  if (authMode === 'user_system') {
    const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
    if (sessionToken) {
      const user = await resolveSessionUser(sessionToken);
      if (user) {
        return { ...user, authSource: 'session' };
      }
    }
  }

  // 2. 尝试 Bearer Token
  const authorization = request.headers.get('authorization');
  if (authorization) {
    const [scheme, token] = authorization.split(' ', 2);
    if (scheme?.toLowerCase() === 'bearer' && token) {
      const trimmedToken = token.trim();

      // 2a. API Token (cam_ 前缀，仅用户系统模式)
      if (authMode === 'user_system' && trimmedToken.startsWith('cam_')) {
        const apiUser = await resolveApiTokenUser(trimmedToken);
        if (apiUser) return apiUser;
      }

      // 2b. Legacy CAM_AUTH_TOKEN
      // 默认只在 legacy_token 模式可用。若确需 user_system 兼容，必须显式打开 CAM_ALLOW_LEGACY_TOKEN_IN_USER_SYSTEM。
      const configuredToken = getConfiguredAuthToken();
      const allowLegacyToken = authMode === 'legacy_token'
        || (authMode === 'user_system' && isLegacyTokenAllowedInUserSystemFromEnv());
      if (allowLegacyToken && configuredToken && trimmedToken === configuredToken) {
        return createLegacyVirtualUser('legacy_token');
      }
    }
  }

  // 3. Legacy Cookie（兼容旧模式）
  if (authMode === 'legacy_token') {
    const cookieToken = request.cookies.get(AUTH_COOKIE_NAME)?.value?.trim();
    const configuredToken = getConfiguredAuthToken();
    if (configuredToken && cookieToken === configuredToken) {
      return createLegacyVirtualUser('legacy_cookie');
    }
  }

  return null;
}
