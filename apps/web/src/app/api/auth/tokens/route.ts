// ============================================================
// API: /api/auth/tokens
// GET — 列出当前用户的 API Token
// POST — 创建新 API Token
// ============================================================

import { db } from '@/lib/db';
import { apiTokens } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { generateApiToken } from '@/lib/auth/api-token';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiSuccess } from '@/lib/http/api-response';
import { normalizeOptionalString } from '@/lib/validation/strings';

async function handleGet(request: AuthenticatedRequest) {
  const tokens = db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      permissions: apiTokens.permissions,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, request.user.id))
    .orderBy(desc(apiTokens.createdAt))
    .all();

  return apiSuccess(tokens);
}

async function handlePost(request: AuthenticatedRequest) {
  const body = await readJsonBodyAsRecord(request);
  const name = normalizeOptionalString(body.name) ?? '';

  if (!name || name.length < 1 || name.length > 64) {
    return apiBadRequest('Token 名称必须在 1-64 字符之间');
  }

  // 过期时间（可选，天数）
  const expiresInDays = typeof body.expiresInDays === 'number' ? body.expiresInDays : null;
  let expiresAt: string | null = null;
  if (expiresInDays && expiresInDays > 0) {
    const d = new Date();
    d.setDate(d.getDate() + expiresInDays);
    expiresAt = d.toISOString();
  }

  const { rawToken, tokenHash, tokenPrefix } = generateApiToken();

  db.insert(apiTokens)
    .values({
      userId: request.user.id,
      name,
      tokenHash,
      tokenPrefix,
      permissions: [],
      expiresAt,
    })
    .run();

  return apiSuccess({
    name,
    tokenPrefix,
    // 原始 token 仅此一次返回
    token: rawToken,
    expiresAt,
  });
}

export const GET = withAuth(handleGet);
export const POST = withAuth(handlePost);
