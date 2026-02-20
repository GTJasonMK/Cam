// ============================================================
// API: Secrets（敏感配置）
// GET  /api/secrets  - 列表（不返回明文）
// POST /api/secrets  - 创建（写入加密值）
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { secrets, systemEvents, repositories, agentDefinitions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptSecretValue, isMasterKeyPresent } from '@/lib/secrets/crypto';
import { AGENT_MESSAGES, API_COMMON_MESSAGES, REPO_MESSAGES, SECRET_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalId(value: unknown): string | null {
  const v = normalizeString(value);
  return v.length > 0 ? v : null;
}

async function handleGet(request: AuthenticatedRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const name = normalizeString(searchParams.get('name'));
    const repositoryId = normalizeOptionalId(searchParams.get('repositoryId'));
    const agentDefinitionId = normalizeOptionalId(searchParams.get('agentDefinitionId'));

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

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[API] 获取 secrets 列表失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.listFailed } },
      { status: 500 }
    );
  }
}

async function handlePost(request: AuthenticatedRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const name = normalizeString(body.name);
    const value = typeof body.value === 'string' ? body.value : '';
    const repositoryId = normalizeOptionalId(body.repositoryId);
    const agentDefinitionId = normalizeOptionalId(body.agentDefinitionId);

    if (!name || value.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: SECRET_MESSAGES.missingRequiredFields } },
        { status: 400 }
      );
    }

    if (!isMasterKeyPresent()) {
      return NextResponse.json(
        { success: false, error: { code: 'MISSING_MASTER_KEY', message: SECRET_MESSAGES.missingMasterKeyOnCreate } },
        { status: 400 }
      );
    }

    if (repositoryId) {
      const repo = await db.select({ id: repositories.id }).from(repositories).where(eq(repositories.id, repositoryId)).limit(1);
      if (repo.length === 0) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: REPO_MESSAGES.notFound(repositoryId) } },
          { status: 404 }
        );
      }
    }

    if (agentDefinitionId) {
      const agent = await db.select({ id: agentDefinitions.id }).from(agentDefinitions).where(eq(agentDefinitions.id, agentDefinitionId)).limit(1);
      if (agent.length === 0) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: AGENT_MESSAGES.notFoundDefinition(agentDefinitionId) } },
          { status: 404 }
        );
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
        return NextResponse.json(
          { success: false, error: { code: 'CONFLICT', message: SECRET_MESSAGES.duplicateOnCreate } },
          { status: 409 }
        );
      }
      throw err;
    }

    await db.insert(systemEvents).values({
      type: 'secret.created',
      payload: { secretId: created.id, name: created.name, repositoryId: created.repositoryId, agentDefinitionId: created.agentDefinitionId },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: created.id,
          name: created.name,
          repositoryId: created.repositoryId,
          agentDefinitionId: created.agentDefinitionId,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    console.error('[API] 创建 secret 失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.createFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handleGet, 'secret:read');
export const POST = withAuth(handlePost, 'secret:create');
