// ============================================================
// API: Worker Runtime（终端执行单元状态）
// GET /api/workers/runtime - 返回当前用户的 Agent 会话与流水线运行状态
// ============================================================

import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';
import { isSqliteMissingSchemaError } from '@/lib/db/sqlite-errors';
import { apiInternalError, apiSuccess } from '@/lib/http/api-response';

async function handler(request: AuthenticatedRequest) {
  try {
    const userId = request.user.id;

    const agentSessions = agentSessionManager.listByUser(userId).map((session) => {
      const meta = agentSessionManager.getMeta(session.sessionId);
      return {
        sessionId: session.sessionId,
        agentDefinitionId: session.agentDefinitionId,
        agentDisplayName: session.agentDisplayName,
        prompt: session.prompt,
        status: session.status,
        exitCode: session.exitCode ?? null,
        elapsedMs: session.elapsedMs,
        workBranch: session.workBranch,
        repoUrl: session.repoUrl ?? null,
        createdAt: session.createdAt,
        lastActivityAt: session.lastActivityAt,
        taskId: meta?.taskId ?? null,
        pipelineId: meta?.pipelineId ?? null,
        repoPath: meta?.repoPath ?? null,
        mode: meta?.mode ?? null,
        claudeSessionId: meta?.claudeSessionId ?? null,
        managedSessionKey: meta?.managedSessionKey ?? null,
      };
    });

    const pipelines = agentSessionManager.listPipelinesByUser(userId).map((pipeline) => ({
      pipelineId: pipeline.pipelineId,
      status: pipeline.status,
      sessionPolicy: pipeline.sessionPolicy,
      currentStepIndex: pipeline.currentStepIndex,
      totalSteps: pipeline.steps.length,
      preparedSessions: pipeline.preparedSessions.map((session) => ({
        sessionKey: session.sessionKey,
        agentDefinitionId: session.agentDefinitionId,
        mode: session.mode,
        resumeSessionId: session.resumeSessionId ?? null,
        source: session.source,
        status: session.status,
        usageCount: session.usageCount,
        leasedByTaskId: session.leasedByTaskId ?? null,
      })),
      steps: pipeline.steps.map((step, stepIndex) => ({
        stepId: step.stepId,
        stepIndex,
        title: step.title,
        status: step.status,
        inputFiles: step.inputFiles ?? [],
        inputCondition: step.inputCondition ?? null,
        nodes: step.nodes.map((node, nodeIndex) => ({
          nodeIndex,
          title: node.title,
          status: node.status,
          sessionId: node.sessionId ?? null,
          taskId: node.taskId,
          agentDefinitionId: node.agentDefinitionId ?? null,
        })),
      })),
    }));

    let managedSessions: Array<{
      sessionKey: string;
      repoPath: string;
      agentDefinitionId: string;
      mode: 'resume' | 'continue';
      resumeSessionId: string | null;
      source: 'external' | 'managed';
      title: string | null;
      createdAt: string;
      updatedAt: string;
      leased: boolean;
    }> = [];
    try {
      managedSessions = (await agentSessionManager.listManagedPipelineSessions(userId)).map((session) => ({
        sessionKey: session.sessionKey,
        repoPath: session.repoPath,
        agentDefinitionId: session.agentDefinitionId,
        mode: session.mode,
        resumeSessionId: session.resumeSessionId ?? null,
        source: session.source,
        title: session.title ?? null,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        leased: session.leased,
      }));
    } catch (err) {
      if (!isSqliteMissingSchemaError(err, ['terminal_session_pool'])) {
        throw err;
      }
      console.warn('[API] 会话池表缺失，runtime 返回空 managedSessions');
      managedSessions = [];
    }

    const summary = {
      totalSessions: agentSessions.length,
      runningSessions: agentSessions.filter((item) => item.status === 'running').length,
      totalPipelines: pipelines.length,
      activePipelines: pipelines.filter((item) => item.status === 'running' || item.status === 'paused').length,
      runningPipelines: pipelines.filter((item) => item.status === 'running').length,
      pausedPipelines: pipelines.filter((item) => item.status === 'paused').length,
      managedSessionPoolSize: managedSessions.length,
    };

    return apiSuccess({
      summary,
      agentSessions,
      pipelines,
      managedSessions,
    });
  } catch (err) {
    console.error('[API] 获取终端执行单元状态失败:', err);
    return apiInternalError('获取终端执行单元状态失败');
  }
}

export const GET = withAuth(handler, 'terminal:access');
