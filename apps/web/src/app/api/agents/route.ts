// ============================================================
// API: AgentDefinition CRUD
// GET    /api/agents         - 获取所有 Agent 定义
// POST   /api/agents         - 创建新 Agent 定义
// GET    /api/agents/[id]    - 获取单个 Agent 定义
// PUT    /api/agents/[id]    - 更新 Agent 定义
// DELETE /api/agents/[id]    - 删除 Agent 定义
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentDefinitions } from '@/lib/db/schema';
import { AGENT_MESSAGES, API_COMMON_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

async function handleGet() {
  try {
    const result = await db.select().from(agentDefinitions).orderBy(agentDefinitions.createdAt);
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    console.error('[API] 获取 Agent 定义列表失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.listFailed } },
      { status: 500 }
    );
  }
}

async function handlePost(request: AuthenticatedRequest) {
  try {
    const body = await request.json();

    // 基本校验
    if (!body.id || !body.displayName || !body.dockerImage || !body.command) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: AGENT_MESSAGES.missingRequiredFields } },
        { status: 400 }
      );
    }

    const result = await db
      .insert(agentDefinitions)
      .values({
        id: body.id,
        displayName: body.displayName,
        description: body.description || null,
        icon: body.icon || null,
        dockerImage: body.dockerImage,
        command: body.command,
        args: body.args || [],
        requiredEnvVars: body.requiredEnvVars || [],
        capabilities: body.capabilities || {
          nonInteractive: true,
          autoGitCommit: false,
          outputSummary: false,
          promptFromFile: false,
        },
        defaultResourceLimits: body.defaultResourceLimits || {},
        builtIn: false,
        runtime: body.runtime || 'native',
      })
      .returning();

    return NextResponse.json({ success: true, data: result[0] }, { status: 201 });
  } catch (err) {
    console.error('[API] 创建 Agent 定义失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.createFailed } },
      { status: 500 }
    );
  }
}

export const GET = withAuth(handleGet, 'agent:read');
export const POST = withAuth(handlePost, 'agent:create');
