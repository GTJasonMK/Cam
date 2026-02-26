// ============================================================
// API: Secrets（敏感配置）
// GET  /api/secrets  - 列表（不返回明文）
// POST /api/secrets  - 创建（写入加密值）
// ============================================================

import { db } from '@/lib/db';
import { secrets, repositories, agentDefinitions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptSecretValue, isMasterKeyPresent } from '@/lib/secrets/crypto';
import { AGENT_MESSAGES, API_COMMON_MESSAGES, REPO_MESSAGES, SECRET_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { normalizeOptionalString, normalizeTrimmedString } from '@/lib/validation/strings';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiCreated, apiError, apiInternalError, apiNotFound, apiSuccess } from '@/lib/http/api-response';
import { writeSystemEvent } from '@/lib/audit/system-event';

async function handleGet(request: AuthenticatedRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = normalizeTrimmedString(searchParams.get('name'));
    const repositoryId = normalizeOptionalString(searchParams.get('repositoryId'));
    const agentDefinitionId = normalizeOptionalString(searchParams.get('agentDefinitionId'));

    let rows = await db.select().from(secrets).orderBy(secrets.updatedAt);

    if (name) rows = rows.filter((r) => r.name === name);
    if (repositoryId) rows = rows.filter((r) => r.repositoryId === repositoryId);
    if (agentDefinitionId) rows = rows.filter((r) => r.agentDefinitionId === agentDefinitionId);

    // 不返回 valueEncrypted 以降低误用风险
    const data = rows.map((r) => ({
      id: r.id,
      name: r.name,
      repositoryId: r.repositoryId,
      agentDefinitionId: r.agentDefinitionId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return apiSuccess(data);
  } catch (err) {
    console.error('[API] 获取 secrets 列表失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.listFailed);
  }
}

async function handlePost(request: AuthenticatedRequest) {
  try {
    const body = await readJsonBodyAsRecord(request);

    const name = normalizeTrimmedString(body.name);
    const value = normalizeOptionalString(body.value);
    const repositoryId = normalizeOptionalString(body.repositoryId);
    const agentDefinitionId = normalizeOptionalString(body.agentDefinitionId);

    if (!name || !value) {
      return apiBadRequest(SECRET_MESSAGES.missingRequiredFields);
    }

    if (!isMasterKeyPresent()) {
      return apiError('MISSING_MASTER_KEY', SECRET_MESSAGES.missingMasterKeyOnCreate, { status: 400 });
    }

    if (repositoryId) {
      const repo = await db.select({ id: repositories.id }).from(repositories).where(eq(repositories.id, repositoryId)).limit(1);
      if (repo.length === 0) {
        return apiNotFound(REPO_MESSAGES.notFound(repositoryId));
      }
    }

    if (agentDefinitionId) {
      const agent = await db.select({ id: agentDefinitions.id }).from(agentDefinitions).where(eq(agentDefinitions.id, agentDefinitionId)).limit(1);
      if (agent.length === 0) {
        return apiNotFound(AGENT_MESSAGES.notFoundDefinition(agentDefinitionId));
      }
    }

    const encrypted = encryptSecretValue(value);

    let created: typeof secrets.$inferSelect;
    try {
      const result = await db
        .insert(secrets)
        .values({
          name,
          repositoryId: repositoryId || null,
          agentDefinitionId: agentDefinitionId || null,
          valueEncrypted: encrypted,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .returning();
      created = result[0];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('unique') || message.toLowerCase().includes('constraint')) {
        return apiError('CONFLICT', SECRET_MESSAGES.duplicateOnCreate, { status: 409 });
      }
      throw err;
    }

    await writeSystemEvent({
      type: 'secret.created',
      payload: {
        secretId: created.id,
        name: created.name,
        repositoryId: created.repositoryId,
        agentDefinitionId: created.agentDefinitionId,
      },
    });

    return apiCreated({
      id: created.id,
      name: created.name,
      repositoryId: created.repositoryId,
      agentDefinitionId: created.agentDefinitionId,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
  } catch (err) {
    console.error('[API] 创建 secret 失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.createFailed);
  }
}

export const GET = withAuth(handleGet, 'secret:read');
export const POST = withAuth(handlePost, 'secret:create');
