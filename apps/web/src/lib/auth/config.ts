// ============================================================
// 认证模式检测
// 优先级：users > CAM_AUTH_TOKEN > CAM_ALLOW_ANONYMOUS_ACCESS > setup_required
// ============================================================

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { getConfiguredAuthToken } from './constants';

export type AuthMode = 'user_system' | 'legacy_token' | 'setup_required' | 'none';

// 进程级缓存，避免每次请求查库
let cachedMode: AuthMode | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000; // 30 秒缓存

function isAnonymousAccessAllowed(): boolean {
  const raw = (process.env.CAM_ALLOW_ANONYMOUS_ACCESS || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** 清除认证模式缓存（创建首个用户后调用） */
export function invalidateAuthModeCache(): void {
  cachedMode = null;
  cacheExpiry = 0;
}

/** 获取当前认证模式 */
export async function getAuthMode(): Promise<AuthMode> {
  const now = Date.now();
  if (cachedMode !== null && now < cacheExpiry) {
    return cachedMode;
  }

  const result = db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .get();

  const userCount = result?.count ?? 0;

  let mode: AuthMode;
  if (userCount > 0) {
    mode = 'user_system';
  } else if (getConfiguredAuthToken()) {
    mode = 'legacy_token';
  } else if (isAnonymousAccessAllowed()) {
    mode = 'none';
  } else {
    // 默认安全：未初始化时必须先创建管理员账户
    mode = 'setup_required';
  }

  cachedMode = mode;
  cacheExpiry = now + CACHE_TTL_MS;
  return mode;
}

/** 同步版本（使用缓存值，无缓存时返回 null） */
export function getAuthModeCached(): AuthMode | null {
  if (cachedMode !== null && Date.now() < cacheExpiry) {
    return cachedMode;
  }
  return null;
}
