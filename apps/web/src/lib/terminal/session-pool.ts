import crypto from 'node:crypto';
import { normalizeHostPathInput } from './path-normalize.ts';
import { normalizeOptionalString } from '../validation/strings.ts';

export interface SessionPoolUpsertInput {
  sessionKey?: string;
  repoPath?: string;
  agentDefinitionId?: string;
  mode?: 'resume' | 'continue';
  resumeSessionId?: string;
  source?: 'external' | 'managed';
  title?: string;
}

export interface SessionPoolUpsertPayload {
  workDir?: string;
  sessions?: SessionPoolUpsertInput[];
}

export interface NormalizedSessionPoolUpsert {
  sessionKey: string;
  repoPath: string;
  agentDefinitionId: string;
  mode: 'resume' | 'continue';
  resumeSessionId?: string;
  source: 'external' | 'managed';
  title?: string;
}

export function buildDefaultSessionKey(input: {
  repoPath: string;
  agentDefinitionId: string;
  mode: 'resume' | 'continue';
  resumeSessionId?: string;
}): string {
  const repoHash = crypto.createHash('sha1').update(input.repoPath).digest('hex').slice(0, 10);
  const resumePart = input.resumeSessionId ? input.resumeSessionId : 'continue';
  return `${input.agentDefinitionId}:${resumePart}:${repoHash}`;
}

export function normalizeSessionPoolUpsertPayload(
  payload: SessionPoolUpsertPayload
): NormalizedSessionPoolUpsert[] {
  if (!Array.isArray(payload.sessions) || payload.sessions.length === 0) {
    throw new Error('sessions 不能为空');
  }

  const fallbackRepoPathRaw = normalizeOptionalString(payload.workDir) ?? '';
  const fallbackRepoPath = fallbackRepoPathRaw ? normalizeHostPathInput(fallbackRepoPathRaw) : '';
  return payload.sessions.map((item) => {
    const repoPathRaw = normalizeOptionalString(item.repoPath) ?? fallbackRepoPath;
    const repoPath = repoPathRaw ? normalizeHostPathInput(repoPathRaw) : '';
    const agentDefinitionId = normalizeOptionalString(item.agentDefinitionId) ?? '';
    const mode = item.mode;
    const resumeSessionId = normalizeOptionalString(item.resumeSessionId) ?? undefined;
    const source = item.source === 'managed' ? 'managed' : 'external';
    const title = normalizeOptionalString(item.title) ?? undefined;

    if (!repoPath) {
      throw new Error('缺少 repoPath/workDir');
    }
    if (!agentDefinitionId) {
      throw new Error('缺少 agentDefinitionId');
    }
    if (mode !== 'resume' && mode !== 'continue') {
      throw new Error('mode 仅支持 resume/continue');
    }
    if (mode === 'resume' && !resumeSessionId) {
      throw new Error('resume 模式必须提供 resumeSessionId');
    }

    const sessionKey = normalizeOptionalString(item.sessionKey) || buildDefaultSessionKey({
      repoPath,
      agentDefinitionId,
      mode,
      ...(resumeSessionId ? { resumeSessionId } : {}),
    });

    return {
      sessionKey,
      repoPath,
      agentDefinitionId,
      mode,
      ...(resumeSessionId ? { resumeSessionId } : {}),
      source,
      ...(title ? { title } : {}),
    };
  });
}
