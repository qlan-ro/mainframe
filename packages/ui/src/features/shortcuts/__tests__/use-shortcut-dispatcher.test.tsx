/**
 * The dispatcher's own parity + guard-rail suite: chord → id → `preventDefault`,
 * for every entry in the shipped registry at once. This file proves the MATCH
 * half of the todo's "action fires for the chord" acceptance criterion; the
 * id → real-action half is proven by the ported tests in the app-root,
 * zone-shortcut and session-tab suites, and the id spelling by `ShortcutId`
 * (registry.ts).
 */
import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom reports a Linux-ish platform, so `mod` would resolve to Ctrl and every
// ⌘ assertion below would miss. The dispatcher reads this once at mount.
let isMac = true;
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => isMac }));

import { useShortcutDispatcher } from '../use-shortcut-dispatcher';
import { useShortcutAction } from '../action-store';
import { SHORTCUTS, type ShortcutId } from '../registry';
import type { ShortcutAction } from '../shortcut-types';

type Spies = Record<ShortcutId, ReturnType<typeof vi.fn<ShortcutAction>>>;

/** Registers a fresh spy for every registry entry except `exclude`, mounts the
 *  dispatcher alongside them, and hands back the spy map plus an unmounter. */
function mountAllHandlers(exclude: readonly ShortcutId[] = []) {
  const spies = Object.fromEntries(SHORTCUTS.map((entry) => [entry.id, vi.fn<ShortcutAction>()])) as Spies;
  const { unmount } = renderHook(() => {
    useShortcutDispatcher();
    for (const entry of SHORTCUTS) {
      if (!exclude.includes(entry.id)) useShortcutAction(entry.id, spies[entry.id]!);
    }
  });
  return { spies, unmount };
}

function press(target: Window | Document | Element, init: KeyboardEventInit): boolean {
  return fireEvent.keyDown(target, { cancelable: true, ...init });
}

function focusedTextarea(): HTMLTextAreaElement {
  const el = document.createElement('textarea');
  document.body.appendChild(el);
  el.focus();
  return el;
}

function cmEditorTarget(): HTMLElement {
  const host = document.createElement('div');
  host.className = 'cm-editor';
  const inner = document.createElement('span');
  host.appendChild(inner);
  document.body.appendChild(host);
  return inner;
}

function terminalTextarea(): HTMLTextAreaElement {
  const container = document.createElement('div');
  container.className = 'xterm';
  const textarea = document.createElement('textarea');
  textarea.className = 'xterm-helper-textarea';
  container.appendChild(textarea);
  document.body.appendChild(container);
  textarea.focus();
  return textarea;
}

beforeEach(() => {
  isMac = true;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllEnvs();
});

describe('AC 2 — every shipped chord fires its id exactly once and prevents default', () => {
  const cases: Array<{ name: string; id: ShortcutId; init: KeyboardEventInit; dev?: boolean }> = [
    { name: '⌘N', id: 'sessions.new', init: { code: 'KeyN', metaKey: true } },
    { name: '⌘O', id: 'app.search-palette', init: { code: 'KeyO', metaKey: true } },
    { name: '⌘⇧R', id: 'app.review', init: { code: 'KeyR', metaKey: true, shiftKey: true } },
    { name: '⌘F', id: 'chat.find', init: { code: 'KeyF', metaKey: true } },
    { name: '⌘,', id: 'app.settings', init: { code: 'Comma', metaKey: true } },
    { name: '⌘⇧C', id: 'workspace.toggle-chat', init: { code: 'KeyC', metaKey: true, shiftKey: true } },
    { name: '⌘⇧W', id: 'workspace.toggle-workspace', init: { code: 'KeyW', metaKey: true, shiftKey: true } },
    { name: '⌘J', id: 'workspace.new-terminal', init: { code: 'KeyJ', metaKey: true } },
    { name: '⌘B', id: 'sessions.toggle-sidebar', init: { code: 'KeyB', metaKey: true } },
    { name: '⌘⇧T', id: 'app.quick-task', init: { code: 'KeyT', metaKey: true, shiftKey: true } },
    { name: '⌘⇧A in dev', id: 'app.automations', init: { code: 'KeyA', metaKey: true, shiftKey: true }, dev: true },
    { name: '⌘\\', id: 'sessions.close-split', init: { code: 'Backslash', metaKey: true } },
  ];

  for (const { name, id, init, dev } of cases) {
    it(`${name} fires ${id}`, () => {
      if (dev) vi.stubEnv('DEV', true);
      const { spies, unmount } = mountAllHandlers();

      const event = press(window, init);

      expect(spies[id]).toHaveBeenCalledTimes(1);
      expect(event).toBe(false); // fireEvent returns false when preventDefault was called
      unmount();
    });
  }
});

