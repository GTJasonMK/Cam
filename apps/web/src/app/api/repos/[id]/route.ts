// ============================================================
// API: 单个 Repository
// GET    /api/repos/[id]   - 获取仓库详情
// PATCH  /api/repos/[id]   - 更新仓库配置
// DELETE /api/repos/[id]   - 删除仓库配置
// ============================================================

import { db } from '@/lib/db';
import { repositories } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { API_COMMON_MESSAGES, REPO_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { normalizeOptionalString } from '@/lib/validation/strings';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';
import { writeSystemEvent } from '@/lib/audit/system-event';

async function handleGet(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const rows = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);
    if (rows.length === 0) {
      return apiNotFound(REPO_MESSAGES.notFound(id));
    }

    return apiSuccess(rows[0]);
  } catch (err) {
    console.error('[API] 获取仓库失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.fetchFailed);
  }
}

async function handlePatch(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);
    if (existing.length === 0) {
      return apiNotFound(REPO_MESSAGES.notFound(id));
    }

    const body = await readJsonBodyAsRecord(request);
    const name = normalizeOptionalString(body.name);
    const repoUrl = normalizeOptionalString(body.repoUrl);
    const defaultBaseBranch = normalizeOptionalString(body.defaultBaseBranch);
    const hasDefaultWorkDir = Object.prototype.hasOwnProperty.call(body, 'defaultWorkDir');
    const defaultWorkDir = normalizeOptionalString(body.defaultWorkDir);

    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (name !== null) updateData.name = name;
    if (repoUrl !== null) updateData.repoUrl = repoUrl;
    if (defaultBaseBranch !== null) updateData.defaultBaseBranch = defaultBaseBranch;
    if (hasDefaultWorkDir) updateData.defaultWorkDir = defaultWorkDir;

    const result = await db
      .update(repositories)
      .set(updateData)
      .where(eq(repositories.id, id))
      .returning();

    await writeSystemEvent({
      type: 'repo.updated',
      payload: { repoId: id, changes: Object.keys(updateData).filter((k) => k !== 'updatedAt') },
    });

    return apiSuccess(result[0]);
  } catch (err) {
    console.error('[API] 更新仓库失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.updateFailed);
  }
}

async function handleDelete(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await db.delete(repositories).where(eq(repositories.id, id)).returning();
    if (result.length === 0) {
      return apiNotFound(REPO_MESSAGES.notFound(id));
    }

    await writeSystemEvent({
      type: 'repo.deleted',
      payload: { repoId: id, name: result[0].name, repoUrl: result[0].repoUrl },
    });

    return apiSuccess(null);
  } catch (err) {
    console.error('[API] 删除仓库失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.deleteFailed);
  }
}

export const GET = withAuth(handleGet, 'repo:read');
export const PATCH = withAuth(handlePatch, 'repo:update');
export const DELETE = withAuth(handleDelete, 'repo:delete');
