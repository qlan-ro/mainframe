import { describe, it, expect } from 'vitest';
import { NOTIFICATION_DEFAULTS } from '@qlan-ro/mainframe-types';
import { readNotificationConfig, shouldNotifyPermission } from '../../notifications/notification-config.js';
import type { DatabaseManager } from '../../db/index.js';

function fakeDb(stored: string | null): DatabaseManager {
  return { settings: { get: () => stored } } as unknown as DatabaseManager;
}

describe('readNotificationConfig', () => {
  it('returns defaults when no row is stored', () => {
    expect(readNotificationConfig(fakeDb(null))).toEqual(NOTIFICATION_DEFAULTS);
  });

  it('returns defaults when stored JSON is syntactically invalid', () => {
    expect(readNotificationConfig(fakeDb('not-json'))).toEqual(NOTIFICATION_DEFAULTS);
  });

  it('honours valid overrides exactly', () => {
    const stored = JSON.stringify({ chat: { taskComplete: false }, other: { plugin: false } });
    expect(readNotificationConfig(fakeDb(stored))).toEqual({
      chat: { ...NOTIFICATION_DEFAULTS.chat, taskComplete: false },
      permission: NOTIFICATION_DEFAULTS.permission,
      other: { plugin: false },
    });
  });

  it('salvages valid groups when one group has a bad leaf', () => {
    // The user disabled chat.taskComplete; permission.toolRequest got
    // corrupted to a string. The chat override must survive — falling back to
    // defaults across the board would silently re-enable a disabled toggle.
    const stored = JSON.stringify({
      chat: { taskComplete: false },
      permission: { toolRequest: 'false' },
    });
    const result = readNotificationConfig(fakeDb(stored));
    expect(result.chat.taskComplete).toBe(false);
    expect(result.permission.toolRequest).toBe(NOTIFICATION_DEFAULTS.permission.toolRequest);
  });

  it('drops a non-object root entirely', () => {
    expect(readNotificationConfig(fakeDb('123'))).toEqual(NOTIFICATION_DEFAULTS);
  });

  it('drops unknown groups but keeps known ones', () => {
    const stored = JSON.stringify({ chat: { sessionError: false }, bogus: { x: 1 } });
    const result = readNotificationConfig(fakeDb(stored));
    expect(result.chat.sessionError).toBe(false);
    expect(result.permission).toEqual(NOTIFICATION_DEFAULTS.permission);
    expect(result.other).toEqual(NOTIFICATION_DEFAULTS.other);
  });
});

describe('shouldNotifyPermission', () => {
  const cfg = NOTIFICATION_DEFAULTS;

  it('routes AskUserQuestion to permission.userQuestion', () => {
    expect(
      shouldNotifyPermission({ ...cfg, permission: { ...cfg.permission, userQuestion: false } }, 'AskUserQuestion'),
    ).toBe(false);
    expect(shouldNotifyPermission(cfg, 'AskUserQuestion')).toBe(true);
  });

  it('routes ExitPlanMode to permission.planApproval', () => {
    expect(
      shouldNotifyPermission({ ...cfg, permission: { ...cfg.permission, planApproval: false } }, 'ExitPlanMode'),
    ).toBe(false);
  });

  it('routes everything else to permission.toolRequest', () => {
    expect(shouldNotifyPermission({ ...cfg, permission: { ...cfg.permission, toolRequest: false } }, 'Bash')).toBe(
      false,
    );
    expect(shouldNotifyPermission({ ...cfg, permission: { ...cfg.permission, toolRequest: false } }, undefined)).toBe(
      false,
    );
  });
});