describe('AC 3 — a bare (unmodified) keystroke in a text field fires nothing', () => {
  const bare: KeyboardEventInit[] = [
    { code: 'KeyN' },
    { code: 'KeyF' },
    { code: 'KeyO' },
    { code: 'KeyL' },
    { code: 'Digit1' },
    { code: 'Digit2' },
    { code: 'KeyB' },
    { code: 'Backslash' },
  ];

  for (const init of bare) {
    it(`${init.code} alone is inert from a focused textarea`, () => {
      const textarea = focusedTextarea();
      const { spies, unmount } = mountAllHandlers();

      const event = press(textarea, init);

      expect(Object.values(spies).some((spy) => spy.mock.calls.length > 0)).toBe(false);
      expect(event).toBe(true); // not prevented — the browser keeps the keystroke
      unmount();
    });
  }
});

describe('AC 4 — a modifier-carrying app chord fires from a focused text field', () => {
  const cases: Array<{ id: ShortcutId; init: KeyboardEventInit }> = [
    { id: 'sessions.new', init: { code: 'KeyN', metaKey: true } },
    { id: 'app.search-palette', init: { code: 'KeyO', metaKey: true } },
    { id: 'app.settings', init: { code: 'Comma', metaKey: true } },
    { id: 'sessions.toggle-sidebar', init: { code: 'KeyB', metaKey: true } },
    { id: 'workspace.toggle-chat', init: { code: 'KeyC', metaKey: true, shiftKey: true } },
    { id: 'workspace.toggle-workspace', init: { code: 'KeyW', metaKey: true, shiftKey: true } },
    { id: 'chat.focus-composer', init: { code: 'KeyL', metaKey: true } },
  ];

  for (const { id, init } of cases) {
    it(`${id} fires from a focused textarea`, () => {
      const textarea = focusedTextarea();
      const { spies, unmount } = mountAllHandlers();

      press(textarea, init);

      expect(spies[id]).toHaveBeenCalledTimes(1);
      unmount();
    });
  }
});

