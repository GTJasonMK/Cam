export type JsonReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export async function tryReadJsonBody<T>(request: Request): Promise<JsonReadResult<T>> {
  try {
    return { ok: true, value: (await request.json()) as T };
  } catch (error) {
    return { ok: false, error };
  }
}

export async function readJsonBodyOrDefault<T>(request: Request, defaultValue: T): Promise<T> {
  const parsed = await tryReadJsonBody<T>(request);
  return parsed.ok ? parsed.value : defaultValue;
}

export async function readJsonBodyAsRecord(request: Request): Promise<Record<string, unknown>> {
  return readJsonBodyOrDefault<Record<string, unknown>>(request, {});
}
