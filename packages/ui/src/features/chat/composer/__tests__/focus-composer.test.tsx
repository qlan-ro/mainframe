/**
 * ⌘L (focus-composer).
 *
 * ⌘L is a registry action (`chat.focus-composer`), so its cases run against
 * real DOM + the real dispatcher, the same recipe as the other shortcut
 * integration suites. Composer-Escape (AC 13) is composer-local handling and
 * runs against both fields, textarea and chips, in
 * `composer-field-modes.test.tsx`.
 */
import { fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let isMac = true;
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => isMac }));

import { useShortcutDispatcher } from '@/features/shortcuts/use-shortcut-dispatcher';
import { useShortcutAction } from '@/features/shortcuts/action-store';
import { focusVisibleComposer } from '../focus-composer';

function pressFocusComposer() {
  return fireEvent.keyDown(window, { code: 'KeyL', metaKey: true, cancelable: true });
}

function mountFocusComposerAction() {
  return renderHook(() => {
    useShortcutDispatcher();
    useShortcutAction('chat.focus-composer', focusVisibleComposer);
  });
}

beforeEach(() => {
  isMac = true;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('⌘L — focus the visible composer', () => {
  it('moves focus into the composer input from elsewhere in the chat surface', () => {
    const input = document.createElement('textarea');
    input.setAttribute('data-mf-composer-input', '');
    document.body.appendChild(input);
    document.body.focus();
    const { unmount } = mountFocusComposerAction();

    pressFocusComposer();

    expect(document.activeElement).toBe(input);
    unmount();
  });

  /** A composer, inside a workspace chat tab when `tab` names its state. */
  function mountComposer(tab?: 'active' | 'hidden'): HTMLTextAreaElement {
    const input = document.createElement('textarea');
    input.setAttribute('data-mf-composer-input', '');
    const host = document.createElement('div');
    if (tab) host.setAttribute('data-conversation-tab', tab);
    host.appendChild(input);
    document.body.appendChild(host);
    return input;
  }

  it('means the conversation, whatever chat tabs the workspace shows', () => {
    mountComposer('hidden');
    mountComposer('active');
    const conversation = mountComposer();
    const { unmount } = mountFocusComposerAction();

    pressFocusComposer();

    expect(document.activeElement).toBe(conversation);
    unmount();
  });

  it('means the workspace tab while the keyboard is in it', () => {
    mountComposer();
    const inTab = mountComposer('active');
    const row = document.createElement('button');
    inTab.parentElement!.appendChild(row);
    row.focus();
    const { unmount } = mountFocusComposerAction();

    pressFocusComposer();

    expect(document.activeElement).toBe(inTab);
    unmount();
  });

  it('with the chat hidden, means the chat tab in front', () => {
    mountComposer('hidden');
    const front = mountComposer('active');
    const { unmount } = mountFocusComposerAction();

    pressFocusComposer();

    expect(document.activeElement).toBe(front);
    unmount();
  });

  it('is a no-op when no composer is on screen', () => {
    const { unmount } = mountFocusComposerAction();

    expect(pressFocusComposer).not.toThrow();
    unmount();
  });
});
