// ============================================================
// API: 终端会话池（项目托管会话）
// GET    /api/terminal/session-pool?workDir=...&agentDefinitionId=...
// POST   /api/terminal/session-pool
// DELETE /api/terminal/session-pool
// ============================================================

import { NextResponse } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';
import {
  normalizeSessionPoolUpsertPayload,
  type SessionPoolUpsertPayload,
} from '@/lib/terminal/session-pool';
import { normalizeHostPathInput } from '@/lib/terminal/path-normalize';
import { isSqliteMissingSchemaError } from '@/lib/db/sqlite-errors';
import {
  apiBadRequest,
  apiConflict,
  apiError,
  apiInternalError,
  apiInvalidJson,
  apiSuccess,
} from '@/lib/http/api-response';
import { tryReadJsonBody } from '@/lib/http/read-json';
import { normalizeOptionalString } from '@/lib/validation/strings';

async function parseJsonOrBadRequest(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const parsed = await tryReadJsonBody<unknown>(request);
  if (!parsed.ok) {
    return { ok: false, response: apiInvalidJson() };
  }
  return { ok: true, body: parsed.value };
}

async function handleGet(request: AuthenticatedRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workDirRaw = normalizeOptionalString(searchParams.get('workDir')) ?? undefined;
    const workDir = workDirRaw ? normalizeHostPathInput(workDirRaw) : undefined;
    const agentDefinitionId = normalizeOptionalString(searchParams.get('agentDefinitionId')) ?? undefined;

    const data = await agentSessionManager.listManagedPipelineSessions(request.user.id, {
      ...(workDir ? { repoPath: workDir } : {}),
      ...(agentDefinitionId ? { agentDefinitionId } : {}),
    });

    return apiSuccess(data);
  } catch (err) {
    if (isSqliteMissingSchemaError(err, ['terminal_session_pool'])) {
      console.warn('[API] 会话池表缺失，GET 降级为空列表');
      return NextResponse.json({
        success: true,
        data: [],
        meta: { degraded: true, reason: 'missing-table:terminal_session_pool' },
      });
    }
    console.error('[API] 获取会话池失败:', err);
    return apiInternalError('获取会话池失败');
  }
}

async function handlePost(request: AuthenticatedRequest) {
  const parsedBody = await parseJsonOrBadRequest(request);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.body;

  let normalized: ReturnType<typeof normalizeSessionPoolUpsertPayload>;
  try {
    normalized = normalizeSessionPoolUpsertPayload((body ?? {}) as SessionPoolUpsertPayload);
  } catch (err) {
    return apiBadRequest((err as Error).message);
  }

  try {
    const data = await agentSessionManager.upsertManagedPipelineSessions(request.user.id, normalized);
    return apiSuccess(data);
  } catch (err) {
    if (isSqliteMissingSchemaError(err, ['terminal_session_pool'])) {
      return apiError('SESSION_POOL_NOT_READY', '会话池尚未初始化，请先完成数据库迁移后重试', {
        status: 503,
      });
    }
    console.error('[API] 写入会话池失败:', err);
    return apiInternalError('写入会话池失败');
  }
}

async function handleDelete(request: AuthenticatedRequest) {
  const parsedBody = await parseJsonOrBadRequest(request);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }
  const body = parsedBody.body;

  const parsed = (body ?? {}) as {
    sessionKey?: string;
    workDir?: string;
    agentDefinitionId?: string;
    clearAll?: boolean;
  };

  if (parsed.clearAll) {
    try {
      const workDirRaw = normalizeOptionalString(parsed.workDir);
      const workDir = workDirRaw ? normalizeHostPathInput(workDirRaw) : undefined;
      const agentDefinitionId = normalizeOptionalString(parsed.agentDefinitionId);
      const removed = await agentSessionManager.clearManagedPipelineSessions(request.user.id, {
        ...(workDir ? { repoPath: workDir } : {}),
        ...(agentDefinitionId ? { agentDefinitionId } : {}),
      });
      return apiSuccess({ removed });
    } catch (err) {
      if (isSqliteMissingSchemaError(err, ['terminal_session_pool'])) {
        return apiSuccess({ removed: 0 });
      }
      if (err instanceof Error && err.message.includes('占用')) {
        return apiConflict(err.message);
      }
      console.error('[API] 清空会话池失败:', err);
      return apiInternalError('清空会话池失败');
    }
  }

  const sessionKey = normalizeOptionalString(parsed.sessionKey);
  if (!sessionKey) {
    return apiBadRequest('sessionKey 不能为空');
  }

  try {
    const removed = await agentSessionManager.removeManagedPipelineSession(request.user.id, sessionKey);
    return apiSuccess({ removed });
  } catch (err) {
    if (isSqliteMissingSchemaError(err, ['terminal_session_pool'])) {
      return apiSuccess({ removed: false });
    }
    if (err instanceof Error && err.message.includes('占用')) {
      return apiConflict(err.message);
    }
    console.error('[API] 删除会话池条目失败:', err);
    return apiInternalError('删除会话池条目失败');
  }
}

export const GET = withAuth(handleGet, 'terminal:access');
export const POST = withAuth(handlePost, 'terminal:access');
export const DELETE = withAuth(handleDelete, 'terminal:access');
