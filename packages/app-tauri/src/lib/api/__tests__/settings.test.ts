import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProviderSettings,
  updateProviderSettings,
  getGeneralSettings,
  updateGeneralSettings,
  getConfigConflicts,
} from '../settings';

function mockFetchOk(data: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, data }) });
  vi.stubGlobal('fetch', fn);
  return fn;
}
function mockFetchEmpty(): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true }) });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const PORT = 31415;

beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
afterEach(() => vi.unstubAllGlobals());

describe('settings api', () => {
  it('getProviderSettings GETs /api/settings/providers and returns data', async () => {
    const fn = mockFetchOk({ claude: { defaultModel: 'opus' } });
    const out = await getProviderSettings(PORT);
    expect(fn).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/settings/providers',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(out).toEqual({ claude: { defaultModel: 'opus' } });
  });

  it('updateProviderSettings PUTs /api/settings/providers/:id with the patch', async () => {
    const fn = mockFetchEmpty();
    await updateProviderSettings(PORT, 'claude', { defaultEffort: 'high' });
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:31415/api/settings/providers/claude');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ defaultEffort: 'high' });
  });

  it('getGeneralSettings GETs /api/settings/general', async () => {
    mockFetchOk({ worktreeDir: '.worktrees', notifications: {} });
    const out = await getGeneralSettings(PORT);
    expect(out.worktreeDir).toBe('.worktrees');
  });

  it('updateGeneralSettings PUTs a deep-partial notifications patch unchanged', async () => {
    const fn = mockFetchEmpty();
    await updateGeneralSettings(PORT, { notifications: { chat: { taskComplete: false } } });
    const [url, init] = fn.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:31415/api/settings/general');
    expect(JSON.parse(init.body)).toEqual({ notifications: { chat: { taskComplete: false } } });
  });

  it('getConfigConflicts returns the conflicts array', async () => {
    mockFetchOk({ conflicts: ['permissionMode'] });
    const out = await getConfigConflicts(PORT, 'claude');
    expect(out).toEqual(['permissionMode']);
  });

  it('propagates API errors (success:false)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: false, error: 'boom' }) }),
    );
    await expect(getGeneralSettings(PORT)).rejects.toThrow('boom');
  });
});
