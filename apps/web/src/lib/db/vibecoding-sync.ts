// ============================================================
// vibecoding 基础提示词/流水线启动同步
// 目标：每次服务启动时，自动校对内置 vibecoding 目录并同步到 task_templates
// ============================================================

import { createHash } from 'node:crypto';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, type InferSelectModel } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agentDefinitions, taskTemplates } from '@/lib/db/schema';
import { normalizeOptionalString } from '@/lib/validation/strings';
import { isSqliteMissingSchemaError } from './sqlite-errors';

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

type ManagedTemplate = {
  id: string;
  name: string;
  titleTemplate: string;
  promptTemplate: string;
  agentDefinitionId: string | null;
  repositoryId: null;
  repoUrl: string | null;
  baseBranch: string | null;
  workDir: string | null;
  pipelineSteps: PipelineStep[] | null;
  maxRetries: number;
};

type VibeIndexItem = {
  name?: unknown;
  pipelineFile?: unknown;
};

type VibePipelineFile = {
  name?: unknown;
  agentDefinitionId?: unknown;
  repoUrl?: unknown;
  baseBranch?: unknown;
  workDir?: unknown;
  maxRetries?: unknown;
  steps?: unknown;
};

const PROMPT_ID_PREFIX = 'vibe-prompt-';
const PIPELINE_ID_PREFIX = 'vibe-pipeline-';
const MANAGED_ID_PREFIX = 'vibe-';
const DEFAULT_AGENT_ID = 'codex';

export type VibecodingSyncResult = {
  sourceDir: string;
  promptsDiscovered: number;
  pipelinesDiscovered: number;
  inserted: number;
  updated: number;
  deleted: number;
  unchanged: number;
  syncedAt: string;
  skipped?: string;
};

let syncOncePromise: Promise<VibecodingSyncResult | null> | null = null;

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\uFEFF/g, '');
}

function normalizeMaxRetries(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 2;
  return Math.max(0, Math.min(20, Math.floor(value)));
}

function normalizeInputFiles(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const files = new Set<string>();
  for (const item of value) {
    const normalized = normalizeOptionalString(item);
    if (normalized) files.add(normalized);
  }
  const list = Array.from(files);
  return list.length > 0 ? list : undefined;
}

function normalizePipelineStep(raw: unknown): PipelineStep | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const step = raw as Record<string, unknown>;
  const title = normalizeOptionalString(step.title);
  const description = normalizeOptionalString(step.description);
  if (!title || !description) return null;

  const normalized: PipelineStep = {
    title,
    description,
  };

  const agentDefinitionId = normalizeOptionalString(step.agentDefinitionId);
  if (agentDefinitionId) normalized.agentDefinitionId = agentDefinitionId;

  const inputFiles = normalizeInputFiles(step.inputFiles);
  if (inputFiles) normalized.inputFiles = inputFiles;

  const inputCondition = normalizeOptionalString(step.inputCondition);
  if (inputCondition) normalized.inputCondition = inputCondition;

  if (Array.isArray(step.parallelAgents)) {
    const parallelAgents: PipelineParallelAgent[] = [];
    for (const node of step.parallelAgents) {
      if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
      const rawNode = node as Record<string, unknown>;
      const nodeDescription = normalizeOptionalString(rawNode.description);
      if (!nodeDescription) continue;
      const nodeTitle = normalizeOptionalString(rawNode.title);
      const nodeAgentDefinitionId = normalizeOptionalString(rawNode.agentDefinitionId);
      parallelAgents.push({
        ...(nodeTitle ? { title: nodeTitle } : {}),
        description: nodeDescription,
        ...(nodeAgentDefinitionId ? { agentDefinitionId: nodeAgentDefinitionId } : {}),
      });
    }
    if (parallelAgents.length > 0) {
      normalized.parallelAgents = parallelAgents;
    }
  }

  return normalized;
}

function normalizeRelativePathForHash(input: string): string {
  return input.replace(/\\/g, '/');
}

function buildStableTemplateId(kind: 'prompt' | 'pipeline', sourceKey: string): string {
  const normalized = normalizeRelativePathForHash(sourceKey);
  const digest = createHash('sha1')
    .update(`${kind}:${normalized}`)
    .digest('hex')
    .slice(0, 20);
  return kind === 'prompt' ? `${PROMPT_ID_PREFIX}${digest}` : `${PIPELINE_ID_PREFIX}${digest}`;
}

