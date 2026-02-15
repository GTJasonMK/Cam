// ============================================================
// API: 单个 Repository
// GET    /api/repos/[id]   - 获取仓库详情
// PATCH  /api/repos/[id]   - 更新仓库配置
// DELETE /api/repos/[id]   - 删除仓库配置
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { repositories, systemEvents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { API_COMMON_MESSAGES, REPO_MESSAGES } from '@/lib/i18n/messages';

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const rows = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);
    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: REPO_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[API] 获取仓库失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.fetchFailed } },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const existing = await db.select().from(repositories).where(eq(repositories.id, id)).limit(1);
    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: REPO_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = normalizeString(body.name);
    const repoUrl = normalizeString(body.repoUrl);
    const defaultBaseBranch = normalizeString(body.defaultBaseBranch);
    const defaultWorkDir = typeof body.defaultWorkDir === 'string' ? body.defaultWorkDir.trim() : null;

    const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (name !== null) updateData.name = name;
    if (repoUrl !== null) updateData.repoUrl = repoUrl;
    if (defaultBaseBranch !== null) updateData.defaultBaseBranch = defaultBaseBranch;
    if (defaultWorkDir !== null) updateData.defaultWorkDir = defaultWorkDir || null;

    const result = await db
      .update(repositories)
      .set(updateData)
      .where(eq(repositories.id, id))
      .returning();

    await db.insert(systemEvents).values({
      type: 'repo.updated',
      payload: { repoId: id, changes: Object.keys(updateData).filter((k) => k !== 'updatedAt') },
    });

    return NextResponse.json({ success: true, data: result[0] });
  } catch (err) {
    console.error('[API] 更新仓库失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.updateFailed } },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await db.delete(repositories).where(eq(repositories.id, id)).returning();
    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: REPO_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    await db.insert(systemEvents).values({
      type: 'repo.deleted',
      payload: { repoId: id, name: result[0].name, repoUrl: result[0].repoUrl },
    });

    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    console.error('[API] 删除仓库失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.deleteFailed } },
      { status: 500 }
    );
  }
}
