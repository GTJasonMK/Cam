// ============================================================
// API: Worker Runtime（终端执行单元状态）
// GET /api/workers/runtime - 返回当前用户的 Agent 会话与流水线运行状态
// ============================================================

import { NextResponse } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { agentSessionManager } from '@/lib/terminal/agent-session-manager';

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
      };
    });

    const pipelines = agentSessionManager.listPipelinesByUser(userId).map((pipeline) => ({
      pipelineId: pipeline.pipelineId,
      status: pipeline.status,
      currentStepIndex: pipeline.currentStepIndex,
      totalSteps: pipeline.steps.length,
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

    const summary = {
      totalSessions: agentSessions.length,
      runningSessions: agentSessions.filter((item) => item.status === 'running').length,
      totalPipelines: pipelines.length,
      activePipelines: pipelines.filter((item) => item.status === 'running' || item.status === 'paused').length,
      runningPipelines: pipelines.filter((item) => item.status === 'running').length,
      pausedPipelines: pipelines.filter((item) => item.status === 'paused').length,
    };

    return NextResponse.json({
      success: true,
      data: {
        summary,
        agentSessions,
        pipelines,
      },
    });
  } catch (err) {
    console.error('[API] 获取终端执行单元状态失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: '获取终端执行单元状态失败' } },
      { status: 500 },
    );
  }
}

export const GET = withAuth(handler, 'worker:read');
