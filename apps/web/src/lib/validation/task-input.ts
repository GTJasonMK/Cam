// ============================================================
// 任务相关 API 输入校验（无外部依赖）
// 说明：当前环境无法新增 zod 依赖，先用统一校验函数保证行为一致
// ============================================================

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = { success: false; errorMessage: string };
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseOptionalString(value: unknown): string | null {
  const normalized = asTrimmedString(value);
  return normalized || null;
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
    const normalized = asTrimmedString(item);
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

  const title = asTrimmedString(input.title);
  const description = asTrimmedString(input.description);
  const agentDefinitionId = asTrimmedString(input.agentDefinitionId);
  const repoUrl = asTrimmedString(input.repoUrl);

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
      baseBranch: asTrimmedString(input.baseBranch) || 'main',
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
  steps: Array<{ title: string; description: string }>;
};

export function parseCreatePipelinePayload(input: unknown): ParseResult<CreatePipelinePayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const agentDefinitionId = asTrimmedString(input.agentDefinitionId);
  const repoUrl = asTrimmedString(input.repoUrl);
  if (!agentDefinitionId || !repoUrl) {
    return {
      success: false,
      errorMessage: '缺少必填字段: agentDefinitionId, repoUrl',
    };
  }

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    return {
      success: false,
      errorMessage: 'steps 必须是非空数组，且每项包含 title/description',
    };
  }

  const steps: Array<{ title: string; description: string }> = [];
  for (const rawStep of input.steps) {
    if (!isPlainObject(rawStep)) {
      return {
        success: false,
        errorMessage: 'steps 必须是非空数组，且每项包含 title/description',
      };
    }

    const title = asTrimmedString(rawStep.title);
    const description = asTrimmedString(rawStep.description);
    if (!title || !description) {
      return {
        success: false,
        errorMessage: 'steps 必须是非空数组，且每项包含 title/description',
      };
    }
    steps.push({ title, description });
  }

  return {
    success: true,
    data: {
      agentDefinitionId,
      repositoryId: parseOptionalString(input.repositoryId),
      repoUrl,
      baseBranch: asTrimmedString(input.baseBranch) || 'main',
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
  const hasKey = Object.prototype.hasOwnProperty.call(record, key);
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

  if (Object.prototype.hasOwnProperty.call(input, 'status')) {
    touched += 1;
    const status = asTrimmedString(input.status);
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
