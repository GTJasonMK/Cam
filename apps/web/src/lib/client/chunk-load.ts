export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = String((error as { message?: unknown }).message || '');
  const name = String((error as { name?: unknown }).name || '');
  return (
    name.includes('ChunkLoadError')
    || message.includes('ChunkLoadError')
    || message.includes('Loading chunk')
    || message.includes('CSS_CHUNK_LOAD_FAILED')
  );
}

const CHUNK_RELOAD_ONCE_KEY = '__cam_chunk_reload_once__';

export function tryReloadOnceForChunkError(error: unknown): boolean {
  if (typeof window === 'undefined') return false;
  if (!isChunkLoadError(error)) return false;

  try {
    const attempted = window.sessionStorage.getItem(CHUNK_RELOAD_ONCE_KEY);
    if (attempted) return false;
    window.sessionStorage.setItem(CHUNK_RELOAD_ONCE_KEY, String(Date.now()));
  } catch {
    // ignore storage errors
  }

  window.location.reload();
  return true;
}

export function clearChunkReloadMarker(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_ONCE_KEY);
  } catch {
    // ignore storage errors
  }
}

