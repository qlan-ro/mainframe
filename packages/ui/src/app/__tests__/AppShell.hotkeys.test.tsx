/**
 * The app-root shortcut registrations, mounted the way AppShell mounts them:
 * one dispatcher plus `useAppShortcutActions`. These assert id → the REAL
 * action (an intent emitted, a store opened); the chord → id half is the
 * dispatcher's own suite.
 *
 * Events carry `code`, not just `key`: the matcher works on the physical key
 * so a shifted chord still resolves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));

// jsdom reports a Linux-ish platform, so `mod` would resolve to Ctrl and every
// ⌘ assertion below would miss. The dispatcher reads this once at mount.
let isMac = true;
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => isMac }));

const { useSettingsStore } = await import('@/store/settings');
const { useCheatSheetStore } = await import('@/features/shortcuts/cheat-sheet-store');
const { useShortcutDispatcher } = await import('@/features/shortcuts/use-shortcut-dispatcher');
const { useAppShortcutActions } = await import('../use-app-shortcut-actions');

const onNewSession = vi.fn();

function mountAppShortcuts() {
  return renderHook(() => {
    useShortcutDispatcher();
    useAppShortcutActions({ onNewSession });
  });
}

beforeEach(() => {
  isMac = true;
  mockEmit.mockReset();
  onNewSession.mockReset();
  useSettingsStore.setState({ isOpen: false });
  useCheatSheetStore.setState({ open: false });
});

describe('app-root shortcuts', () => {
  it('Cmd+O emits open-search-palette and calls preventDefault', () => {
    const { unmount } = mountAppShortcuts();
    const e = new KeyboardEvent('keydown', { metaKey: true, key: 'o', code: 'KeyO', cancelable: true });
    window.dispatchEvent(e);
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-search-palette' });
    expect(e.defaultPrevented).toBe(true);
    unmount();
  });

  it('Ctrl+O also emits open-search-palette off macOS', () => {
    isMac = false;
    const { unmount } = mountAppShortcuts();
    window.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, key: 'o', code: 'KeyO', cancelable: true }));
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-search-palette' });
    unmount();
  });

  it('Cmd+Shift+R emits open-review and calls preventDefault', () => {
    const { unmount } = mountAppShortcuts();
    const e = new KeyboardEvent('keydown', {
      metaKey: true,
      shiftKey: true,
      key: 'R',
      code: 'KeyR',
      cancelable: true,
    });
    window.dispatchEvent(e);
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-review' });
    expect(e.defaultPrevented).toBe(true);
    unmount();
  });

  it('Cmd+, opens settings', () => {
    const { unmount } = mountAppShortcuts();
    window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, key: ',', code: 'Comma', cancelable: true }));
    expect(useSettingsStore.getState().isOpen).toBe(true);
    unmount();
  });

  it('Cmd+B emits toggle-sidebar', () => {
    const { unmount } = mountAppShortcuts();
    window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, key: 'b', code: 'KeyB', cancelable: true }));
    expect(mockEmit).toHaveBeenCalledWith({ type: 'toggle-sidebar' });
    unmount();
  });

  it('Cmd+N starts a new session', () => {
    const { unmount } = mountAppShortcuts();
    window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, key: 'n', code: 'KeyN', cancelable: true }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('Cmd+/ opens the cheat sheet', () => {
    const { unmount } = mountAppShortcuts();
    window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, key: '/', code: 'Slash', cancelable: true }));
    expect(useCheatSheetStore.getState().open).toBe(true);
    unmount();
  });

  it('unrelated keydown does not emit', () => {
    const { unmount } = mountAppShortcuts();
    window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, key: 'k', code: 'KeyK' }));
    expect(mockEmit).not.toHaveBeenCalled();
    unmount();
  });

  it('stops answering once the shell unmounts', () => {
    mountAppShortcuts().unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true, key: 'o', code: 'KeyO' }));
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
