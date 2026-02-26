// ============================================================
// API: /api/users/[id]
// GET    — 获取用户详情
// PATCH  — 更新用户信息
// DELETE — 删除用户
// ============================================================

import { db } from '@/lib/db';
import { users, sessions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { parseUpdateUserPayload } from '@/lib/validation/user-input';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiError, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';

type RouteContext = { params: Promise<Record<string, string>> };

async function handleGet(request: AuthenticatedRequest, context: RouteContext) {
  try {
    const params = await context.params;
    const id = params.id;
    const user = db
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
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .get();

    if (!user) {
      return apiNotFound(`用户 ${id} 不存在`);
    }

    return apiSuccess(user);
  } catch (err) {
    console.error('[API] 获取用户详情失败:', err);
    return apiInternalError('获取用户详情失败');
  }
}

async function handlePatch(request: AuthenticatedRequest, context: RouteContext) {
  try {
    const params = await context.params;
    const id = params.id;

    const existing = db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
    if (!existing) {
      return apiNotFound(`用户 ${id} 不存在`);
    }

    const body = await readJsonBodyAsRecord(request);
    const parsed = parseUpdateUserPayload(body);
    if (!parsed.success) {
      return apiBadRequest(parsed.errorMessage);
    }

    const updated = db
      .update(users)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id))
      .returning()
      .get();

    // 如果用户被禁用，清除所有 Session
    if (parsed.data.status === 'disabled') {
      db.delete(sessions).where(eq(sessions.userId, id)).run();
    }

    return apiSuccess({
      id: updated.id,
      username: updated.username,
      displayName: updated.displayName,
      email: updated.email,
      role: updated.role,
      status: updated.status,
      avatarUrl: updated.avatarUrl,
    });
  } catch (err) {
    console.error('[API] 更新用户失败:', err);
    return apiInternalError('更新用户失败');
  }
}

async function handleDelete(request: AuthenticatedRequest, context: RouteContext) {
  try {
    const params = await context.params;
    const id = params.id;

    // 禁止删除自己
    if (request.user.id === id) {
      return apiError('FORBIDDEN', '不能删除自己的账户', { status: 403 });
    }

    const existing = db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
    if (!existing) {
      return apiNotFound(`用户 ${id} 不存在`);
    }

    // CASCADE 会自动删除关联的 sessions / oauth_accounts / api_tokens
    db.delete(users).where(eq(users.id, id)).run();

    return apiSuccess(null);
  } catch (err) {
    console.error('[API] 删除用户失败:', err);
    return apiInternalError('删除用户失败');
  }
}

export const GET = withAuth(handleGet, 'user:read');
export const PATCH = withAuth(handlePatch, 'user:update');
export const DELETE = withAuth(handleDelete, 'user:delete');