describe('AC 5 — editor-yielding entries stand down inside .cm-editor', () => {
  it('⌘F fires nothing from inside the editor', () => {
    const target = cmEditorTarget();
    const { spies, unmount } = mountAllHandlers();

    press(target, { code: 'KeyF', metaKey: true });

    expect(spies['chat.find']).not.toHaveBeenCalled();
    unmount();
  });

  it('⌘/ fires nothing from inside the editor', () => {
    const target = cmEditorTarget();
    const { spies, unmount } = mountAllHandlers();

    press(target, { code: 'Slash', metaKey: true });

    expect(spies['app.cheat-sheet']).not.toHaveBeenCalled();
    unmount();
  });

  it('⌘N (non-yielding) still fires from inside the editor', () => {
    const target = cmEditorTarget();
    const { spies, unmount } = mountAllHandlers();

    press(target, { code: 'KeyN', metaKey: true });

    expect(spies['sessions.new']).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('AC 6 — editor-yielding entries still fire from the terminal', () => {
  it('⌘F fires from the terminal helper textarea', () => {
    const textarea = terminalTextarea();
    const { spies, unmount } = mountAllHandlers();

    press(textarea, { code: 'KeyF', metaKey: true });

    expect(spies['chat.find']).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('⌘/ fires from the terminal helper textarea', () => {
    const textarea = terminalTextarea();
    const { spies, unmount } = mountAllHandlers();

    press(textarea, { code: 'Slash', metaKey: true });

    expect(spies['app.cheat-sheet']).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('AC 7 — an unshifted chord does not match while Shift is held', () => {
  const cases: Array<{ id: ShortcutId; init: KeyboardEventInit }> = [
    { id: 'sessions.new', init: { code: 'KeyN', metaKey: true, shiftKey: true } },
    { id: 'app.search-palette', init: { code: 'KeyO', metaKey: true, shiftKey: true } },
    { id: 'chat.find', init: { code: 'KeyF', metaKey: true, shiftKey: true } },
    { id: 'app.settings', init: { code: 'Comma', metaKey: true, shiftKey: true } },
  ];

  for (const { id, init } of cases) {
    it(`⌘⇧${id} does not fire ${id}`, () => {
      const { spies, unmount } = mountAllHandlers();

      const event = press(window, init);

      expect(spies[id]).not.toHaveBeenCalled();
      expect(event).toBe(true);
      unmount();
    });
  }
});

describe('AC 8 — matching is on the physical key, not the printed character', () => {
  it("code 'Backslash' with key '|' and Shift fires open-in-split", () => {
    const { spies, unmount } = mountAllHandlers();

    press(window, { code: 'Backslash', key: '|', metaKey: true, shiftKey: true });

    expect(spies['sessions.open-in-split']).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("code 'KeyT' with key 'T' fires quick-task", () => {
    const { spies, unmount } = mountAllHandlers();

    press(window, { code: 'KeyT', key: 'T', metaKey: true, shiftKey: true });

    expect(spies['app.quick-task']).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe('D7 regression — the session-tab family fires from a focused text field', () => {
  it('⌃Tab fires sessions.tab-next from a focused textarea and prevents default', () => {
    const textarea = focusedTextarea();
    const { spies, unmount } = mountAllHandlers();

    const event = press(textarea, { code: 'Tab', ctrlKey: true });

    expect(spies['sessions.tab-next']).toHaveBeenCalledTimes(1);
    expect(event).toBe(false);
    unmount();
  });

  it('⌃⇧Tab fires sessions.tab-prev from a focused textarea and prevents default', () => {
    const textarea = focusedTextarea();
    const { spies, unmount } = mountAllHandlers();

    const event = press(textarea, { code: 'Tab', ctrlKey: true, shiftKey: true });

    expect(spies['sessions.tab-prev']).toHaveBeenCalledTimes(1);
    expect(event).toBe(false);
    unmount();
  });

  it('⌘1 fires sessions.tab-by-index with chordIndex 0 from a focused textarea and prevents default', () => {
    const textarea = focusedTextarea();
    const { spies, unmount } = mountAllHandlers();

    const event = press(textarea, { code: 'Digit1', metaKey: true });

    expect(spies['sessions.tab-by-index']).toHaveBeenCalledWith(0);
    expect(event).toBe(false);
    unmount();
  });

  it('⌃Tab fires sessions.tab-next from the terminal helper textarea', () => {
    const textarea = terminalTextarea();
    const { spies, unmount } = mountAllHandlers();

    press(textarea, { code: 'Tab', ctrlKey: true });

    expect(spies['sessions.tab-next']).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('⌘1 fires sessions.tab-by-index from the terminal helper textarea', () => {
    const textarea = terminalTextarea();
    const { spies, unmount } = mountAllHandlers();

    press(textarea, { code: 'Digit1', metaKey: true });

    expect(spies['sessions.tab-by-index']).toHaveBeenCalledWith(0);
    unmount();
  });
});

describe('an id with no registered handler stays inert', () => {
  it('leaves the keystroke unprevented and calls nothing', () => {
    const { spies, unmount } = mountAllHandlers(['app.search-palette']);

    const event = press(window, { code: 'KeyO', metaKey: true, cancelable: true });

    expect(spies['app.search-palette']).not.toHaveBeenCalled();
    expect(event).toBe(true);
    unmount();
  });
});
