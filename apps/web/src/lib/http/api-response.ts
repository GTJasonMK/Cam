import { NextResponse } from 'next/server.js';

type ApiErrorExtra = Record<string, unknown>;

export function apiSuccess<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ success: true, data }, init);
}

export function apiMessageSuccess(message: string, init?: ResponseInit): NextResponse {
  return NextResponse.json({ success: true, message }, init);
}

export function apiCreated<T>(data: T): NextResponse {
  return apiSuccess(data, { status: 201 });
}

export function apiError(
  code: string,
  message: string,
  options?: {
    status?: number;
    extra?: ApiErrorExtra;
  },
): NextResponse {
  const error = options?.extra
    ? { code, message, ...options.extra }
    : { code, message };

  return NextResponse.json(
    { success: false, error },
    { status: options?.status ?? 500 },
  );
}

export function apiBadRequest(message: string, extra?: ApiErrorExtra): NextResponse {
  return apiError('INVALID_INPUT', message, { status: 400, extra });
}

export function apiInvalidJson(message = '请求体 JSON 解析失败', extra?: ApiErrorExtra): NextResponse {
  return apiError('INVALID_JSON', message, { status: 400, extra });
}

export function apiNotFound(message: string, extra?: ApiErrorExtra): NextResponse {
  return apiError('NOT_FOUND', message, { status: 404, extra });
}

export function apiConflict(
  message: string,
  options?: {
    code?: string;
    extra?: ApiErrorExtra;
  },
): NextResponse {
  return apiError(options?.code || 'STATE_CONFLICT', message, {
    status: 409,
    extra: options?.extra,
  });
}

export function apiInternalError(message: string, extra?: ApiErrorExtra): NextResponse {
  return apiError('INTERNAL_ERROR', message, { status: 500, extra });
}
