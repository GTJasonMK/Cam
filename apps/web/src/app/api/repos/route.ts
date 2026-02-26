// ============================================================
// API: Repositories
// GET  /api/repos  - 获取仓库列表
// POST /api/repos  - 创建仓库配置（Repo Preset）
// ============================================================

import { db } from '@/lib/db';
import { repositories } from '@/lib/db/schema';
import { API_COMMON_MESSAGES, REPO_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiCreated, apiInternalError, apiSuccess } from '@/lib/http/api-response';
import { writeSystemEvent } from '@/lib/audit/system-event';
import { normalizeOptionalString } from '@/lib/validation/strings';

async function handleGet(request: AuthenticatedRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = normalizeOptionalString(searchParams.get('q')) ?? '';

    // 简单实现：不做模糊查询，仅支持前端拉全量后过滤；这里保留 q 方便后续扩展
    const rows = await db.select().from(repositories).orderBy(repositories.createdAt);

    const data = q
      ? rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || r.repoUrl.toLowerCase().includes(q.toLowerCase()))
      : rows;

    return apiSuccess(data);
  } catch (err) {
    console.error('[API] 获取仓库列表失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.listFailed);
  }
}

async function handlePost(request: AuthenticatedRequest) {
  try {
    const body = await readJsonBodyAsRecord(request);
    const name = normalizeOptionalString(body.name) ?? '';
    const repoUrl = normalizeOptionalString(body.repoUrl) ?? '';
    const defaultBaseBranch = normalizeOptionalString(body.defaultBaseBranch) ?? '';
    const defaultWorkDir = normalizeOptionalString(body.defaultWorkDir);

    if (!name || !repoUrl) {
      return apiBadRequest(REPO_MESSAGES.missingRequiredFields);
    }

    const result = await db
      .insert(repositories)
      .values({
        name,
        repoUrl,
        defaultBaseBranch: defaultBaseBranch || 'main',
        defaultWorkDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();

    await writeSystemEvent({
      type: 'repo.created',
      payload: { repoId: result[0].id, name, repoUrl },
    });

    return apiCreated(result[0]);
  } catch (err) {
    console.error('[API] 创建仓库失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.createFailed);
  }
}

export const GET = withAuth(handleGet, 'repo:read');
export const POST = withAuth(handlePost, 'repo:create');
