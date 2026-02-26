// ============================================================
// 任务相关 API 输入校验（无外部依赖）
// 说明：当前环境无法新增 zod 依赖，先用统一校验函数保证行为一致
// ============================================================

import { hasOwnKey, isPlainObject } from './objects.ts';
import { normalizeOptionalString } from './strings.ts';

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = { success: false; errorMessage: string };
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

function parseOptionalString(value: unknown): string | null {
  return normalizeOptionalString(value);
}

function parseOptionalBoolean(value: unknown): boolean {
  return value === true;
}

function parseOptionalInteger(value: unknown, fallback: number, min: number, max: number): number {
  const raw =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isInteger(raw)) return fallback;
  if (raw < min || raw > max) return fallback;
  return raw;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    const normalized = normalizeOptionalString(item);
    if (!normalized) continue;
    unique.add(normalized);
  }
  return Array.from(unique);
}

export type CreateTaskPayload = {
  title: string;
  description: string;
  agentDefinitionId: string;
  repositoryId: string | null;
  repoUrl: string;
  baseBranch: string;
  workDir: string | null;
  maxRetries: number;
  dependsOn: string[];
  groupId: string | null;
};

export function parseCreateTaskPayload(input: unknown): ParseResult<CreateTaskPayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const title = normalizeOptionalString(input.title);
  const description = normalizeOptionalString(input.description);
  const agentDefinitionId = normalizeOptionalString(input.agentDefinitionId);
  const repoUrl = normalizeOptionalString(input.repoUrl);

  if (!title || !description || !agentDefinitionId || !repoUrl) {
    return {
      success: false,
      errorMessage: '缺少必填字段: title, description, agentDefinitionId, repoUrl',
    };
  }

  return {
    success: true,
    data: {
      title,
      description,
      agentDefinitionId,
      repositoryId: parseOptionalString(input.repositoryId),
      repoUrl,
      baseBranch: normalizeOptionalString(input.baseBranch) || 'main',
      workDir: parseOptionalString(input.workDir),
      maxRetries: parseOptionalInteger(input.maxRetries, 2, 0, 20),
      dependsOn: parseStringArray(input.dependsOn),
      groupId: parseOptionalString(input.groupId),
    },
  };
}

export type CreatePipelinePayload = {
  agentDefinitionId: string;
  repositoryId: string | null;
  repoUrl: string;
  baseBranch: string;
  workDir: string | null;
  maxRetries: number;
  groupId: string | null;
  steps: Array<{
    title: string;
    description: string;
    agentDefinitionId?: string;
    inputFiles?: string[];
    inputCondition?: string;
    parallelAgents?: Array<{ title?: string; description: string; agentDefinitionId?: string }>;
  }>;
};

