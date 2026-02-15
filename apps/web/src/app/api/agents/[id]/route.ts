// ============================================================
// API: 单个 AgentDefinition 操作
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentDefinitions } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { AGENT_MESSAGES, API_COMMON_MESSAGES } from '@/lib/i18n/messages';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const result = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).limit(1);

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: AGENT_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result[0] });
  } catch (err) {
    console.error(`[API] 获取 Agent 定义 ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.queryFailed } },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.json();

    const result = await db
      .update(agentDefinitions)
      .set({
        displayName: body.displayName,
        description: body.description,
        icon: body.icon,
        dockerImage: body.dockerImage,
        command: body.command,
        args: body.args,
        requiredEnvVars: body.requiredEnvVars,
        capabilities: body.capabilities,
        defaultResourceLimits: body.defaultResourceLimits,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(agentDefinitions.id, id))
      .returning();

    if (result.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: AGENT_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: result[0] });
  } catch (err) {
    console.error(`[API] 更新 Agent 定义 ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.updateFailed } },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // 检查是否内置定义
    const existing = await db.select().from(agentDefinitions).where(eq(agentDefinitions.id, id)).limit(1);

    if (existing.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: AGENT_MESSAGES.notFound(id) } },
        { status: 404 }
      );
    }

    if (existing[0].builtIn) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: AGENT_MESSAGES.builtInDeleteForbidden } },
        { status: 403 }
      );
    }

    await db.delete(agentDefinitions).where(eq(agentDefinitions.id, id));
    return NextResponse.json({ success: true, data: null });
  } catch (err) {
    console.error(`[API] 删除 Agent 定义 ${id} 失败:`, err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.deleteFailed } },
      { status: 500 }
    );
  }
}
