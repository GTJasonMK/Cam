// ============================================================
// 认证模式检测
// 根据 users 表是否有记录判定系统运行模式
// ============================================================

import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { getConfiguredAuthToken } from './constants';

export type AuthMode = 'user_system' | 'legacy_token' | 'none';

// 进程级缓存，避免每次请求查库
let cachedMode: AuthMode | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 30_000; // 30 秒缓存

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
  } else {
    mode = 'none';
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
