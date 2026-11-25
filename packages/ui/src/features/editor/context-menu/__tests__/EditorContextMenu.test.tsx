/**
 * buildReferenceForCm — the `path:line (word)` reference string that both
 * Copy Reference (clipboard) and Add Agent Context (composer quote) emit.
 * The menu wiring itself is exercised via EditorTab.test.tsx
 * (editor-context-menu testid) for structure, and below for the Add Agent
 * Context → segment-store append seam (T26, spec #280: `setQuote` is gone —
 * nothing in this file writes `metadata.custom.quote` anymore).
 *
 * The Add Agent Context and Quote Reference suites run against a real CM6 state
 * and the real stores; only the app around them is stubbed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { buildReferenceForCm } from '@/lib/editor/copy-reference';

describe('buildReferenceForCm', () => {
  it('builds path:line (word) for a known position', () => {
    // CM6 line 4 (0-based) → display line 5, word "validate"
    const ref = buildReferenceForCm('/src/auth.ts', 4, 'validate');
    expect(ref).toBe('/src/auth.ts:5 (validate)');
  });

  it('builds path:line when no word is found', () => {
    const ref = buildReferenceForCm('/src/auth.ts', 0);
    expect(ref).toBe('/src/auth.ts:1');
  });

  it('handles undefined filePath', () => {
    const ref = buildReferenceForCm(undefined, 0);
    expect(ref).toBe('untitled:1');
  });
});

let __threadId: string | undefined = 'thread-1';
let __delegation: unknown;
const composer = vi.hoisted(() => ({ getState: () => ({ text: 'typed' }), setText: vi.fn() }));
vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ composer }),
  useAuiState: (sel: (s: unknown) => unknown) =>
    sel({ threadListItem: __threadId ? { id: __threadId, custom: { delegation: __delegation } } : undefined }),
}));
const toast = vi.hoisted(() => ({ warning: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: toast }));

import { draftItemsOf, useDraftContent } from '../../../chat/composer/draft-content/draft-content-store';
import { useComposerSegments } from '../../../chat/composer/segments/segment-store';
import { EditorContextMenu } from '../EditorContextMenu';

const DOC = 'one\ntwo\nthree\nfour';

/** A view over DOC with `from`..`to` selected. */
function viewOf(from: number, to = from): EditorView {
  return { state: EditorState.create({ doc: DOC, selection: { anchor: from, head: to } }) } as unknown as EditorView;
}

const addContext = (view: EditorView) => choose(view, 'editor-context-menu-add-context');

function choose(view: EditorView, item: string) {
  render(
    <EditorContextMenu filePath="src/auth.ts" viewRef={{ current: view }}>
      <div>editor content</div>
    </EditorContextMenu>,
  );
  fireEvent.contextMenu(screen.getByTestId('editor-context-menu'));
  fireEvent.click(screen.getByTestId(item));
}

describe('EditorContextMenu — Quote Reference', () => {
  it('quotes path:line (word), after what was typed, and adds no annotation', () => {
    __threadId = 'thread-1';
    useComposerSegments.setState({ byThread: {} });
    useDraftContent.setState({ byThread: {} });
    choose(viewOf(5), 'editor-context-menu-quote-ref');
    expect(useComposerSegments.getState().byThread['thread-1']).toMatchObject({
      committed: [{ text: 'typed' }],
      liveQuote: { text: 'src/auth.ts:2 (two)' },
    });
    expect(composer.setText).toHaveBeenCalledExactlyOnceWith('');
    expect(draftItemsOf('thread-1')).toEqual([]);
  });
});

describe('EditorContextMenu — Add Agent Context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __threadId = 'thread-1';
    __delegation = undefined;
    useDraftContent.setState({ byThread: {} });
  });

  it('adds the selected lines to the message as a code annotation', () => {
    addContext(viewOf(5, 10));
    expect(draftItemsOf('thread-1')).toEqual([
      {
        id: expect.any(String),
        kind: 'code',
        filePath: 'src/auth.ts',
        startLine: 2,
        endLine: 3,
        lineContent: 'two\nthree',
        note: '',
      },
    ]);
  });

  it('adds the cursor’s line when nothing is selected', () => {
    addContext(viewOf(5));
    expect(draftItemsOf('thread-1')).toEqual([
      expect.objectContaining({ startLine: 2, endLine: 2, lineContent: 'two' }),
    ]);
  });

  it('says so when no composer is on screen to show it', () => {
    addContext(viewOf(5));
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Added to your message');
  });

  it('says nothing when the composer shows the tile', () => {
    document.body.insertAdjacentHTML('beforeend', '<textarea data-mf-composer-input></textarea>');
    addContext(viewOf(5));
    expect(draftItemsOf('thread-1')).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    document.querySelector('[data-mf-composer-input]')!.remove();
  });

  it('warns when there is no session to write to', () => {
    __threadId = undefined;
    addContext(viewOf(5));
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith('Open a session first', expect.anything());
    expect(useDraftContent.getState().byThread).toEqual({});
  });

  it('warns in a read-only transcript, which has no composer', () => {
    __delegation = { taskId: 't' };
    addContext(viewOf(5));
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith('This session is read-only', expect.anything());
    expect(draftItemsOf('thread-1')).toEqual([]);
  });
});
