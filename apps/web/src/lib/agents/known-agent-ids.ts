import { normalizeAgentIds } from './normalize-agent-ids.ts';
import { readApiEnvelope } from '../http/client-response.ts';

/**
 * 解析导入校验可用的 Agent ID 集合。
 * 优先使用本地列表，并尝试补拉一次服务端最新数据，避免本地缓存过期导致误拦截。
 */
export async function resolveKnownAgentIdsForImport(seedAgentIds: Iterable<string>): Promise<string[]> {
  const seed = normalizeAgentIds(seedAgentIds);
  const known = new Set(seed);

  try {
    const res = await fetch('/api/agents');
    const json = await readApiEnvelope<Array<{ id?: unknown }>>(res);
    if (json?.success && Array.isArray(json.data)) {
      for (const item of json.data) {
        if (typeof item.id !== 'string') continue;
        const id = item.id.trim();
        if (id) known.add(id);
      }
    }
  } catch {
    // 网络异常时保底使用本地已知列表
  }

  return Array.from(known);
}
