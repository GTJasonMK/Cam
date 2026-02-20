// ============================================================
// API: /api/auth/tokens/[id]
// DELETE — 删除指定 API Token（仅限所有者）
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiTokens } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

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
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Token 不存在或无权删除' } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}

export const DELETE = withAuth(handleDelete);
