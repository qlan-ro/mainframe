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
  it('toggling a chat notification fires a leaf-only PUT and updates the store', () => {
    render(<NotificationsPane port={31415} />);
    fireEvent.click(screen.getByTestId('settings-notify-task-complete-toggle'));
    // Patch carries only the changed leaf — the daemon merges against its own stored state.
    expect(updateGeneralSettings).toHaveBeenCalledWith(31415, {
      notifications: { chat: { taskComplete: false } },
    });
    expect(useSettingsStore.getState().general.notifications.chat.taskComplete).toBe(false);
  });
  it('does not clobber sibling groups', () => {
    render(<NotificationsPane port={31415} />);
    fireEvent.click(screen.getByTestId('settings-notify-plugin-toggle'));
    const body = updateGeneralSettings.mock.calls[0]![1];
    expect(body).toEqual({ notifications: { other: { plugin: false } } });
  });
  it('two rapid toggles on different keys — second PUT carries only the second changed key, not a stale snapshot', () => {
    // This test guards against the stale-closure bug: patchChat spreading the
    // render-closure `notifications.chat` snapshot means a second toggle before
    // re-render would carry the old sibling values from the first toggle's
    // pre-update snapshot.  After the fix the PUT body is a pure leaf patch.
    render(<NotificationsPane port={31415} />);
    // First rapid toggle: taskComplete off
    fireEvent.click(screen.getByTestId('settings-notify-task-complete-toggle'));
    // Second rapid toggle immediately: sessionError off (before re-render)
    fireEvent.click(screen.getByTestId('settings-notify-session-error-toggle'));
    // The second PUT must contain ONLY the second changed leaf — not a stale
    // snapshot that still shows taskComplete as the pre-first-toggle value.
    const secondCall = updateGeneralSettings.mock.calls[1]![1] as {
      notifications: { chat: { taskComplete?: boolean; sessionError?: boolean } };
    };
    expect(secondCall).toEqual({ notifications: { chat: { sessionError: false } } });
  });
});
