// ============================================================
// API: /api/auth/setup
// POST — 创建首个 admin 用户（仅空库时可用）
// ============================================================

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/password';
import { createSession, getSessionCookieMaxAgeSeconds, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { buildAuthCookieOptions } from '@/lib/auth/cookie-options';
import { invalidateAuthModeCache } from '@/lib/auth/config';
import { parseSetupPayload } from '@/lib/validation/user-input';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { getRequestClientInfo } from '@/lib/auth/request-client';
import { apiBadRequest, apiConflict, apiCreated, apiInternalError } from '@/lib/http/api-response';

const ALREADY_SETUP_ERROR = 'ALREADY_SETUP';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBodyAsRecord(request);
    const parsed = parseSetupPayload(body);
    if (!parsed.success) {
      return apiBadRequest(parsed.errorMessage);
    }

    const { username, displayName, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();

    let newUser: typeof users.$inferSelect;
    try {
      newUser = db.transaction((tx) => {
        // 原子检查 + 插入，避免并发 setup 产生多个首个管理员
        const result = tx
          .select({ count: sql<number>`count(*)` })
          .from(users)
          .get();
        if ((result?.count ?? 0) > 0) {
          throw new Error(ALREADY_SETUP_ERROR);
        }

        return tx
          .insert(users)
          .values({
            username,
            displayName,
            passwordHash,
            role: 'admin',
            status: 'active',
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
      });
    } catch (err) {
      if (err instanceof Error && err.message === ALREADY_SETUP_ERROR) {
        return apiConflict('系统已初始化，不能重复设置', {
          code: 'ALREADY_SETUP',
        });
      }
      throw err;
    }

    // 刷新认证模式缓存
    invalidateAuthModeCache();

    // 自动创建 Session
    const { ipAddress, userAgent } = getRequestClientInfo(request);

    const token = await createSession({
      userId: newUser.id,
      ipAddress,
      userAgent,
    });

    const response = apiCreated({
      id: newUser.id,
      username: newUser.username,
      displayName: newUser.displayName,
      role: newUser.role,
    });

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      ...buildAuthCookieOptions({ maxAge: getSessionCookieMaxAgeSeconds() }),
    });

    return response;
  } catch (err) {
    console.error('[API] 初始化设置失败:', err);
    return apiInternalError('初始化设置失败');
  }
}
