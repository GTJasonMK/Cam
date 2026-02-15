// ============================================================
// API: Repositories
// GET  /api/repos  - 获取仓库列表
// POST /api/repos  - 创建仓库配置（Repo Preset）
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { repositories, systemEvents } from '@/lib/db/schema';
import { API_COMMON_MESSAGES, REPO_MESSAGES } from '@/lib/i18n/messages';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();

    // 简单实现：不做模糊查询，仅支持前端拉全量后过滤；这里保留 q 方便后续扩展
    const rows = await db.select().from(repositories).orderBy(repositories.createdAt);

    const data = q
      ? rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()) || r.repoUrl.toLowerCase().includes(q.toLowerCase()))
      : rows;

    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error('[API] 获取仓库列表失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.listFailed } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const repoUrl = typeof body.repoUrl === 'string' ? body.repoUrl.trim() : '';
    const defaultBaseBranch = typeof body.defaultBaseBranch === 'string' ? body.defaultBaseBranch.trim() : '';
    const defaultWorkDir = typeof body.defaultWorkDir === 'string' ? body.defaultWorkDir.trim() : '';

    if (!name || !repoUrl) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: REPO_MESSAGES.missingRequiredFields } },
        { status: 400 }
      );
    }

    const result = await db
      .insert(repositories)
      .values({
        name,
        repoUrl,
        defaultBaseBranch: defaultBaseBranch || 'main',
        defaultWorkDir: defaultWorkDir || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();

    await db.insert(systemEvents).values({
      type: 'repo.created',
      payload: { repoId: result[0].id, name, repoUrl },
    });

    return NextResponse.json({ success: true, data: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[API] 创建仓库失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.createFailed } },
      { status: 500 }
    );
  }
}
