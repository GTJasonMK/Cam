// ============================================================
// API: /api/users
// GET  — 获取用户列表（admin）
// POST — 创建用户（admin）
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/password';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { parseCreateUserPayload } from '@/lib/validation/user-input';

async function handleGet() {
  try {
    const result = db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        email: users.email,
        role: users.role,
        status: users.status,
        avatarUrl: users.avatarUrl,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(users.createdAt)
      .all();

    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[API] 获取用户列表失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '获取用户列表失败' } },
      { status: 500 }
    );
  }
}

async function handlePost(request: AuthenticatedRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = parseCreateUserPayload(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.errorMessage } },
        { status: 400 }
      );
    }

    const { username, displayName, password, email, role } = parsed.data;

    // 检查用户名唯一
    const existing = db.select({ id: users.id }).from(users)
      .where(eq(users.username, username))
      .get();

    if (existing) {
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: '用户名已存在' } },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();

    const newUser = db
      .insert(users)
      .values({
        username,
        displayName,
        email,
        passwordHash,
        role,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return NextResponse.json({
      success: true,
      data: {
        id: newUser.id,
        username: newUser.username,
        displayName: newUser.displayName,
        email: newUser.email,
        role: newUser.role,
        status: newUser.status,
        createdAt: newUser.createdAt,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[API] 创建用户失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '创建用户失败' } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handleGet, 'user:read');
export const POST = withAuth(handlePost, 'user:create');
