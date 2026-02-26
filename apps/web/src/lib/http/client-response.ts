export type ClientApiEnvelope<T> = {
  success?: boolean;
  data?: T;
  error?: {
    message?: string;
    missingEnvVars?: unknown;
  };
};

export async function readApiEnvelope<T>(response: Response): Promise<ClientApiEnvelope<T> | null> {
  return response.json().catch(() => null);
}

export function resolveApiErrorMessage(
  response: Response,
  payload: ClientApiEnvelope<unknown> | null,
  fallback: string,
): string {
  if (payload?.error?.message) return payload.error.message;
  return response.ok ? fallback : `HTTP ${response.status}`;
}

export function resolveMissingEnvVars(payload: ClientApiEnvelope<unknown> | null): string[] | undefined {
  const raw = payload?.error?.missingEnvVars;
  if (!Array.isArray(raw)) return undefined;
  const normalized = raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return normalized.length > 0 ? normalized : undefined;
}
