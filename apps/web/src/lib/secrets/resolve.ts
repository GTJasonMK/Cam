// ============================================================
// Secrets 解析：按 Repo / Agent 维度解析出最终注入的环境变量值
// 优先级（高 -> 低）：
// 1) repo + agent
// 2) repo
// 3) agent
// 4) global
// 5) process.env
// ============================================================

import { db } from '@/lib/db';
import { secrets, repositories } from '@/lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { decryptSecretValue, isMasterKeyPresent } from '@/lib/secrets/crypto';

export type SecretScope = {
  repositoryId?: string | null;
  repoUrl?: string | null;
  agentDefinitionId?: string | null;
};

async function resolveRepositoryId(input: { repositoryId?: string | null; repoUrl?: string | null }): Promise<string | null> {
  if (input.repositoryId) return input.repositoryId;
  const repoUrl = (input.repoUrl || '').trim();
  if (!repoUrl) return null;

  const repo = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.repoUrl, repoUrl))
    .limit(1);

  return repo[0]?.id || null;
}

async function selectSecretEncryptedValue(name: string, repositoryId: string | null, agentDefinitionId: string | null): Promise<string | null> {
  const conds = [eq(secrets.name, name)];

  if (repositoryId) {
    conds.push(eq(secrets.repositoryId, repositoryId));
  } else {
    conds.push(isNull(secrets.repositoryId));
  }

  if (agentDefinitionId) {
    conds.push(eq(secrets.agentDefinitionId, agentDefinitionId));
  } else {
    conds.push(isNull(secrets.agentDefinitionId));
  }

  const row = await db
    .select({ valueEncrypted: secrets.valueEncrypted })
    .from(secrets)
    .where(and(...conds))
    .limit(1);

  return row[0]?.valueEncrypted || null;
}

/** 判断 Secret 是否“可用”（存在且当前服务配置了 CAM_MASTER_KEY） */
export async function hasUsableSecretValue(name: string, scope: SecretScope): Promise<boolean> {
  if (!name) return false;
  if (!isMasterKeyPresent()) return false;

  const repositoryId = await resolveRepositoryId(scope);
  const agentDefinitionId = scope.agentDefinitionId || null;

  // 不解密，纯存在性检查：按优先级短路
  if (repositoryId && agentDefinitionId) {
    const v = await selectSecretEncryptedValue(name, repositoryId, agentDefinitionId);
    if (v) return true;
  }
  if (repositoryId) {
    const v = await selectSecretEncryptedValue(name, repositoryId, null);
    if (v) return true;
  }
  if (agentDefinitionId) {
    const v = await selectSecretEncryptedValue(name, null, agentDefinitionId);
    if (v) return true;
  }
  const v = await selectSecretEncryptedValue(name, null, null);
  return Boolean(v);
}

/** 解析 Secret 明文（若不存在或无法解密则返回 null） */
export async function resolveSecretValue(name: string, scope: SecretScope): Promise<string | null> {
  if (!name) return null;
  if (!isMasterKeyPresent()) return null;

  const repositoryId = await resolveRepositoryId(scope);
  const agentDefinitionId = scope.agentDefinitionId || null;

  const candidates: Array<{ repositoryId: string | null; agentDefinitionId: string | null }> = [];
  if (repositoryId && agentDefinitionId) candidates.push({ repositoryId, agentDefinitionId });
  if (repositoryId) candidates.push({ repositoryId, agentDefinitionId: null });
  if (agentDefinitionId) candidates.push({ repositoryId: null, agentDefinitionId });
  candidates.push({ repositoryId: null, agentDefinitionId: null });

  for (const c of candidates) {
    const encrypted = await selectSecretEncryptedValue(name, c.repositoryId, c.agentDefinitionId);
    if (!encrypted) continue;
    try {
      return decryptSecretValue(encrypted);
    } catch {
      return null;
    }
  }

  return null;
}

/** 解析最终注入值：优先 Secret，其次 process.env */
export async function resolveEnvVarValue(name: string, scope: SecretScope): Promise<string | null> {
  const secret = await resolveSecretValue(name, scope);
  if (secret && secret.trim().length > 0) return secret;

  const env = process.env[name];
  if (typeof env === 'string' && env.trim().length > 0) return env;
  return null;
}

