// ============================================================
// API: 批量创建 Task（Pipeline）
// POST /api/tasks/batch  - 创建多步骤任务组，支持“步骤内并行 + 步骤间串行”
// ============================================================

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { tasks, systemEvents, agentDefinitions, repositories, workers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '@/lib/sse/manager';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { hasUsableSecretValue } from '@/lib/secrets/resolve';
import { collectWorkerEnvVarsForAgent, type WorkerCapabilitySnapshot } from '@/lib/workers/capabilities';
import { parseCreatePipelinePayload } from '@/lib/validation/task-input';
import { AGENT_MESSAGES, API_COMMON_MESSAGES, REPO_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';

function isPresent(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

function buildPipelineTaskPrompt(input: {
  stepIndex: number;
  totalSteps: number;
  stepTitle: string;
  stepDescription: string;
  nodeIndex: number;
  totalNodes: number;
  nodeDescription: string;
  inputFiles?: string[];
  inputCondition?: string;
}): string {
  const stepDir = `.conversations/step${input.stepIndex + 1}`;
  const prevStepDir = input.stepIndex > 0 ? `.conversations/step${input.stepIndex}` : null;
  const nodeOutputFile = `${stepDir}/agent-${input.nodeIndex + 1}-output.md`;
  const defaultSummaryFile = `${stepDir}/summary.md`;

  const sections: string[] = [];
  sections.push(input.nodeDescription.trim());
  sections.push('');
  sections.push('## Pipeline 协作约束');
  sections.push(`- 当前步骤: ${input.stepIndex + 1}/${input.totalSteps} (${input.stepTitle})`);
  sections.push(`- 步骤内并行子任务: ${input.nodeIndex + 1}/${input.totalNodes}`);
  sections.push(`- 本步骤输出目录: ${stepDir}`);
  if (prevStepDir) {
    sections.push(`- 上一步输出目录: ${prevStepDir}`);
  } else {
    sections.push('- 当前为第一个步骤，无上一步输入');
  }

  if (input.inputCondition) {
    sections.push(`- 输入条件: ${input.inputCondition}`);
  }

  if (input.inputFiles && input.inputFiles.length > 0) {
    sections.push(`- 建议优先读取文件: ${input.inputFiles.join(', ')}`);
  } else if (prevStepDir) {
    sections.push(`- 建议默认读取: ${prevStepDir}/summary.md`);
  }

  sections.push(`- 请将本子任务结果写入: ${nodeOutputFile}`);
  sections.push(`- 并在步骤结束前更新: ${defaultSummaryFile}`);
  sections.push('- 步骤内多个 Agent 通过上述目录中的文件进行协作，不要仅输出到终端。');

  if (input.totalNodes > 1) {
    sections.push('');
    sections.push('## 步骤共享目标');
    sections.push(input.stepDescription.trim());
  }

  return sections.join('\n');
}

async function handler(request: AuthenticatedRequest) {
  ensureSchedulerStarted();
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = parseCreatePipelinePayload(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: { code: 'INVALID_INPUT', message: parsed.errorMessage } },
        { status: 400 }
      );
    }
    const payload = parsed.data;

    const defaultAgentId = payload.agentDefinitionId;
    const repoUrl = payload.repoUrl;
    const repositoryId = payload.repositoryId;
    const baseBranch = payload.baseBranch;
    const workDir = payload.workDir;
    const maxRetries = payload.maxRetries;
    const groupIdInput = payload.groupId;
    const steps = payload.steps;

    // 收集所有用到的 agentDefinitionId（去重）
    const allAgentIds = new Set<string>();
    for (const step of steps) {
      allAgentIds.add(step.agentDefinitionId || defaultAgentId);
      for (const node of step.parallelAgents ?? []) {
        allAgentIds.add(node.agentDefinitionId || step.agentDefinitionId || defaultAgentId);
      }
    }

    if (repositoryId) {
      const repo = await db
        .select({ id: repositories.id })
        .from(repositories)
        .where(eq(repositories.id, repositoryId))
        .limit(1);
      if (repo.length === 0) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: REPO_MESSAGES.notFound(repositoryId) } },
          { status: 404 }
        );
      }
    }

    // 验证所有 agent 存在并校验环境变量
    const agentCache = new Map<string, { displayName: string; requiredEnvVars: Array<{ name: string; description?: string; required?: boolean }> }>();
    for (const agentId of allAgentIds) {
      const agent = await db
        .select({
          id: agentDefinitions.id,
          displayName: agentDefinitions.displayName,
          requiredEnvVars: agentDefinitions.requiredEnvVars,
        })
        .from(agentDefinitions)
        .where(eq(agentDefinitions.id, agentId))
        .limit(1);

      if (agent.length === 0) {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: AGENT_MESSAGES.notFoundDefinition(agentId) } },
          { status: 404 }
        );
      }

      agentCache.set(agentId, {
        displayName: agent[0].displayName,
        requiredEnvVars: (agent[0].requiredEnvVars as Array<{ name: string; description?: string; required?: boolean }>) || [],
      });
    }

    // 聚合所有 agent 的必需环境变量并校验
    const allMissingEnvVars = new Set<string>();
    let firstMissingAgent = '';
    for (const [agentId, agentInfo] of agentCache) {
      const requiredEnvVars = agentInfo.requiredEnvVars;
      for (const ev of requiredEnvVars.filter((r) => Boolean(r.required))) {
        if (isPresent(ev.name)) continue;
        const ok = await hasUsableSecretValue(ev.name, {
          agentDefinitionId: agentId,
          repositoryId,
          repoUrl,
        });
        if (!ok) {
          allMissingEnvVars.add(ev.name);
          if (!firstMissingAgent) firstMissingAgent = agentInfo.displayName;
        }
      }
    }

    // 如果服务端未配置，但某个在线 daemon Worker 已上报该变量存在，则允许创建流水线
    let finalMissingEnvVars = Array.from(allMissingEnvVars);
    if (finalMissingEnvVars.length > 0) {
      const nowMs = Date.now();
      const staleTimeoutMs = Number(process.env.WORKER_STALE_TIMEOUT_MS || 30_000);
      const workerRows = await db
        .select({
          id: workers.id,
          status: workers.status,
          mode: workers.mode,
          lastHeartbeatAt: workers.lastHeartbeatAt,
          supportedAgentIds: workers.supportedAgentIds,
          reportedEnvVars: workers.reportedEnvVars,
        })
        .from(workers);

      const snapshots: WorkerCapabilitySnapshot[] = workerRows.map((w) => ({
        id: w.id,
        status: w.status,
        mode: w.mode,
        lastHeartbeatAt: w.lastHeartbeatAt,
        supportedAgentIds: (w.supportedAgentIds as string[]) || [],
        reportedEnvVars: (w.reportedEnvVars as string[]) || [],
      }));

      // 对每个 agent 分别检查 worker 上的环境变量
      const workerCoveredVars = new Set<string>();
      for (const agentId of allAgentIds) {
        const availableOnWorkers = collectWorkerEnvVarsForAgent(snapshots, {
          agentDefinitionId: agentId,
          nowMs,
          staleTimeoutMs,
        });
        for (const v of availableOnWorkers) workerCoveredVars.add(v);
      }

      finalMissingEnvVars = finalMissingEnvVars.filter((name) => !workerCoveredVars.has(name));
    }

    if (finalMissingEnvVars.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'MISSING_ENV_VARS',
            message: TASK_MESSAGES.missingAgentEnvVars(firstMissingAgent, finalMissingEnvVars),
            missingEnvVars: finalMissingEnvVars,
          },
        },
        { status: 400 }
      );
    }

    // groupId：未指定则自动生成
    const pipelineId = uuidv4();
    const groupId = groupIdInput || `pipeline/${pipelineId.slice(0, 8)}`;

    const created: Array<typeof tasks.$inferSelect> = [];
    let previousStepTaskIds: string[] = [];
    const now = new Date().toISOString();

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const parallelNodes = step.parallelAgents && step.parallelAgents.length > 0
        ? step.parallelAgents
        : [{
            title: step.title,
            description: step.description,
            agentDefinitionId: step.agentDefinitionId,
          }];

      const currentStepTaskIds: string[] = [];

      for (let nodeIndex = 0; nodeIndex < parallelNodes.length; nodeIndex += 1) {
        const node = parallelNodes[nodeIndex];
        const stepAgentId = node.agentDefinitionId || step.agentDefinitionId || defaultAgentId;
        const taskId = uuidv4();
        const workBranch = `cam/task-${taskId.slice(0, 8)}`;
        const dependsOn = previousStepTaskIds;
        const initialStatus = dependsOn.length > 0 ? 'waiting' : 'queued';
        const nodeTitle = node.title?.trim();
        const taskTitle = parallelNodes.length > 1
          ? `${step.title} · 并行 ${nodeIndex + 1}/${parallelNodes.length}${nodeTitle ? ` · ${nodeTitle}` : ''}`
          : step.title;
        const description = buildPipelineTaskPrompt({
          stepIndex: i,
          totalSteps: steps.length,
          stepTitle: step.title,
          stepDescription: step.description,
          nodeIndex,
          totalNodes: parallelNodes.length,
          nodeDescription: node.description,
          inputFiles: step.inputFiles,
          inputCondition: step.inputCondition,
        });

        const inserted = await db
          .insert(tasks)
          .values({
            id: taskId,
            title: taskTitle,
            description,
            agentDefinitionId: stepAgentId,
            repositoryId,
            repoUrl,
            baseBranch,
            workBranch,
            workDir: workDir || null,
            status: initialStatus,
            maxRetries,
            dependsOn,
            groupId,
            queuedAt: now,
          })
          .returning();

        created.push(inserted[0]);
        currentStepTaskIds.push(taskId);

        await db.insert(systemEvents).values({
          type: 'task.created',
          payload: {
            taskId,
            title: taskTitle,
            agentDefinitionId: stepAgentId,
            groupId,
            pipelineId,
            stepIndex: i,
            nodeIndex,
            parallelCount: parallelNodes.length,
          },
        });

        sseManager.broadcast(initialStatus === 'queued' ? 'task.queued' : 'task.waiting', { taskId, title: taskTitle });
        sseManager.broadcast('task.progress', { taskId, status: initialStatus });
      }

      previousStepTaskIds = currentStepTaskIds;
    }

    await db.insert(systemEvents).values({
      type: 'pipeline.created',
      payload: {
        pipelineId,
        groupId,
        taskIds: created.map((t) => t.id),
        steps: steps.length,
        parallelTasks: created.length,
      },
    });

    return NextResponse.json(
      { success: true, data: { pipelineId, groupId, tasks: created } },
      { status: 201 }
    );
  } catch (err) {
    console.error('[API] 批量创建任务失败:', err);
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: API_COMMON_MESSAGES.createFailed } },
      { status: 500 }
    );
  }
}

export const POST = withAuth(handler, 'task:create');
