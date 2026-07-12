import { describe, it, expect, vi } from 'vitest';
import { resolveCloudflaredPath } from '../../tunnel/resolve-cloudflared.js';

describe('resolveCloudflaredPath', () => {
  it('returns the first PATH entry that holds an executable cloudflared', async () => {
    const isExecutable = vi.fn(async (p: string) => p === '/opt/homebrew/bin/cloudflared');
    const result = await resolveCloudflaredPath({
      path: '/usr/bin:/opt/homebrew/bin:/sbin',
      platform: 'darwin',
      isExecutable,
    });
    expect(result).toBe('/opt/homebrew/bin/cloudflared');
  });

  it('prefers earlier PATH entries (bundled dir prepended wins)', async () => {
    const isExecutable = vi.fn(async () => true);
    const result = await resolveCloudflaredPath({
      path: '/home/user/.mainframe/bin/bin:/opt/homebrew/bin',
      platform: 'linux',
      isExecutable,
    });
    expect(result).toBe('/home/user/.mainframe/bin/bin/cloudflared');
  });

  it('returns null when cloudflared is not found on PATH', async () => {
    const result = await resolveCloudflaredPath({
      path: '/usr/bin:/bin',
      platform: 'darwin',
      isExecutable: async () => false,
    });
    expect(result).toBeNull();
  });

  it('looks for cloudflared.exe on win32', async () => {
    const seen: string[] = [];
    await resolveCloudflaredPath({
      path: 'C:\\bin;C:\\tools',
      platform: 'win32',
      isExecutable: async (p) => {
        seen.push(p);
        return false;
      },
    });
    expect(seen.every((p) => p.endsWith('cloudflared.exe'))).toBe(true);
  });

  it('ignores empty PATH segments without probing them', async () => {
    const isExecutable = vi.fn(async () => false);
    await resolveCloudflaredPath({ path: '::/usr/bin:', platform: 'linux', isExecutable });
    expect(isExecutable).toHaveBeenCalledTimes(1);
    expect(isExecutable).toHaveBeenCalledWith('/usr/bin/cloudflared');
  });
});
