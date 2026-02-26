export function normalizeAgentIds(source: Iterable<unknown>): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const id of source) {
    if (typeof id !== 'string') continue;
    const value = id.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized;
}
