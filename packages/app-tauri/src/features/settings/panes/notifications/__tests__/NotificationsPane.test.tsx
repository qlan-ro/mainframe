import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationsPane } from '../NotificationsPane';
import { useSettingsStore } from '../../../../../store/settings';

const updateGeneralSettings = vi.fn().mockResolvedValue(undefined);
const getGeneralSettings = vi.fn();
vi.mock('../../../../../lib/api/settings', () => ({
  updateGeneralSettings: (...a: unknown[]) => updateGeneralSettings(...a),
  getGeneralSettings: (...a: unknown[]) => getGeneralSettings(...a),
}));

const NOTIF = {
  chat: { taskComplete: true, sessionError: true },
  permission: { toolRequest: true, userQuestion: true, planApproval: false },
  other: { plugin: true },
};
beforeEach(() => {
  useSettingsStore.setState({ general: { worktreeDir: '.worktrees', notifications: structuredClone(NOTIF) } });
  updateGeneralSettings.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe('NotificationsPane', () => {
  it('toggling a chat notification fires a deep-partial PUT and updates the store', () => {
    render(<NotificationsPane port={31415} />);
    fireEvent.click(screen.getByTestId('settings-notify-task-complete-toggle'));
    expect(updateGeneralSettings).toHaveBeenCalledWith(31415, {
      notifications: { chat: { taskComplete: false, sessionError: true } },
    });
    expect(useSettingsStore.getState().general.notifications.chat.taskComplete).toBe(false);
  });
  it('does not clobber sibling groups', () => {
    render(<NotificationsPane port={31415} />);
    fireEvent.click(screen.getByTestId('settings-notify-plugin-toggle'));
    const body = updateGeneralSettings.mock.calls[0]![1];
    expect(body).toEqual({ notifications: { other: { plugin: false } } });
  });
});
