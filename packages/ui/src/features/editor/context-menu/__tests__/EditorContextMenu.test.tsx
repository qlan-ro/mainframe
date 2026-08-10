/**
 * buildReferenceForCm — the `path:line (word)` reference string that both
 * Copy Reference (clipboard) and Add Agent Context (composer quote) emit.
 * The menu wiring itself is exercised via EditorTab.test.tsx
 * (editor-context-menu testid) for structure, and below for the Add Agent
 * Context → segment-store append seam (T26, spec #280: `setQuote` is gone —
 * nothing in this file writes `metadata.custom.quote` anymore).
 *
 * Mock strategy for the Add Agent Context suite mirrors the shipped
 * precedent in ChatSelectionToolbar.test.tsx: stub `@assistant-ui/react`'s
 * `useAui`/`useAuiState` and the segment-store module, and exercise the real
 * `useAppendQuoteSegment` hook through the component rather than mocking the
 * hook itself.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
}));

const appendSpy = vi.fn();
vi.mock('../../../chat/composer/segments/segment-store', () => ({
  useComposerSegments: (sel: (s: { append: typeof appendSpy }) => unknown) => sel({ append: appendSpy }),
}));

import { EditorContextMenu } from '../EditorContextMenu';

// Minimal CM6 EditorView stand-in: readCursorContext only touches
// selection.main.head, doc.lineAt, wordAt, and sliceDoc.
function fakeView(): EditorView {
  return {
    state: {
      selection: { main: { head: 20 } },
      doc: { lineAt: () => ({ number: 5, from: 10 }) },
      wordAt: () => ({ from: 15, to: 23 }),
      sliceDoc: () => 'validate',
    },
  } as unknown as EditorView;
}

describe('EditorContextMenu — Add Agent Context (T26 migration off setQuote)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __threadId = 'thread-1';
  });

  it('appends a quote segment built from path:line (word), not the native setQuote', () => {
    render(
      <EditorContextMenu filePath="/src/auth.ts" viewRef={{ current: fakeView() }}>
        <div>editor content</div>
      </EditorContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId('editor-context-menu'));
    fireEvent.click(screen.getByTestId('editor-context-menu-add-context'));

    expect(appendSpy).toHaveBeenCalledWith('thread-1', {
      quote: '/src/auth.ts:5 (validate)',
      liveText: 'draft text',
    });
    expect(composerSetText).toHaveBeenCalledWith('');
  });

  it('no-ops with a tagged console.warn when there is no active thread', () => {
    __threadId = undefined;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <EditorContextMenu filePath="/src/auth.ts" viewRef={{ current: fakeView() }}>
        <div>editor content</div>
      </EditorContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId('editor-context-menu'));
    fireEvent.click(screen.getByTestId('editor-context-menu-add-context'));

    expect(appendSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('[use-append-quote-segment]');
    warnSpy.mockRestore();
  });
});
