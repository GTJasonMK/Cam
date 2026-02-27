// ============================================================
// API: AgentDefinition CRUD
// GET    /api/agents         - 获取所有 Agent 定义
// POST   /api/agents         - 创建新 Agent 定义
// GET    /api/agents/[id]    - 获取单个 Agent 定义
// PUT    /api/agents/[id]    - 更新 Agent 定义
// DELETE /api/agents/[id]    - 删除 Agent 定义
// ============================================================

import { db } from '@/lib/db';
import { agentDefinitions } from '@/lib/db/schema';
import { AGENT_MESSAGES, API_COMMON_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { apiBadRequest, apiCreated, apiInternalError, apiSuccess } from '@/lib/http/api-response';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { normalizeAgentDefinitionForExecution } from '@/lib/agents/normalize-agent-definition';

async function handleGet() {
  try {
    const result = await db.select().from(agentDefinitions).orderBy(agentDefinitions.createdAt);
    return apiSuccess(result.map((item) => normalizeAgentDefinitionForExecution(item)));
  } catch (err) {
    console.error('[API] 获取 Agent 定义列表失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.listFailed);
  }
}

async function handlePost(request: AuthenticatedRequest) {
  try {
    const body = await readJsonBodyAsRecord(request);
    const payload = body as Partial<typeof agentDefinitions.$inferInsert> & {
      id?: string;
      displayName?: string;
      dockerImage?: string;
      command?: string;
    };

    // 基本校验
    if (!payload.id || !payload.displayName || !payload.dockerImage || !payload.command) {
      return apiBadRequest(AGENT_MESSAGES.missingRequiredFields);
    }

    const result = await db
      .insert(agentDefinitions)
      .values({
        id: payload.id,
        displayName: payload.displayName,
        description: payload.description || null,
        icon: payload.icon || null,
        dockerImage: payload.dockerImage,
        command: payload.command,
        args: payload.args || [],
        requiredEnvVars: payload.requiredEnvVars || [],
        capabilities: payload.capabilities || {
          nonInteractive: true,
          autoGitCommit: false,
          outputSummary: false,
          promptFromFile: false,
        },
        defaultResourceLimits: payload.defaultResourceLimits || {},
        builtIn: false,
        runtime: payload.runtime || 'native',
      })
      .returning();

    return apiCreated(result[0]);
  } catch (err) {
    console.error('[API] 创建 Agent 定义失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.createFailed);
  }
}

export const GET = withAuth(handleGet, 'agent:read');
export const POST = withAuth(handlePost, 'agent:create');
