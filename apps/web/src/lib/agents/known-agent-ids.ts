function normalizeAgentIds(source: Iterable<string>): string[] {
  const ids = new Set<string>();
  for (const id of source) {
    const normalized = id.trim();
    if (normalized) ids.add(normalized);
  }
  return Array.from(ids);
}

/**
 * 解析导入校验可用的 Agent ID 集合。
 * 优先使用本地列表，并尝试补拉一次服务端最新数据，避免本地缓存过期导致误拦截。
 */
export async function resolveKnownAgentIdsForImport(seedAgentIds: Iterable<string>): Promise<string[]> {
  const seed = normalizeAgentIds(seedAgentIds);
  const known = new Set(seed);

  try {
    const res = await fetch('/api/agents');
    const json = await res.json().catch(() => null);
    if (json?.success && Array.isArray(json.data)) {
      for (const item of json.data as Array<{ id?: unknown }>) {
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
