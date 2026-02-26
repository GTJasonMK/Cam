export function getRequestIpAddress(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  return 'unknown';
}

export function getRequestUserAgent(request: Request): string | undefined {
  const userAgent = request.headers.get('user-agent')?.trim();
  return userAgent || undefined;
}

export function getRequestClientInfo(request: Request): { ipAddress: string; userAgent?: string } {
  return {
    ipAddress: getRequestIpAddress(request),
    userAgent: getRequestUserAgent(request),
  };
}
