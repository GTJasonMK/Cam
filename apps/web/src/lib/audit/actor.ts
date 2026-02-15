import { NextRequest } from 'next/server';

function normalizeHeader(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getRequestIp(request: NextRequest): string {
  const forwardedFor = normalizeHeader(request.headers.get('x-forwarded-for'));
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  return normalizeHeader(request.headers.get('x-real-ip')) || 'unknown';
}

export function resolveAuditActor(request: NextRequest): string {
  const explicit = normalizeHeader(request.headers.get('x-cam-actor'));
  if (explicit) return explicit;

  const userAgent = normalizeHeader(request.headers.get('user-agent'));
  const ip = getRequestIp(request);
  if (userAgent) {
    const shortUA = userAgent.length > 80 ? `${userAgent.slice(0, 80)}...` : userAgent;
    return `ip:${ip} ua:${shortUA}`;
  }
  return `ip:${ip}`;
}