function pickPromptTemplateName(content: string, relativePath: string): string {
  const firstHeading = content
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '));
  const fallback = path.basename(relativePath, '.txt');
  const category = path.basename(path.dirname(relativePath));
  const title = firstHeading ? firstHeading.slice(2).trim() : fallback;
  return `Vibe｜${category}｜${title || fallback}`;
}

function canonicalizePipelineSteps(steps: PipelineStep[] | null): string {
  return JSON.stringify(steps ?? null);
}

function isManagedTemplateId(templateId: string): boolean {
  return templateId.startsWith(MANAGED_ID_PREFIX);
}

function isTemplateChanged(
  existing: {
    name: string;
    titleTemplate: string;
    promptTemplate: string;
    agentDefinitionId: string | null;
    repositoryId: string | null;
    repoUrl: string | null;
    baseBranch: string | null;
    workDir: string | null;
    pipelineSteps: PipelineStep[] | null;
    maxRetries: number | null;
  },
  next: ManagedTemplate
): boolean {
  return (
    existing.name !== next.name
    || existing.titleTemplate !== next.titleTemplate
    || existing.promptTemplate !== next.promptTemplate
    || existing.agentDefinitionId !== next.agentDefinitionId
    || existing.repositoryId !== next.repositoryId
    || existing.repoUrl !== next.repoUrl
    || existing.baseBranch !== next.baseBranch
    || existing.workDir !== next.workDir
    || (existing.maxRetries ?? 2) !== next.maxRetries
    || canonicalizePipelineSteps(existing.pipelineSteps) !== canonicalizePipelineSteps(next.pipelineSteps)
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveVibecodingDir(): Promise<string | null> {
  const envDir = process.env.CAM_VIBECODING_DIR?.trim();
  const candidates = [
    envDir || null,
    // 新的默认内置目录（优先）
    path.resolve(process.cwd(), 'builtin', 'vibecoding'),
    path.resolve(process.cwd(), 'apps', 'web', 'builtin', 'vibecoding'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const promptsByDemandDir = path.join(candidate, 'prompts', 'by-demand');
    const pipelineIndexFile = path.join(candidate, 'pipelines', 'cam-import', 'index.json');
    // 必须同时满足提示词目录 + 流水线索引存在
    if (await pathExists(promptsByDemandDir) && await pathExists(pipelineIndexFile)) {
      return candidate;
    }
  }

  return null;
}

async function listPromptFilesRecursively(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await listPromptFilesRecursively(fullPath);
      files.push(...nested);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.txt')) continue;
    files.push(fullPath);
  }

  files.sort((a, b) => a.localeCompare(b, 'zh-CN'));
  return files;
}

function sanitizeAgentId(
  agentId: string | null,
  knownAgentIds: Set<string>,
  fallbackAgentId: string | null
): string | null {
  if (!agentId) return fallbackAgentId;
  return knownAgentIds.has(agentId) ? agentId : fallbackAgentId;
}

function sanitizePipelineStepsAgentIds(
  steps: PipelineStep[],
  knownAgentIds: Set<string>
): PipelineStep[] {
  return steps.map((step) => {
    const stepAgentId = step.agentDefinitionId && knownAgentIds.has(step.agentDefinitionId)
      ? step.agentDefinitionId
      : undefined;
    const parallelAgents = step.parallelAgents?.map((node) => ({
      ...(node.title ? { title: node.title } : {}),
      description: node.description,
      ...(node.agentDefinitionId && knownAgentIds.has(node.agentDefinitionId)
        ? { agentDefinitionId: node.agentDefinitionId }
        : {}),
    }));
    return {
      title: step.title,
      description: step.description,
      ...(stepAgentId ? { agentDefinitionId: stepAgentId } : {}),
      ...(step.inputFiles && step.inputFiles.length > 0 ? { inputFiles: step.inputFiles } : {}),
      ...(step.inputCondition ? { inputCondition: step.inputCondition } : {}),
      ...(parallelAgents && parallelAgents.length > 0 ? { parallelAgents } : {}),
    };
  });
}

async function collectManagedPromptTemplates(
  vibeDir: string,
  knownAgentIds: Set<string>,
  fallbackAgentId: string | null
): Promise<ManagedTemplate[]> {
  const promptRootDir = path.join(vibeDir, 'prompts', 'by-demand');
  const files = await listPromptFilesRecursively(promptRootDir);

  const templates: ManagedTemplate[] = [];
  for (const file of files) {
    const relativePath = normalizeRelativePathForHash(path.relative(vibeDir, file));
    const rawContent = await readFile(file, 'utf8');
    const content = normalizeLineEndings(rawContent).trim();
    if (!content) continue;

    const name = pickPromptTemplateName(content, relativePath);
    const preferredAgent = sanitizeAgentId(DEFAULT_AGENT_ID, knownAgentIds, fallbackAgentId);
    templates.push({
      id: buildStableTemplateId('prompt', relativePath),
      name,
      titleTemplate: name,
      promptTemplate: content,
      agentDefinitionId: preferredAgent,
      repositoryId: null,
      repoUrl: null,
      baseBranch: null,
      workDir: null,
      pipelineSteps: null,
      maxRetries: 2,
    });
  }

  return templates;
}

async function collectManagedPipelineTemplates(
  vibeDir: string,
  knownAgentIds: Set<string>,
  fallbackAgentId: string | null
): Promise<ManagedTemplate[]> {
  const indexPath = path.join(vibeDir, 'pipelines', 'cam-import', 'index.json');
  const rawIndex = await readFile(indexPath, 'utf8');
  const parsedIndex = JSON.parse(rawIndex) as { items?: unknown };
  const indexItems = Array.isArray(parsedIndex.items) ? parsedIndex.items as VibeIndexItem[] : [];

  const templates: ManagedTemplate[] = [];
  for (const item of indexItems) {
    const pipelineFileRel = normalizeOptionalString(item.pipelineFile);
    if (!pipelineFileRel) continue;

    const pipelineAbsPath = path.join(vibeDir, pipelineFileRel);
    const rawPipeline = await readFile(pipelineAbsPath, 'utf8');
    const parsedPipeline = JSON.parse(rawPipeline) as VibePipelineFile;
    const stepsRaw = Array.isArray(parsedPipeline.steps) ? parsedPipeline.steps : [];
    const steps = stepsRaw
      .map((step) => normalizePipelineStep(step))
      .filter((step): step is PipelineStep => Boolean(step));
    if (steps.length === 0) continue;

    const nameFromFile = normalizeOptionalString(parsedPipeline.name);
    const nameFromIndex = normalizeOptionalString(item.name);
    const name = `Vibe｜${nameFromFile || nameFromIndex || path.basename(pipelineFileRel, '.json')}`;
    const pipelineAgent = sanitizeAgentId(
      normalizeOptionalString(parsedPipeline.agentDefinitionId),
      knownAgentIds,
      fallbackAgentId
    );

    templates.push({
      id: buildStableTemplateId('pipeline', normalizeRelativePathForHash(pipelineFileRel)),
      name,
      titleTemplate: '(vibecoding 流水线模板)',
      promptTemplate: '(vibecoding 流水线模板)',
      agentDefinitionId: pipelineAgent,
      repositoryId: null,
      repoUrl: normalizeOptionalString(parsedPipeline.repoUrl),
      baseBranch: normalizeOptionalString(parsedPipeline.baseBranch),
      workDir: normalizeOptionalString(parsedPipeline.workDir),
      pipelineSteps: sanitizePipelineStepsAgentIds(steps, knownAgentIds),
      maxRetries: normalizeMaxRetries(parsedPipeline.maxRetries),
    });
  }

  return templates;
}

export async function syncVibecodingTaskTemplates(): Promise<VibecodingSyncResult | null> {
  if (process.env.CAM_DISABLE_VIBECODING_SYNC === '1') {
    console.log('[VibeSync] 已通过 CAM_DISABLE_VIBECODING_SYNC=1 禁用同步');
    return null;
  }

  const vibeDir = await resolveVibecodingDir();
  if (!vibeDir) {
    console.warn('[VibeSync] 未找到 vibecoding 目录，跳过基础模板同步');
    return null;
  }

  let knownAgentIds = new Set<string>();
  let fallbackAgentId: string | null = null;

  try {
    const agentRows = await db
      .select({ id: agentDefinitions.id })
      .from(agentDefinitions);
    knownAgentIds = new Set(agentRows.map((row) => row.id));
    if (knownAgentIds.has(DEFAULT_AGENT_ID)) {
      fallbackAgentId = DEFAULT_AGENT_ID;
    } else {
      fallbackAgentId = agentRows[0]?.id ?? null;
    }
  } catch (error) {
    if (isSqliteMissingSchemaError(error)) {
      console.warn('[VibeSync] 数据库未完成迁移（agent_definitions 缺失），跳过同步');
      return {
        sourceDir: vibeDir,
        promptsDiscovered: 0,
        pipelinesDiscovered: 0,
        inserted: 0,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        syncedAt: new Date().toISOString(),
        skipped: 'missing-table:agent_definitions',
      };
    }
    throw error;
  }

  const [promptTemplates, pipelineTemplates] = await Promise.all([
    collectManagedPromptTemplates(vibeDir, knownAgentIds, fallbackAgentId),
    collectManagedPipelineTemplates(vibeDir, knownAgentIds, fallbackAgentId),
  ]);
  const desiredTemplates = [...promptTemplates, ...pipelineTemplates];

  let existingRows: Array<InferSelectModel<typeof taskTemplates>> = [];
  try {
    existingRows = await db.select().from(taskTemplates);
  } catch (error) {
    if (isSqliteMissingSchemaError(error)) {
      console.warn('[VibeSync] 数据库未完成迁移（task_templates 缺失），跳过同步');
      return {
        sourceDir: vibeDir,
        promptsDiscovered: promptTemplates.length,
        pipelinesDiscovered: pipelineTemplates.length,
        inserted: 0,
        updated: 0,
        deleted: 0,
        unchanged: 0,
        syncedAt: new Date().toISOString(),
        skipped: 'missing-table:task_templates',
      };
    }
    throw error;
  }

  const managedExistingRows = existingRows.filter((row) => isManagedTemplateId(row.id));
  const existingById = new Map(managedExistingRows.map((row) => [row.id, row]));
  const desiredById = new Map(desiredTemplates.map((row) => [row.id, row]));

  const toInsert: ManagedTemplate[] = [];
  const toUpdate: ManagedTemplate[] = [];
  const toDeleteIds: string[] = [];
  let unchanged = 0;

  for (const desired of desiredTemplates) {
    const current = existingById.get(desired.id);
    if (!current) {
      toInsert.push(desired);
      continue;
    }
    if (isTemplateChanged(current, desired)) {
      toUpdate.push(desired);
    } else {
      unchanged += 1;
    }
  }

  for (const row of managedExistingRows) {
    if (!desiredById.has(row.id)) {
      toDeleteIds.push(row.id);
    }
  }

  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const item of toInsert) {
      tx.insert(taskTemplates).values({
        ...item,
        createdAt: now,
        updatedAt: now,
      }).run();
    }
    for (const item of toUpdate) {
      tx.update(taskTemplates).set({
        name: item.name,
        titleTemplate: item.titleTemplate,
        promptTemplate: item.promptTemplate,
        agentDefinitionId: item.agentDefinitionId,
        repositoryId: item.repositoryId,
        repoUrl: item.repoUrl,
        baseBranch: item.baseBranch,
        workDir: item.workDir,
        pipelineSteps: item.pipelineSteps,
        maxRetries: item.maxRetries,
        updatedAt: now,
      }).where(eq(taskTemplates.id, item.id)).run();
    }
    for (const id of toDeleteIds) {
      tx.delete(taskTemplates).where(eq(taskTemplates.id, id)).run();
    }
  });

  const result: VibecodingSyncResult = {
    sourceDir: vibeDir,
    promptsDiscovered: promptTemplates.length,
    pipelinesDiscovered: pipelineTemplates.length,
    inserted: toInsert.length,
    updated: toUpdate.length,
    deleted: toDeleteIds.length,
    unchanged,
    syncedAt: now,
  };

  console.log(
    `[VibeSync] 同步完成: prompts=${result.promptsDiscovered}, pipelines=${result.pipelinesDiscovered}, inserted=${result.inserted}, updated=${result.updated}, deleted=${result.deleted}, unchanged=${result.unchanged}`
  );

  return result;
}

/** 进程生命周期内只执行一次，避免多入口重复启动时并发同步 */
export function ensureVibecodingTaskTemplatesSynced(): Promise<VibecodingSyncResult | null> {
  if (!syncOncePromise) {
    syncOncePromise = syncVibecodingTaskTemplates();
  }
  return syncOncePromise;
}
