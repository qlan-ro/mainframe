import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERAL_DEFAULTS } from '@qlan-ro/mainframe-types';
import type { GeneralSettingsPatch } from '../settings';
import { getGeneralSettings, updateGeneralSettings } from '../settings';

function response(data: unknown) {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data }) });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('general settings validation boundary', () => {
  it('defaults older responses to disabled and preserves valid enabled responses', async () => {
    const older: Partial<typeof GENERAL_DEFAULTS> = { ...GENERAL_DEFAULTS };
    delete older.idleCompaction;
    response(older);
    expect((await getGeneralSettings(9999)).idleCompaction).toEqual({ enabled: false });
    response({ ...older, idleCompaction: { enabled: true } });
    expect((await getGeneralSettings(9999)).idleCompaction).toEqual({ enabled: true });
  });

  it.each(['true', 1, null, [], {}])('rejects malformed enabled=%j on GET and before PUT', async (enabled) => {
    response({ ...GENERAL_DEFAULTS, idleCompaction: { enabled } });
    await expect(getGeneralSettings(9999)).rejects.toThrow();
    const fetch = response(undefined);
    const patch = { worktreeDir: 'other', idleCompaction: { enabled } } as unknown as GeneralSettingsPatch;
    await expect(updateGeneralSettings(9999, patch)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('parses nested notification and existing general fields instead of casting the response', async () => {
    response({ ...GENERAL_DEFAULTS, notifications: { chat: { taskComplete: 'true' } } });
    await expect(getGeneralSettings(9999)).rejects.toThrow();
    response({ ...GENERAL_DEFAULTS, updateChannel: 'invalid' });
    await expect(getGeneralSettings(9999)).rejects.toThrow();
  });

  it('sends only the validated toggle patch', async () => {
    const fetch = response(undefined);
    await updateGeneralSettings(9999, { idleCompaction: { enabled: true } });
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual({ idleCompaction: { enabled: true } });
  });
});
