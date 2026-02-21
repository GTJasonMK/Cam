// ============================================================
// 流水线导入导出工具
// 纯函数模块：构造导出数据、触发下载、解析导入文件
// ============================================================

/** 导出文件格式 */
export interface PipelineExportData {
  version: number;
  type: 'cam-pipeline';
  exportedAt: string;
  name: string;
  agentDefinitionId: string | null;
  repoUrl: string | null;
  baseBranch: string | null;
  workDir: string | null;
  maxRetries: number | null;
  steps: Array<{
    title: string;
    description: string;
    agentDefinitionId?: string;
    inputFiles?: string[];
    inputCondition?: string;
    parallelAgents?: Array<{ title?: string; description: string; agentDefinitionId?: string }>;
  }>;
}

/** 导入时用于校验 Agent 引用的最小字段 */
export type PipelineAgentRefSource = Pick<PipelineExportData, 'agentDefinitionId' | 'steps'>;

const DEFAULT_MAX_PIPELINE_IMPORT_FILE_SIZE_BYTES = 2 * 1024 * 1024;

/** 模板数据输入（兼容 DB 行和表单数据） */
interface TemplateInput {
  name: string;
  agentDefinitionId?: string | null;
  repoUrl?: string | null;
  baseBranch?: string | null;
  workDir?: string | null;
  maxRetries?: number | null;
  pipelineSteps?: Array<{
    title: string;
    description: string;
    agentDefinitionId?: string;
    inputFiles?: string[];
    inputCondition?: string;
    parallelAgents?: Array<{ title?: string; description: string; agentDefinitionId?: string }>;
  }> | null;
}

/** 从模板数据构造导出对象 */
export function buildExportData(template: TemplateInput): PipelineExportData {
  return {
    version: 1,
    type: 'cam-pipeline',
    exportedAt: new Date().toISOString(),
    name: template.name,
    agentDefinitionId: template.agentDefinitionId ?? null,
    repoUrl: template.repoUrl ?? null,
    baseBranch: template.baseBranch ?? null,
    workDir: template.workDir ?? null,
    maxRetries: template.maxRetries ?? null,
    steps: (template.pipelineSteps ?? []).map((s) => ({
      title: s.title,
      description: s.description,
      ...(s.agentDefinitionId ? { agentDefinitionId: s.agentDefinitionId } : {}),
      ...(Array.isArray(s.inputFiles) && s.inputFiles.length > 0 ? { inputFiles: s.inputFiles } : {}),
      ...(s.inputCondition ? { inputCondition: s.inputCondition } : {}),
      ...(Array.isArray(s.parallelAgents) && s.parallelAgents.length > 0 ? { parallelAgents: s.parallelAgents } : {}),
    })),
  };
}

/** 从流水线创建对话框的表单状态构造导出对象 */
export function buildExportDataFromForm(form: {
  name?: string;
  defaultAgent: string;
  repoUrl: string;
  baseBranch: string;
  workDir: string;
  steps: Array<{
    title: string;
    prompt: string;
    agentDefinitionId: string;
    inputFiles?: string[];
    inputCondition?: string;
    parallelAgents?: Array<{ title?: string; prompt: string; agentDefinitionId?: string }>;
  }>;
}): PipelineExportData {
  return {
    version: 1,
    type: 'cam-pipeline',
    exportedAt: new Date().toISOString(),
    name: form.name || '未命名流水线',
    agentDefinitionId: form.defaultAgent || null,
    repoUrl: form.repoUrl.trim() || null,
    baseBranch: form.baseBranch.trim() || null,
    workDir: form.workDir.trim() || null,
    maxRetries: null,
    steps: form.steps.map((s) => ({
      title: s.title.trim(),
      description: s.prompt.trim(),
      ...(s.agentDefinitionId ? { agentDefinitionId: s.agentDefinitionId } : {}),
      ...(Array.isArray(s.inputFiles) && s.inputFiles.length > 0
        ? { inputFiles: s.inputFiles }
        : {}),
      ...(typeof s.inputCondition === 'string'
        && s.inputCondition.trim().length > 0
        ? { inputCondition: s.inputCondition.trim() }
        : {}),
      ...(Array.isArray(s.parallelAgents) && s.parallelAgents.length > 0
        ? {
            parallelAgents: s.parallelAgents
              .map((node) => ({
                ...(node.title ? { title: node.title.trim() } : {}),
                description: node.prompt.trim(),
                ...(node.agentDefinitionId ? { agentDefinitionId: node.agentDefinitionId.trim() } : {}),
              }))
              .filter((node) => node.description.length > 0),
          }
        : {}),
    })),
  };
}