export function parseCreatePipelinePayload(input: unknown): ParseResult<CreatePipelinePayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const agentDefinitionId = normalizeOptionalString(input.agentDefinitionId);
  const repoUrl = normalizeOptionalString(input.repoUrl);
  if (!repoUrl) {
    return {
      success: false,
      errorMessage: '缺少必填字段: repoUrl',
    };
  }

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    return {
      success: false,
      errorMessage: 'steps 必须是非空数组，且每项包含 title/description',
    };
  }

  const steps: Array<{
    title: string;
    description: string;
    agentDefinitionId?: string;
    inputFiles?: string[];
    inputCondition?: string;
    parallelAgents?: Array<{ title?: string; description: string; agentDefinitionId?: string }>;
  }> = [];
  for (const rawStep of input.steps) {
    if (!isPlainObject(rawStep)) {
      return {
        success: false,
        errorMessage: 'steps 必须是非空数组，且每项包含 title/description',
      };
    }

    const title = normalizeOptionalString(rawStep.title);
    const description = normalizeOptionalString(rawStep.description);
    if (!title || !description) {
      return {
        success: false,
        errorMessage: 'steps 必须是非空数组，且每项包含 title/description',
      };
    }
    const stepAgent = normalizeOptionalString(rawStep.agentDefinitionId);

    let inputFiles: string[] | undefined;
    if (hasOwnKey(rawStep, 'inputFiles')) {
      const rawInputFiles = rawStep.inputFiles;
      if (rawInputFiles !== undefined && rawInputFiles !== null) {
        if (!Array.isArray(rawInputFiles)) {
          return {
            success: false,
            errorMessage: 'steps[].inputFiles 必须是字符串数组',
          };
        }
        const normalized = new Set<string>();
        for (const rawFile of rawInputFiles) {
          const filePath = normalizeOptionalString(rawFile);
          if (!filePath) {
            return {
              success: false,
              errorMessage: 'steps[].inputFiles 中存在非法路径',
            };
          }
          normalized.add(filePath);
        }
        inputFiles = Array.from(normalized);
      }
    }

    let inputCondition: string | undefined;
    if (hasOwnKey(rawStep, 'inputCondition')) {
      const rawInputCondition = rawStep.inputCondition;
      if (rawInputCondition !== undefined && rawInputCondition !== null) {
        const parsedInputCondition = normalizeOptionalString(rawInputCondition);
        if (!parsedInputCondition) {
          return {
            success: false,
            errorMessage: 'steps[].inputCondition 必须是非空字符串',
          };
        }
        inputCondition = parsedInputCondition;
      }
    }

    let parallelAgents: Array<{ title?: string; description: string; agentDefinitionId?: string }> | undefined;
    if (hasOwnKey(rawStep, 'parallelAgents')) {
      const rawParallelAgents = rawStep.parallelAgents;
      if (rawParallelAgents !== undefined && rawParallelAgents !== null) {
        if (!Array.isArray(rawParallelAgents)) {
          return {
            success: false,
            errorMessage: 'steps[].parallelAgents 必须是数组',
          };
        }
        const nodes: Array<{ title?: string; description: string; agentDefinitionId?: string }> = [];
        for (const rawNode of rawParallelAgents) {
          if (!isPlainObject(rawNode)) {
            return {
              success: false,
              errorMessage: 'steps[].parallelAgents[] 必须是对象',
            };
          }
          const nodeDescription = normalizeOptionalString(rawNode.description);
          if (!nodeDescription) {
            return {
              success: false,
              errorMessage: 'steps[].parallelAgents[] 缺少 description',
            };
          }
          const nodeTitle = normalizeOptionalString(rawNode.title);
          const nodeAgent = normalizeOptionalString(rawNode.agentDefinitionId);
          nodes.push({
            description: nodeDescription,
            ...(nodeTitle ? { title: nodeTitle } : {}),
            ...(nodeAgent ? { agentDefinitionId: nodeAgent } : {}),
          });
        }
        parallelAgents = nodes.length > 0 ? nodes : undefined;
      }
    }

    steps.push({
      title,
      description,
      ...(stepAgent ? { agentDefinitionId: stepAgent } : {}),
      ...(inputFiles && inputFiles.length > 0 ? { inputFiles } : {}),
      ...(inputCondition ? { inputCondition } : {}),
      ...(parallelAgents && parallelAgents.length > 0 ? { parallelAgents } : {}),
    });
  }

  // 每个可执行节点必须有 agent：节点级 > 步骤级 > 顶层默认
  for (const step of steps) {
    const stepDefaultAgent = step.agentDefinitionId || agentDefinitionId;
    const nodes = step.parallelAgents && step.parallelAgents.length > 0
      ? step.parallelAgents
      : [{ description: step.description, agentDefinitionId: step.agentDefinitionId }];
    for (const node of nodes) {
      if (!node.agentDefinitionId && !stepDefaultAgent) {
        return {
          success: false,
          errorMessage: '缺少 agentDefinitionId：每个步骤/并行子任务必须指定智能体，或设置顶层默认智能体',
        };
      }
    }
  }

  const resolvedDefaultAgentId = agentDefinitionId
    || steps.find((s) => s.agentDefinitionId)?.agentDefinitionId
    || steps.flatMap((s) => s.parallelAgents ?? []).find((n) => n.agentDefinitionId)?.agentDefinitionId;

  if (!resolvedDefaultAgentId) {
    return {
      success: false,
      errorMessage: '缺少 agentDefinitionId：无法推断默认智能体',
    };
  }

  return {
    success: true,
    data: {
      agentDefinitionId: resolvedDefaultAgentId,
      repositoryId: parseOptionalString(input.repositoryId),
      repoUrl,
      baseBranch: normalizeOptionalString(input.baseBranch) || 'main',
      workDir: parseOptionalString(input.workDir),
      maxRetries: parseOptionalInteger(input.maxRetries, 2, 0, 20),
      groupId: parseOptionalString(input.groupId),
      steps,
    },
  };
}

