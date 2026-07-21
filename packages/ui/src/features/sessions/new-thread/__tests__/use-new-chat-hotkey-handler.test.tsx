/**
 * useNewChatHotkeyHandler — behavior tests.
 *
 * Builds the ⌘N callback: "All" view → opens the shared project-picker store
 * instead of switching to a new thread; a project pill active → unchanged
 * (reset the stale draft + switchToNewThread).
 */
import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

let fakeFilterProjectId: string | null = null;

vi.mock('@/store/session-filters', () => ({
  useSessionFilters: (selector: (s: { filterProjectId: string | null }) => unknown) =>
    selector({ filterProjectId: fakeFilterProjectId }),
}));

const resetNewThreadDraftSpy = vi.fn();
vi.mock('../reset-new-thread-draft', () => ({
  resetNewThreadDraft: (...args: unknown[]) => resetNewThreadDraftSpy(...args),
}));

import { useNewSessionPickerTarget } from '../../sidebar/use-new-session-picker-target';
import { useNewChatHotkeyHandler } from '../use-new-chat-hotkey-handler';

function makeRuntime(newThreadId: string | null, switchToNewThread = vi.fn()) {
  return {
    threads: {
      getState: () => ({ newThreadId }),
      switchToNewThread,
    },
  } as unknown as Parameters<typeof useNewChatHotkeyHandler>[0];
}

beforeEach(() => {
  fakeFilterProjectId = null;
  resetNewThreadDraftSpy.mockReset();
  useNewSessionPickerTarget.setState({ open: false });
});

it('opens the project picker instead of switching to a new thread when no project pill is active (All view)', () => {
  fakeFilterProjectId = null;
  const switchToNewThread = vi.fn();
  const runtime = makeRuntime('__LOCALID_1', switchToNewThread);

  const { result } = renderHook(() => useNewChatHotkeyHandler(runtime));
  result.current();

  expect(useNewSessionPickerTarget.getState().open).toBe(true);
  expect(switchToNewThread).not.toHaveBeenCalled();
  expect(resetNewThreadDraftSpy).not.toHaveBeenCalled();
});

it('resets the stale draft and switches to a new thread when a project pill is active (auto-config seeds the project)', () => {
  fakeFilterProjectId = 'proj-42';
  const switchToNewThread = vi.fn();
  const runtime = makeRuntime('__LOCALID_1', switchToNewThread);

  const { result } = renderHook(() => useNewChatHotkeyHandler(runtime));
  result.current();

  expect(resetNewThreadDraftSpy).toHaveBeenCalledExactlyOnceWith('__LOCALID_1');
  expect(switchToNewThread).toHaveBeenCalledTimes(1);
  expect(useNewSessionPickerTarget.getState().open).toBe(false);
});