/** 收集流水线配置里引用到的所有 Agent ID（去重 + 去空白） */
export function collectPipelineReferencedAgentIds(data: PipelineAgentRefSource): string[] {
  const ids = new Set<string>();
  const rootAgentId = data.agentDefinitionId?.trim();
  if (rootAgentId) ids.add(rootAgentId);

  for (const step of data.steps) {
    const stepAgentId = step.agentDefinitionId?.trim();
    if (stepAgentId) ids.add(stepAgentId);
    for (const node of step.parallelAgents ?? []) {
      const nodeAgentId = node.agentDefinitionId?.trim();
      if (nodeAgentId) ids.add(nodeAgentId);
    }
  }

  return Array.from(ids);
}

/** 返回导入配置中不存在于系统列表里的 Agent ID */
export function findMissingPipelineAgentIds(
  data: PipelineAgentRefSource,
  knownAgentIds: Iterable<string>
): string[] {
  const knownIds = new Set<string>();
  for (const id of knownAgentIds) {
    const normalized = id.trim();
    if (normalized) knownIds.add(normalized);
  }

  const missing: string[] = [];
  for (const id of collectPipelineReferencedAgentIds(data)) {
    if (!knownIds.has(id)) missing.push(id);
  }
  return missing;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function validatePipelineImportFileSize(
  fileSizeBytes: number,
  maxFileSizeBytes: number
): { ok: true } | { ok: false; error: string } {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes < 0) {
    return { ok: false, error: '文件大小无效，请重新选择文件' };
  }
  if (fileSizeBytes > maxFileSizeBytes) {
    return { ok: false, error: `文件过大，最大支持 ${formatFileSize(maxFileSizeBytes)}` };
  }
  return { ok: true };
}

/** 触发浏览器下载 JSON 文件 */
export function downloadPipelineJson(data: PipelineExportData): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  // 文件名：模板名（去除特殊字符）+ 时间戳
  const safeName = data.name.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 40);
  a.download = `${safeName}-pipeline.json`;
  document.body.appendChild(a);
  a.click();

  // 清理
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type ParseResult =
  | { ok: true; data: PipelineExportData }
  | { ok: false; error: string };

