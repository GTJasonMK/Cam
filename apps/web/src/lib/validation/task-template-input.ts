// ============================================================
// 任务模板 API 输入校验（无外部依赖）
// ============================================================

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = { success: false; errorMessage: string };
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

type NullableString = string | null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readOptionalStringField(
  source: Record<string, unknown>,
  key: string
): { exists: boolean; valid: boolean; value: NullableString } {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return { exists: false, valid: true, value: null };
  }
  const raw = source[key];
  if (raw === null) {
    return { exists: true, valid: true, value: null };
  }
  const value = toTrimmedString(raw);
  return { exists: true, valid: value !== null, value };
}

export type TaskTemplateCreatePayload = {
  name: string;
  titleTemplate: string;
  promptTemplate: string;
  agentDefinitionId: NullableString;
  repositoryId: NullableString;
  repoUrl: NullableString;
  baseBranch: NullableString;
  workDir: NullableString;
  /** 流水线步骤，null 表示单任务模板 */
  pipelineSteps: Array<{ title: string; description: string; agentDefinitionId?: string }> | null;
  /** 流水线默认最大重试次数 */
  maxRetries: number;
};

export function parseCreateTaskTemplatePayload(input: unknown): ParseResult<TaskTemplateCreatePayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const name = toTrimmedString(input.name);
  if (!name) {
    return { success: false, errorMessage: '缺少必填字段: name' };
  }

  // 流水线步骤验证
  const pipelineSteps = parsePipelineSteps(input.pipelineSteps);
  const isPipeline = pipelineSteps !== null;

  // 单任务模板：titleTemplate + promptTemplate 必填
  // 流水线模板：titleTemplate + promptTemplate 可选（自动填充占位）
  const titleTemplate = toTrimmedString(input.titleTemplate);
  const promptTemplate = toTrimmedString(input.promptTemplate);

  if (!isPipeline && (!titleTemplate || !promptTemplate)) {
    return {
      success: false,
      errorMessage: '缺少必填字段: titleTemplate, promptTemplate',
    };
  }

  // maxRetries 验证
  const maxRetries = typeof input.maxRetries === 'number'
    ? Math.max(0, Math.min(20, Math.floor(input.maxRetries)))
    : 2;

  return {
    success: true,
    data: {
      name,
      titleTemplate: titleTemplate || '(流水线模板)',
      promptTemplate: promptTemplate || '(流水线模板)',
      agentDefinitionId: toTrimmedString(input.agentDefinitionId),
      repositoryId: toTrimmedString(input.repositoryId),
      repoUrl: toTrimmedString(input.repoUrl),
      baseBranch: toTrimmedString(input.baseBranch),
      workDir: toTrimmedString(input.workDir),
      pipelineSteps,
      maxRetries,
    },
  };
}

/** 解析流水线步骤数组，返回 null 表示非流水线 */
function parsePipelineSteps(
  value: unknown,
): Array<{ title: string; description: string; agentDefinitionId?: string }> | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  if (value.length === 0) return null;

  const steps: Array<{ title: string; description: string; agentDefinitionId?: string }> = [];
  for (const item of value) {
    if (!isPlainObject(item)) return null;
    const title = toTrimmedString(item.title);
    const description = toTrimmedString(item.description);
    if (!title || !description) return null;
    const agentDefinitionId = toTrimmedString(item.agentDefinitionId);
    steps.push({ title, description, ...(agentDefinitionId ? { agentDefinitionId } : {}) });
  }
  return steps;
}

export type TaskTemplatePatchPayload = Partial<TaskTemplateCreatePayload>;
type NullablePatchKey = 'agentDefinitionId' | 'repositoryId' | 'repoUrl' | 'baseBranch' | 'workDir';

export function parsePatchTaskTemplatePayload(input: unknown): ParseResult<TaskTemplatePatchPayload> {
  if (!isPlainObject(input)) {
    return { success: false, errorMessage: '请求体必须是 JSON object' };
  }

  const updateData: TaskTemplatePatchPayload = {};
  let touched = 0;

  const requiredStringFields: Array<{ key: keyof TaskTemplatePatchPayload; label: string }> = [
    { key: 'name', label: 'name' },
    { key: 'titleTemplate', label: 'titleTemplate' },
    { key: 'promptTemplate', label: 'promptTemplate' },
  ];

  for (const { key, label } of requiredStringFields) {
    const value = readOptionalStringField(input, key);
    if (!value.exists) continue;
    touched += 1;
    if (!value.valid || !value.value) {
      return { success: false, errorMessage: `${label} 不能为空` };
    }
    (updateData as Record<string, unknown>)[key] = value.value;
  }

  const optionalStringFields: NullablePatchKey[] = [
    'agentDefinitionId',
    'repositoryId',
    'repoUrl',
    'baseBranch',
    'workDir',
  ];

  for (const key of optionalStringFields) {
    const value = readOptionalStringField(input, key);
    if (!value.exists) continue;
    touched += 1;
    if (!value.valid) {
      return { success: false, errorMessage: `${key} 必须是字符串或 null` };
    }
    updateData[key] = value.value;
  }

  // 流水线字段
  if (Object.prototype.hasOwnProperty.call(input, 'pipelineSteps')) {
    touched += 1;
    updateData.pipelineSteps = parsePipelineSteps(input.pipelineSteps);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'maxRetries')) {
    touched += 1;
    updateData.maxRetries = typeof input.maxRetries === 'number'
      ? Math.max(0, Math.min(20, Math.floor(input.maxRetries)))
      : 2;
  }

  if (touched === 0) {
    return { success: false, errorMessage: '缺少可更新字段' };
  }

  return { success: true, data: updateData };
}
