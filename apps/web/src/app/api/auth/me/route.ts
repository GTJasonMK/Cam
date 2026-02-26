// ============================================================
// API: /api/auth/me
// GET — 返回当前认证用户信息
// ============================================================

import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { apiSuccess } from '@/lib/http/api-response';

async function handler(request: AuthenticatedRequest) {
  const { user } = request;

  let hasPassword = false;
  if (!user.id.startsWith('__')) {
    const row = db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, user.id))
      .get();
    hasPassword = Boolean(row?.passwordHash);
  }

  return apiSuccess({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    avatarUrl: user.avatarUrl,
    authSource: user.authSource,
    hasPassword,
  });
}

export const GET = withAuth(handler);
