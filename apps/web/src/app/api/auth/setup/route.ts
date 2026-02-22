// ============================================================
// API: /api/auth/setup
// POST — 创建首个 admin 用户（仅空库时可用）
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/password';
import { createSession, getSessionCookieMaxAgeSeconds, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { buildAuthCookieOptions } from '@/lib/auth/cookie-options';
import { invalidateAuthModeCache } from '@/lib/auth/config';
import { parseSetupPayload } from '@/lib/validation/user-input';

export async function POST(request: NextRequest) {
  try {
    // 检查是否已有用户
    const result = db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .get();

    if ((result?.count ?? 0) > 0) {
      return NextResponse.json(
        { success: false, error: { code: 'ALREADY_SETUP', message: '系统已初始化，不能重复设置' } },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = parseSetupPayload(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.errorMessage } },
        { status: 400 }
      );
    }

    const { username, displayName, password } = parsed.data;
    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();

    const newUser = db
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

    // 刷新认证模式缓存
    invalidateAuthModeCache();

    // 自动创建 Session
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const userAgent = request.headers.get('user-agent') || undefined;

    const token = await createSession({
      userId: newUser.id,
      ipAddress,
      userAgent,
    });

    const response = NextResponse.json({
      success: true,
      data: {
        id: newUser.id,
        username: newUser.username,
        displayName: newUser.displayName,
        role: newUser.role,
      },
    }, { status: 201 });

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      ...buildAuthCookieOptions({ maxAge: getSessionCookieMaxAgeSeconds() }),
    });

    return response;
  } catch (err) {
    console.error('[API] 初始化设置失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '初始化设置失败' } },
      { status: 500 }
    );
  }
}
