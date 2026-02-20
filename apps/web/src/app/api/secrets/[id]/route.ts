// ============================================================
// API: 单个 Secret 操作
// GET    /api/secrets/[id]   - 获取元信息（不返回明文）
// PUT    /api/secrets/[id]   - 更新（可更新 value / 作用域）
// DELETE /api/secrets/[id]   - 删除
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
  if (value === null) return null;
  const v = normalizeString(value);
  return v.length > 0 ? v : null;
}

async function handleGet(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const row = await db.select().from(secrets).where(eq(secrets.id, id)).limit(1);
    if (row.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: SECRET_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    const r = row[0];
    return NextResponse.json({
      success: true,
      data: {
        id: r.id,
        name: r.name,
        repositoryId: r.repositoryId,
        agentDefinitionId: r.agentDefinitionId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      },
    });
  } catch (err) {
    console.error(`[API] 获取 secret ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.queryFailed } },
      { status: 500 }
    );
  }
}

async function handlePut(request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db.select().from(secrets).where(eq(secrets.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: SECRET_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updateData: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = normalizeString(body.name);
      if (!name) {
        return NextResponse.json(
          { success: false, error: { code: 'INVALID_INPUT', message: SECRET_MESSAGES.nameRequired } },
          { status: 400 }
        );
      }
      updateData.name = name;
    }

    if (body.repositoryId !== undefined) {
      const repositoryId = normalizeOptionalId(body.repositoryId);
      if (repositoryId) {
        const repo = await db.select({ id: repositories.id }).from(repositories).where(eq(repositories.id, repositoryId)).limit(1);
        if (repo.length === 0) {
          return NextResponse.json(
            { success: false, error: { code: 'NOT_FOUND', message: REPO_MESSAGES.notFound(repositoryId) } },
            { status: 404 }
          );
        }
      }
      updateData.repositoryId = repositoryId;
    }

    if (body.agentDefinitionId !== undefined) {
      const agentDefinitionId = normalizeOptionalId(body.agentDefinitionId);
      if (agentDefinitionId) {
        const agent = await db.select({ id: agentDefinitions.id }).from(agentDefinitions).where(eq(agentDefinitions.id, agentDefinitionId)).limit(1);
        if (agent.length === 0) {
          return NextResponse.json(
            { success: false, error: { code: 'NOT_FOUND', message: AGENT_MESSAGES.notFoundDefinition(agentDefinitionId) } },
            { status: 404 }
          );
        }
      }
      updateData.agentDefinitionId = agentDefinitionId;
    }

    if (body.value !== undefined) {
      const value = typeof body.value === 'string' ? body.value : '';
      if (value.trim().length === 0) {
        return NextResponse.json(
          { success: false, error: { code: 'INVALID_INPUT', message: SECRET_MESSAGES.valueRequired } },
          { status: 400 }
        );
      }
      if (!isMasterKeyPresent()) {
        return NextResponse.json(
          { success: false, error: { code: 'MISSING_MASTER_KEY', message: SECRET_MESSAGES.missingMasterKeyOnUpdate } },
          { status: 400 }
        );
      }
      updateData.valueEncrypted = encryptSecretValue(value);
    }

    updateData.updatedAt = new Date().toISOString();

    let updated: typeof secrets.$inferSelect;
    try {
      const result = await db.update(secrets).set(updateData).where(eq(secrets.id, id)).returning();
      updated = result[0];
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('unique') || message.toLowerCase().includes('constraint')) {
        return NextResponse.json(
          { success: false, error: { code: 'CONFLICT', message: SECRET_MESSAGES.duplicateOnUpdate } },
          { status: 409 }
        );
      }
      throw err;
    }

    await db.insert(systemEvents).values({
      type: 'secret.updated',
      payload: { secretId: updated.id, name: updated.name, repositoryId: updated.repositoryId, agentDefinitionId: updated.agentDefinitionId },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        repositoryId: updated.repositoryId,
        agentDefinitionId: updated.agentDefinitionId,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    console.error(`[API] 更新 secret ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.updateFailed } },
      { status: 500 }
    );
  }
}

async function handleDelete(_request: AuthenticatedRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db.select().from(secrets).where(eq(secrets.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: SECRET_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    await db.delete(secrets).where(eq(secrets.id, id));

    await db.insert(systemEvents).values({
      type: 'secret.deleted',
      payload: { secretId: id, name: existing[0].name, repositoryId: existing[0].repositoryId, agentDefinitionId: existing[0].agentDefinitionId },
    });

    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    console.error(`[API] 删除 secret ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.deleteFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handleGet, 'secret:read');
export const PUT = withAuth(handlePut, 'secret:update');
export const DELETE = withAuth(handleDelete, 'secret:delete');
