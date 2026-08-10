/**
 * ChatSelectionToolbar — the two actions the floating selection toolbar
 * offers on a text selection inside a message: Quote (append to the active
 * composition) and New session (open a draft on the source chat's project,
 * prefilled with the raw selection).
 *
 * `SelectionToolbarPrimitive.Root` gates visibility behind its own
 * mouseup/selectionchange listener (real `window.getSelection()` +
 * `getSelectionMessageId` walk) — reproducing that timing here would just
 * re-litigate the flaky e2e repro in composer-advanced.spec.ts. We mock it to
 * render children unconditionally so this file can focus on what we own: the
 * two actions' click behavior. Coverage gap (280-A2, the "toolbar disappears
 * after acting" half) stays with the e2e suite, not asserted here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

let __threadId: string | undefined = 'thread-1';
let __chatConfig: { projectId: string } | undefined = { projectId: 'proj-1' };

const composerGetState = vi.fn(() => ({ text: 'draft text' }));
const composerSetText = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    composer: {
      __internal_getRuntime: () => ({ getState: composerGetState }),
      getState: composerGetState,
      setText: composerSetText,
    },
  }),
  useAuiState: (sel: (s: { threadListItem: { id: string } | undefined }) => unknown) =>
    sel({ threadListItem: __threadId ? { id: __threadId } : undefined }),
  SelectionToolbarPrimitive: {
    Root: ({ children, ...props }: { children?: ReactNode }) => <div {...props}>{children}</div>,
  },
}));

vi.mock('../../runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => (__chatConfig === undefined ? undefined : { state: { chatConfig: __chatConfig } }),
}));

const appendSpy = vi.fn();
vi.mock('../../composer/segments/segment-store', () => ({
  useComposerSegments: (sel: (s: { append: typeof appendSpy }) => unknown) => sel({ append: appendSpy }),
}));

const openNewThreadDraftSpy = vi.fn();
vi.mock('@/features/sessions/new-thread/use-open-new-thread-draft', () => ({
  useOpenNewThreadDraft: () => openNewThreadDraftSpy,
}));

import { ChatSelectionToolbar } from '../ChatSelectionToolbar';

function stubSelection(text: string) {
  const removeAllRanges = vi.fn();
  vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => text, removeAllRanges } as unknown as Selection);
  return { removeAllRanges };
}

describe('ChatSelectionToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __threadId = 'thread-1';
    __chatConfig = { projectId: 'proj-1' };
  });

  it('renders exactly two actions, Quote then New session, in order', () => {
    stubSelection('hello world');
    render(<ChatSelectionToolbar />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAttribute('data-testid', 'chat-selection-quote');
    expect(buttons[1]).toHaveAttribute('data-testid', 'chat-selection-new-session');
  });

  it('prevents the default mousedown on both actions, keeping the DOM selection alive', () => {
    stubSelection('hello world');
    render(<ChatSelectionToolbar />);
    expect(fireEvent.mouseDown(screen.getByTestId('chat-selection-quote'))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByTestId('chat-selection-new-session'))).toBe(false);
  });

  it('Quote appends the selected text to the active thread’s segment store and clears the DOM selection', () => {
    const { removeAllRanges } = stubSelection('quoted text');
    render(<ChatSelectionToolbar />);
    fireEvent.click(screen.getByTestId('chat-selection-quote'));

    expect(appendSpy).toHaveBeenCalledWith('thread-1', { quote: 'quoted text', liveText: 'draft text' });
    expect(composerSetText).toHaveBeenCalledWith('');
    expect(removeAllRanges).toHaveBeenCalled();
  });

  it('New session opens a draft on the source chat’s project, prefilled with the raw selection, and does not append a segment', () => {
    stubSelection('quoted text');
    render(<ChatSelectionToolbar />);
    fireEvent.click(screen.getByTestId('chat-selection-new-session'));

    expect(openNewThreadDraftSpy).toHaveBeenCalledWith({ projectId: 'proj-1', prefill: 'quoted text' });
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('New session no-ops with a tagged console.warn when the source chat has no resolvable project', () => {
    __chatConfig = undefined;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubSelection('quoted text');
    render(<ChatSelectionToolbar />);
    fireEvent.click(screen.getByTestId('chat-selection-new-session'));

    expect(openNewThreadDraftSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[chat-selection-toolbar]');
    warnSpy.mockRestore();
  });
});
