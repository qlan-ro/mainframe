import type { ExternalSession } from '@qlan-ro/mainframe-types';

interface Entry {
  mtimeMs: number;
  size: number;
  meta: ExternalSession;
}

// Process-lifetime cache; keyed by sessionId, validated by mtime+size.
const cache = new Map<string, Entry>();

export function getCached(sessionId: string, mtimeMs: number, size: number): ExternalSession | null {
  const e = cache.get(sessionId);
  if (!e || e.mtimeMs !== mtimeMs || e.size !== size) return null;
  return e.meta;
}

export function setCached(sessionId: string, mtimeMs: number, size: number, meta: ExternalSession): void {
  cache.set(sessionId, { mtimeMs, size, meta });
}

export function clearExternalSessionCache(): void {
  cache.clear();
}
