// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock electron's safeStorage with an identity codec so the test is deterministic.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8'),
  },
}));

import { readRegistry, writeRegistry, setToken, getToken, removeDaemon } from '../daemons-store.js';

describe('electron daemons-store', () => {
  beforeEach(() => {
    process.env['MAINFRAME_DATA_DIR'] = `/tmp/mf-el-${process.pid}-${Math.floor(performance.now())}`;
  });

  it('round-trips registry metadata without tokens', async () => {
    await writeRegistry([{ id: 'studio', kind: 'remote', label: 'Studio', host: 'studio.example.com' }]);
    const back = await readRegistry();
    expect(back).toHaveLength(1);
    expect(back[0]!.id).toBe('studio');
    expect(JSON.stringify(back)).not.toContain('token');
  });

  it('encrypts + retrieves a token, and remove drops both', async () => {
    await writeRegistry([{ id: 'studio', kind: 'remote', label: 'Studio', host: 'studio.example.com' }]);
    await setToken('studio', 'jwt-abc');
    expect(await getToken('studio')).toBe('jwt-abc');
    await removeDaemon('studio');
    expect(await getToken('studio')).toBeNull();
    expect(await readRegistry()).toHaveLength(0);
  });

  it('returns empty array when registry file is missing', async () => {
    const result = await readRegistry();
    expect(result).toEqual([]);
  });

  it('returns null for getToken when id does not exist', async () => {
    expect(await getToken('nonexistent')).toBeNull();
  });
});
