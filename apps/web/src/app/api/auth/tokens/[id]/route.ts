// ============================================================
// API: /api/auth/tokens/[id]
// DELETE — 删除指定 API Token（仅限所有者）
// ============================================================

import { db } from '@/lib/db';
import { apiTokens } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { apiNotFound, apiSuccess } from '@/lib/http/api-response';

type RouteContext = { params: Promise<Record<string, string>> };

async function handleDelete(request: AuthenticatedRequest, context: RouteContext) {
  const params = await context.params;
  const tokenId = params.id;

  // 只能删除自己的 Token
  const result = db
    .delete(apiTokens)
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.userId, request.user.id),
      )
    )
    .run();

  if (result.changes === 0) {
    return apiNotFound('Token 不存在或无权删除');
  }

  return apiSuccess(null);
}

export const DELETE = withAuth(handleDelete);
