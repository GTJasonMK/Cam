import { basename } from 'node:path';

export function sanitizeTerminalEntryName(rawName: string): string | null {
  const safeName = basename((rawName || '').replace(/\\/g, '/')).trim();
  if (!safeName || safeName === '.' || safeName === '..' || safeName.includes('\0')) {
    return null;
  }
  return safeName;
}