export type ReviewPayload = {
  action: 'approve' | 'reject';
  mergeRequested: boolean;
  reviewComment: string | null;
  feedback: string | null;
};

export function parseReviewPayload(input: unknown): ParseResult<ReviewPayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const action = input.action === 'approve' || input.action === 'reject' ? input.action : null;
  if (!action) {
    return { success: false, errorMessage: 'action 必须是 approve 或 reject' };
  }

  const feedback = parseOptionalString(input.feedback);
  if (action === 'reject' && !feedback) {
    return { success: false, errorMessage: 'reject 必须提供 feedback' };
  }

  return {
    success: true,
    data: {
      action,
      mergeRequested: parseOptionalBoolean(input.merge),
      reviewComment: parseOptionalString(input.comment),
      feedback,
    },
  };
}

export type RerunPayload = {
  feedback: string | null;
};

export function parseRerunPayload(input: unknown): ParseResult<RerunPayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  return {
    success: true,
    data: {
      feedback: parseOptionalString(input.feedback),
    },
  };
}

const ALLOWED_TASK_STATUS = new Set([
  'draft',
  'queued',
  'waiting',
  'running',
  'awaiting_review',
  'completed',
  'failed',
  'cancelled',
]);

type TaskPatchData = {
  status?: string;
  summary?: string | null;
  prUrl?: string | null;
  logFileUrl?: string | null;
  assignedWorkerId?: string | null;
  feedback?: string | null;
};

function readNullableStringField(
  record: Record<string, unknown>,
  key: string
): { hasKey: boolean; value: string | null; valid: boolean } {
  const hasKey = hasOwnKey(record, key);
  if (!hasKey) {
    return { hasKey: false, value: null, valid: true };
  }

  const raw = record[key];
  if (raw === null) {
    return { hasKey: true, value: null, valid: true };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return { hasKey: true, value: trimmed.length > 0 ? trimmed : null, valid: true };
  }

  return { hasKey: true, value: null, valid: false };
}

export function parseTaskPatchPayload(input: unknown): ParseResult<TaskPatchData> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const updateData: TaskPatchData = {};
  let touched = 0;

  if (hasOwnKey(input, 'status')) {
    touched += 1;
    const status = normalizeOptionalString(input.status);
    if (!status || !ALLOWED_TASK_STATUS.has(status)) {
      return { success: false, errorMessage: 'status 非法' };
    }
    updateData.status = status;
  }

  const fields: Array<keyof Omit<TaskPatchData, 'status'>> = [
    'summary',
    'prUrl',
    'logFileUrl',
    'assignedWorkerId',
    'feedback',
  ];

  for (const field of fields) {
    const parsed = readNullableStringField(input, field);
    if (!parsed.valid) {
      return { success: false, errorMessage: `${field} 必须是 string 或 null` };
    }
    if (!parsed.hasKey) continue;
    touched += 1;
    updateData[field] = parsed.value;
  }

  if (touched === 0) {
    return { success: false, errorMessage: '请求体缺少可更新字段' };
  }

  return { success: true, data: updateData };
}
