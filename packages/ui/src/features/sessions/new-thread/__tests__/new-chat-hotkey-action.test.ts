/**
 * resolveNewChatHotkeyAction — behavior tests.
 *
 * The single seam that decides what ⌘N/Ctrl+N does: open the "All view"
 * project picker (no project pill active — the picker resolves the project
 * first, matching the sidebar "+" button) or switch straight to a new thread
 * (a project pill IS active — useNewThreadAutoConfig seeds that project).
 */
import { describe, it, expect } from 'vitest';
import { resolveNewChatHotkeyAction } from '../new-chat-hotkey-action';

describe('resolveNewChatHotkeyAction — no project pill active (All view)', () => {
  it('returns "open-project-picker" when filterProjectId is null', () => {
    expect(resolveNewChatHotkeyAction(null)).toBe('open-project-picker');
  });
});

describe('resolveNewChatHotkeyAction — a project pill is active', () => {
  it('returns "switch-to-new-thread" when filterProjectId is set', () => {
    expect(resolveNewChatHotkeyAction('proj-42')).toBe('switch-to-new-thread');
  });
});
