/**
 * ⌘L (focus-composer) and composer-Escape (AC 13).
 *
 * ⌘L is a registry action (`chat.focus-composer`), so its two cases run
 * against real DOM + the real dispatcher, the same recipe as the other
 * shortcut integration suites. Escape is composer-LOCAL handling (Task 17
 * decided it is not a registry entry), so those two cases render the real
 * `Composer` with the same mock shell `Composer.test.tsx` uses, adding only a
 * controllable trigger-field-aria mock to force the menu-open branch.
 */
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';

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

  it("with a split rendered, targets the [data-focused=true] zone's composer", () => {
    const unfocusedZone = document.createElement('div');
    unfocusedZone.setAttribute('data-focused', 'false');
    const unfocusedInput = document.createElement('textarea');
    unfocusedInput.setAttribute('data-mf-composer-input', '');
    unfocusedZone.appendChild(unfocusedInput);

    const focusedZone = document.createElement('div');
    focusedZone.setAttribute('data-focused', 'true');
    const focusedInput = document.createElement('textarea');
    focusedInput.setAttribute('data-mf-composer-input', '');
    focusedZone.appendChild(focusedInput);

    // Unfocused zone renders first in the DOM — proves the query targets the
    // FOCUSED zone by attribute, not by document order.
    document.body.appendChild(unfocusedZone);
    document.body.appendChild(focusedZone);
    const { unmount } = mountFocusComposerAction();

    pressFocusComposer();

    expect(document.activeElement).toBe(focusedInput);
    expect(document.activeElement).not.toBe(unfocusedInput);
    unmount();
  });

  it('is a no-op when no composer is on screen', () => {
    const { unmount } = mountFocusComposerAction();

    expect(pressFocusComposer).not.toThrow();
    unmount();
  });
});

// ---------------------------------------------------------------------------
// Escape — composer-local handling (Task 17), rendered with the real Composer
// shell. Mocks mirror Composer.test.tsx; only the trigger-aria mock is new.
// ---------------------------------------------------------------------------

let triggerExpanded = false;
vi.mock('../triggers/trigger-field-aria-context', () => ({
  useTriggerFieldAria: () => ({ 'aria-expanded': triggerExpanded }),
}));

vi.mock('@assistant-ui/react', () => ({
  ComposerPrimitive: {
    Root: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
    AttachmentDropzone: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...rest}>{children}</div>
    ),
    Input: ({ children, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
      <textarea {...rest}>{children}</textarea>
    ),
    Cancel: ({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...rest}>{children}</button>
    ),
  },
  useAuiState: (
    selector: (s: { thread: { isRunning: boolean; messages: unknown[] }; threadListItem: { id: string } }) => unknown,
  ) => selector({ thread: { isRunning: false, messages: [] }, threadListItem: { id: 'thread-1' } }),
  useAui: () => ({
    thread: { append: vi.fn() },
    composer: {
      __internal_getRuntime: () => ({ getState: () => ({ text: '', attachments: [], runConfig: {} }) }),
      getState: () => ({ text: '', attachments: [], runConfig: {} }),
      reset: vi.fn(),
    },
  }),
}));

vi.mock('../segments/ComposerSegments', () => ({ ComposerSegments: () => null }));
vi.mock('../edit/composer-edit-context', () => ({ useComposerEdit: () => ({ editing: null, cancelEdit: vi.fn() }) }));
vi.mock('../config-toolbar/ComposerToolbar', () => ({ ComposerToolbar: () => null }));
vi.mock('../attachments/ComposerAttachmentStrip', () => ({
  ComposerAttachments: () => null,
  ComposerAddAttachment: () => null,
  ComposerAddMention: () => null,
}));
vi.mock('../triggers/ComposerTriggers', () => ({
  ComposerTriggers: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../highlight/ComposerHighlight', () => ({ ComposerHighlight: () => null }));

import { Composer } from '../Composer';

function renderComposerInTranscript() {
  return render(
    <TooltipProvider>
      <div data-mf-chat-thread tabIndex={-1}>
        <Composer />
      </div>
    </TooltipProvider>,
  );
}

describe('Escape in the composer (AC 13)', () => {
  beforeEach(() => {
    triggerExpanded = false;
  });

  it('moves focus off the input and onto [data-mf-chat-thread] with no trigger menu open', () => {
    renderComposerInTranscript();
    const input = screen.getByTestId('chat-composer-input');
    input.focus();

    const event = fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', cancelable: true, bubbles: true });

    expect(document.activeElement).not.toBe(input);
    expect(document.activeElement).toHaveAttribute('data-mf-chat-thread');
    expect(event).toBe(false); // prevented — the composer took the keystroke
  });

  it('leaves focus in the composer while the trigger menu is open', () => {
    triggerExpanded = true;
    renderComposerInTranscript();
    const input = screen.getByTestId('chat-composer-input');
    input.focus();

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', cancelable: true, bubbles: true });

    expect(document.activeElement).toBe(input);
  });
});
