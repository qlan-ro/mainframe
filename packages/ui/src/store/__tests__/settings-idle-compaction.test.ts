import { beforeEach, describe, expect, it } from 'vitest';
import { GENERAL_DEFAULTS } from '@qlan-ro/mainframe-types';
import { useSettingsStore } from '../settings';

beforeEach(() => useSettingsStore.getState().loadGeneral({}));

describe('general settings defaults and patches', () => {
  it('loads nested defaults for existing installs without sharing mutable default objects', () => {
    useSettingsStore.getState().loadGeneral({ worktreeDir: 'older', notifications: { chat: { taskComplete: false } } });
    const general = useSettingsStore.getState().general;
    expect(general.idleCompaction).toEqual({ enabled: false });
    expect(general.notifications.chat).toEqual({ taskComplete: false, sessionError: true, attentionRequest: true });
    expect(general.notifications.permission).toEqual(GENERAL_DEFAULTS.notifications.permission);
    expect(general.idleCompaction).not.toBe(GENERAL_DEFAULTS.idleCompaction);
    expect(general.notifications.permission).not.toBe(GENERAL_DEFAULTS.notifications.permission);
  });

  it('merges acknowledged patches against current state without replacing unrelated settings', () => {
    const { patchGeneral } = useSettingsStore.getState();
    patchGeneral({ idleCompaction: { enabled: true } });
    patchGeneral({ worktreeDir: 'other', notifications: { chat: { taskComplete: false } } });
    patchGeneral({ updateChannel: 'prerelease' });
    expect(useSettingsStore.getState().general).toMatchObject({
      idleCompaction: { enabled: true },
      worktreeDir: 'other',
      updateChannel: 'prerelease',
      notifications: { chat: { taskComplete: false, sessionError: true } },
    });
    expect(GENERAL_DEFAULTS.idleCompaction.enabled).toBe(false);
  });
});
