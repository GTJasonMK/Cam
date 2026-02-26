import { isPlainObject } from '../validation/objects.ts';
import { normalizeTrimmedString } from '../validation/strings.ts';

export type ClaudeAuthStatus = {
  loggedIn: boolean;
  authMethod: string;
  apiProvider: string;
};

export type WorkerRuntimeMode = 'daemon' | 'task' | 'unknown';

export function parseWorkerMode(value: unknown): WorkerRuntimeMode;
export function parseWorkerMode(
  value: unknown,
  options: { allowUndefinedAsNull: true },
): WorkerRuntimeMode | null;
export function parseWorkerMode(
  value: unknown,
  options?: { allowUndefinedAsNull?: boolean },
): WorkerRuntimeMode | null {
  if (value === undefined && options?.allowUndefinedAsNull) return null;
  const raw = normalizeTrimmedString(value).toLowerCase();
  if (raw === 'daemon') return 'daemon';
  if (raw === 'task') return 'task';
  return 'unknown';
}

export function parseReportedEnvVars(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return [];

  const out: string[] = [];
  for (const item of value) {
    const name = normalizeTrimmedString(item);
    if (!name) continue;
    // 仅允许常见 env var 命名，避免注入奇怪字符导致 UI/日志混乱
    if (!/^[A-Z0-9_]{2,100}$/.test(name)) continue;
    out.push(name);
    if (out.length >= 200) break;
  }
  return Array.from(new Set(out)).sort();
}

export function parseClaudeAuthStatus(value: unknown): ClaudeAuthStatus | null | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return null;

  const loggedIn = value.loggedIn;
  if (typeof loggedIn !== 'boolean') return null;

  const authMethod = normalizeTrimmedString(value.authMethod);
  const apiProvider = normalizeTrimmedString(value.apiProvider);

  return {
    loggedIn,
    authMethod: authMethod.slice(0, 50),
    apiProvider: apiProvider.slice(0, 50),
  };
}
