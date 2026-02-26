// ============================================================
// API: 批量创建 Task（Pipeline）
// POST /api/tasks/batch  - 创建多步骤任务组，支持“步骤内并行 + 步骤间串行”
// ============================================================

import { db } from '@/lib/db';
import { tasks, systemEvents, repositories } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { sseManager } from '@/lib/sse/manager';
import { ensureSchedulerStarted } from '@/lib/scheduler/auto-start';
import { loadAgentRequirements, validateAgentRequiredEnvVars } from '@/lib/tasks/agent-env-validation';
import { parseCreatePipelinePayload } from '@/lib/validation/task-input';
import { AGENT_MESSAGES, API_COMMON_MESSAGES, REPO_MESSAGES, TASK_MESSAGES } from '@/lib/i18n/messages';
import { buildSystemEventValues } from '@/lib/audit/system-event';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/with-auth';
import { readJsonBodyAsRecord } from '@/lib/http/read-json';
import { apiBadRequest, apiCreated, apiError, apiInternalError, apiNotFound } from '@/lib/http/api-response';
import { normalizeOptionalString } from '@/lib/validation/strings';

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
    const body = await readJsonBodyAsRecord(request);
    const parsed = parseCreatePipelinePayload(body);
    if (!parsed.success) {
      return apiBadRequest(parsed.errorMessage);
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
        return apiNotFound(REPO_MESSAGES.notFound(repositoryId));
      }
    }

    // 验证所有 agent 存在并校验环境变量
    const allAgentIdList = Array.from(allAgentIds);
    const { orderedAgentRequirements, missingAgentIds } = await loadAgentRequirements(allAgentIdList);
    if (missingAgentIds.length > 0) {
      return apiNotFound(AGENT_MESSAGES.notFoundDefinition(missingAgentIds[0]));
    }

    const envValidation = await validateAgentRequiredEnvVars({
      agentRequirements: orderedAgentRequirements,
      repositoryId,
      repoUrl,
    });
    if (envValidation.missingEnvVars.length > 0) {
      const missingAgentName = envValidation.firstMissingAgentDisplayName || orderedAgentRequirements[0]?.displayName || 'Agent';
      return apiError(
        'MISSING_ENV_VARS',
        TASK_MESSAGES.missingAgentEnvVars(missingAgentName, envValidation.missingEnvVars),
        {
          status: 400,
          extra: { missingEnvVars: envValidation.missingEnvVars },
        },
      );
    }

    // groupId：未指定则自动生成
    const pipelineId = uuidv4();
    const groupId = groupIdInput || `pipeline/${pipelineId.slice(0, 8)}`;

    const created: Array<typeof tasks.$inferSelect> = [];
    const pendingBroadcasts: Array<{ taskId: string; title: string; status: 'queued' | 'waiting' }> = [];
    let previousStepTaskIds: string[] = [];
    const now = new Date().toISOString();

    // 原子创建：避免中途失败导致“半条流水线”落库。
    db.transaction((tx) => {
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
          const dependsOn = [...previousStepTaskIds];
          const initialStatus = dependsOn.length > 0 ? 'waiting' : 'queued';
          const nodeTitle = normalizeOptionalString(node.title);
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

          const inserted = tx
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
            .returning()
            .get();

          created.push(inserted);
          currentStepTaskIds.push(taskId);
          pendingBroadcasts.push({
            taskId,
            title: taskTitle,
            status: initialStatus,
          });

          tx.insert(systemEvents).values(buildSystemEventValues({
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
          })).run();
        }

        previousStepTaskIds = currentStepTaskIds;
      }

      tx.insert(systemEvents).values(buildSystemEventValues({
        type: 'pipeline.created',
        payload: {
          pipelineId,
          groupId,
          taskIds: created.map((t) => t.id),
          steps: steps.length,
          parallelTasks: created.length,
        },
      })).run();
    });

    for (const item of pendingBroadcasts) {
      sseManager.broadcast(item.status === 'queued' ? 'task.queued' : 'task.waiting', {
        taskId: item.taskId,
        title: item.title,
      });
      sseManager.broadcast('task.progress', { taskId: item.taskId, status: item.status });
    }

    return apiCreated({ pipelineId, groupId, tasks: created });
  } catch (err) {
    console.error('[API] 批量创建任务失败:', err);
    return apiInternalError(API_COMMON_MESSAGES.createFailed);
  }
}

export const POST = withAuth(handler, 'task:create');