export type OpenPipelineFileResult =
  | { ok: true; content: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

/** 解析导入的 JSON 字符串，校验格式 */
export function parsePipelineImport(jsonString: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return { ok: false, error: 'JSON 解析失败，请检查文件内容' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: '无效的文件格式：根元素必须是对象' };
  }

  const obj = parsed as Record<string, unknown>;

  // type 校验
  if (obj.type !== 'cam-pipeline') {
    return { ok: false, error: '无效的文件类型：缺少 type: "cam-pipeline" 标识' };
  }

  // steps 校验
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    return { ok: false, error: '流水线必须包含至少一个步骤' };
  }

  for (let i = 0; i < obj.steps.length; i++) {
    const step = obj.steps[i] as Record<string, unknown>;
    if (!step || typeof step.title !== 'string' || !step.title.trim()) {
      return { ok: false, error: `步骤 ${i + 1} 缺少有效的 title 字段` };
    }
    if (typeof step.description !== 'string' || !step.description.trim()) {
      return { ok: false, error: `步骤 ${i + 1} 缺少有效的 description 字段` };
    }
    if (step.inputCondition !== undefined && step.inputCondition !== null) {
      if (typeof step.inputCondition !== 'string' || !step.inputCondition.trim()) {
        return { ok: false, error: `步骤 ${i + 1} 的 inputCondition 必须是非空字符串` };
      }
    }
    if (step.inputFiles !== undefined && step.inputFiles !== null) {
      if (!Array.isArray(step.inputFiles)) {
        return { ok: false, error: `步骤 ${i + 1} 的 inputFiles 必须是数组` };
      }
      for (let j = 0; j < step.inputFiles.length; j++) {
        if (typeof step.inputFiles[j] !== 'string' || !String(step.inputFiles[j]).trim()) {
          return { ok: false, error: `步骤 ${i + 1} 的 inputFiles[${j + 1}] 无效` };
        }
      }
    }
    if (step.parallelAgents !== undefined && step.parallelAgents !== null) {
      if (!Array.isArray(step.parallelAgents)) {
        return { ok: false, error: `步骤 ${i + 1} 的 parallelAgents 必须是数组` };
      }
      for (let j = 0; j < step.parallelAgents.length; j++) {
        const node = step.parallelAgents[j];
        if (typeof node !== 'object' || node === null || Array.isArray(node)) {
          return { ok: false, error: `步骤 ${i + 1} 的 parallelAgents[${j + 1}] 必须是对象` };
        }
        const nodeObj = node as Record<string, unknown>;
        if (typeof nodeObj.description !== 'string' || !nodeObj.description.trim()) {
          return { ok: false, error: `步骤 ${i + 1} 的 parallelAgents[${j + 1}] 缺少 description` };
        }
      }
    }
  }

  const data: PipelineExportData = {
    version: typeof obj.version === 'number' ? obj.version : 1,
    type: 'cam-pipeline',
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
    name: typeof obj.name === 'string' ? obj.name : '导入的流水线',
    agentDefinitionId:
      typeof obj.agentDefinitionId === 'string' && obj.agentDefinitionId.trim()
        ? obj.agentDefinitionId.trim()
        : null,
    repoUrl: typeof obj.repoUrl === 'string' ? obj.repoUrl : null,
    baseBranch: typeof obj.baseBranch === 'string' ? obj.baseBranch : null,
    workDir: typeof obj.workDir === 'string' ? obj.workDir : null,
    maxRetries:
      typeof obj.maxRetries === 'number' && Number.isFinite(obj.maxRetries)
        ? Math.max(0, Math.min(20, Math.floor(obj.maxRetries)))
        : null,
    steps: (obj.steps as Array<Record<string, unknown>>).map((s) => ({
      title: String(s.title).trim(),
      description: String(s.description).trim(),
      ...(typeof s.agentDefinitionId === 'string' && s.agentDefinitionId.trim()
        ? { agentDefinitionId: s.agentDefinitionId.trim() }
        : {}),
      ...(Array.isArray(s.inputFiles)
        ? {
            inputFiles: s.inputFiles
              .map((v) => (typeof v === 'string' ? v.trim() : ''))
              .filter((v) => v.length > 0),
          }
        : {}),
      ...(typeof s.inputCondition === 'string' && s.inputCondition.trim()
        ? { inputCondition: s.inputCondition.trim() }
        : {}),
      ...(Array.isArray(s.parallelAgents)
        ? {
            parallelAgents: (s.parallelAgents as Array<Record<string, unknown>>)
              .map((node) => {
                const description = typeof node.description === 'string' ? node.description.trim() : '';
                if (!description) return null;
                const title = typeof node.title === 'string' ? node.title.trim() : '';
                const agentDefinitionId = typeof node.agentDefinitionId === 'string'
                  ? node.agentDefinitionId.trim()
                  : '';
                return {
                  ...(title ? { title } : {}),
                  description,
                  ...(agentDefinitionId ? { agentDefinitionId } : {}),
                };
              })
              .filter((node): node is { title?: string; description: string; agentDefinitionId?: string } => Boolean(node)),
          }
        : {}),
    })),
  };

  return { ok: true, data };
}

/** 打开文件选择器并读取 JSON 文件内容 */
export function openPipelineFile(options?: { maxFileSizeBytes?: number }): Promise<OpenPipelineFileResult> {
  const maxFileSizeBytes = options?.maxFileSizeBytes ?? DEFAULT_MAX_PIPELINE_IMPORT_FILE_SIZE_BYTES;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve({ ok: false, cancelled: true });
        return;
      }

      const fileSizeCheck = validatePipelineImportFileSize(file.size, maxFileSizeBytes);
      if (!fileSizeCheck.ok) {
        resolve({ ok: false, error: fileSizeCheck.error });
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const content = typeof reader.result === 'string' ? reader.result : '';
        resolve({ ok: true, content });
      };
      reader.onerror = () => resolve({ ok: false, error: '文件读取失败，请重试' });
      reader.readAsText(file);
    };

    // 用户取消文件选择
    input.oncancel = () => resolve({ ok: false, cancelled: true });

    input.click();
  });
}
