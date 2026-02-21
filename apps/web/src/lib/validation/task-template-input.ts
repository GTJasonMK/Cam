// ============================================================
// 任务模板 API 输入校验（无外部依赖）
// ============================================================

type ParseSuccess<T> = { success: true; data: T };
type ParseFailure = { success: false; errorMessage: string };
type ParseResult<T> = ParseSuccess<T> | ParseFailure;

type NullableString = string | null;
type PipelineParallelAgent = {
  title?: string;
  description: string;
  agentDefinitionId?: string;
};
type PipelineStep = {
  title: string;
  description: string;
  agentDefinitionId?: string;
  inputFiles?: string[];
  inputCondition?: string;
  parallelAgents?: PipelineParallelAgent[];
};

const MAX_PIPELINE_TEMPLATE_STEPS = 50;
const MAX_PARALLEL_AGENTS_PER_STEP = 8;
const MAX_STEP_INPUT_FILES = 50;

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
  pipelineSteps: PipelineStep[] | null;
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
  const pipelineResult = parsePipelineStepsField(input.pipelineSteps);
  if (pipelineResult.errorMessage) {
    return { success: false, errorMessage: pipelineResult.errorMessage };
  }
  const pipelineSteps = pipelineResult.steps;
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

function parsePipelineStepsField(
  value: unknown,
): { steps: PipelineStep[] | null; errorMessage: string | null } {
  if (value === undefined || value === null) {
    return { steps: null, errorMessage: null };
  }

  if (!Array.isArray(value)) {
    return { steps: null, errorMessage: 'pipelineSteps 必须是数组或 null' };
  }

  if (value.length === 0) {
    return { steps: null, errorMessage: 'pipelineSteps 至少需要 1 个步骤' };
  }

  if (value.length > MAX_PIPELINE_TEMPLATE_STEPS) {
    return { steps: null, errorMessage: `pipelineSteps 最多允许 ${MAX_PIPELINE_TEMPLATE_STEPS} 个步骤` };
  }

  const steps: PipelineStep[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    if (!isPlainObject(item)) {
      return { steps: null, errorMessage: `pipelineSteps[${i}] 必须是对象` };
    }
    const title = toTrimmedString(item.title);
    const description = toTrimmedString(item.description);
    if (!title || !description) {
      return { steps: null, errorMessage: `pipelineSteps[${i}] 缺少有效的 title/description` };
    }
    const agentDefinitionId = toTrimmedString(item.agentDefinitionId);

    let inputCondition: string | undefined;
    if (Object.prototype.hasOwnProperty.call(item, 'inputCondition')) {
      if (item.inputCondition === null || item.inputCondition === undefined) {
        inputCondition = undefined;
      } else {
        const parsed = toTrimmedString(item.inputCondition);
        if (!parsed) {
          return { steps: null, errorMessage: `pipelineSteps[${i}].inputCondition 必须是非空字符串或 null` };
        }
        inputCondition = parsed;
      }
    }

    let inputFiles: string[] | undefined;
    if (Object.prototype.hasOwnProperty.call(item, 'inputFiles')) {
      if (item.inputFiles === null || item.inputFiles === undefined) {
        inputFiles = undefined;
      } else if (!Array.isArray(item.inputFiles)) {
        return { steps: null, errorMessage: `pipelineSteps[${i}].inputFiles 必须是字符串数组或 null` };
      } else {
        const files = new Set<string>();
        for (let j = 0; j < item.inputFiles.length; j++) {
          const raw = item.inputFiles[j];
          const path = toTrimmedString(raw);
          if (!path) {
            return { steps: null, errorMessage: `pipelineSteps[${i}].inputFiles[${j}] 必须是非空字符串` };
          }
          files.add(path);
          if (files.size > MAX_STEP_INPUT_FILES) {
            return { steps: null, errorMessage: `pipelineSteps[${i}].inputFiles 最多允许 ${MAX_STEP_INPUT_FILES} 个` };
          }
        }
        inputFiles = Array.from(files);
      }
    }

    let parallelAgents: PipelineParallelAgent[] | undefined;
    if (Object.prototype.hasOwnProperty.call(item, 'parallelAgents')) {
      if (item.parallelAgents === null || item.parallelAgents === undefined) {
        parallelAgents = undefined;
      } else if (!Array.isArray(item.parallelAgents)) {
        return { steps: null, errorMessage: `pipelineSteps[${i}].parallelAgents 必须是数组或 null` };
      } else {
        if (item.parallelAgents.length > MAX_PARALLEL_AGENTS_PER_STEP) {
          return {
            steps: null,
            errorMessage: `pipelineSteps[${i}].parallelAgents 最多允许 ${MAX_PARALLEL_AGENTS_PER_STEP} 个`,
          };
        }
        const nodes: PipelineParallelAgent[] = [];
        for (let j = 0; j < item.parallelAgents.length; j++) {
          const rawNode = item.parallelAgents[j];
          if (!isPlainObject(rawNode)) {
            return { steps: null, errorMessage: `pipelineSteps[${i}].parallelAgents[${j}] 必须是对象` };
          }
          const nodeDescription = toTrimmedString(rawNode.description);
          if (!nodeDescription) {
            return {
              steps: null,
              errorMessage: `pipelineSteps[${i}].parallelAgents[${j}] 缺少有效的 description`,
            };
          }
          const nodeTitle = toTrimmedString(rawNode.title);
          const nodeAgentDefinitionId = toTrimmedString(rawNode.agentDefinitionId);
          nodes.push({
            description: nodeDescription,
            ...(nodeTitle ? { title: nodeTitle } : {}),
            ...(nodeAgentDefinitionId ? { agentDefinitionId: nodeAgentDefinitionId } : {}),
          });
        }
        parallelAgents = nodes.length > 0 ? nodes : undefined;
      }
    }

    steps.push({
      title,
      description,
      ...(agentDefinitionId ? { agentDefinitionId } : {}),
      ...(inputFiles && inputFiles.length > 0 ? { inputFiles } : {}),
      ...(inputCondition ? { inputCondition } : {}),
      ...(parallelAgents && parallelAgents.length > 0 ? { parallelAgents } : {}),
    });
  }

  return { steps, errorMessage: null };
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
    const pipelineResult = parsePipelineStepsField(input.pipelineSteps);
    if (pipelineResult.errorMessage) {
      return { success: false, errorMessage: pipelineResult.errorMessage };
    }
    updateData.pipelineSteps = pipelineResult.steps;
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
