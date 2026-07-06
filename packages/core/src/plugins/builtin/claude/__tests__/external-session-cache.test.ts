import { describe, it, expect, beforeEach } from 'vitest';
import { getCached, setCached, clearExternalSessionCache } from '../external-session-cache.js';
import type { ExternalSession } from '@qlan-ro/mainframe-types';

const meta: ExternalSession = {
  sessionId: 'a',
  adapterId: 'claude',
  projectPath: '/p',
  createdAt: 'x',
  modifiedAt: 'x',
};

describe('external-session-cache', () => {
  beforeEach(() => clearExternalSessionCache());

  it('returns the cached meta for the same mtime+size', () => {
    setCached('a', 100, 50, meta);
    expect(getCached('a', 100, 50)).toEqual(meta);
  });

  it('misses when mtime changes', () => {
    setCached('a', 100, 50, meta);
    expect(getCached('a', 200, 50)).toBeNull();
  });

  it('misses when size changes', () => {
    setCached('a', 100, 50, meta);
    expect(getCached('a', 100, 99)).toBeNull();
  });

  it('clear() empties the cache', () => {
    setCached('a', 100, 50, meta);
    clearExternalSessionCache();
    expect(getCached('a', 100, 50)).toBeNull();
  });
});
