/**
 * CmDiffEditorWithComments — end-to-end wiring test.
 *
 * Renders the real component (real CM6 MergeView, real comment-gutter hook) and
 * asserts the annotation gutter is installed on the modified pane — the same
 * gutter the plain editor shows (#213). Only the daemon-backed review send is
 * mocked (it needs the Tauri/daemon bridge); the gutter wiring is exercised for
 * real.
 *
 * jsdom stubs for CM6 Range measurement live in src/__tests__/setup.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../use-send-review', () => ({
  useSendReview: () => vi.fn().mockResolvedValue(undefined),
}));

import { CmDiffEditorWithComments } from '../CmDiffEditorWithComments';

describe('CmDiffEditorWithComments (#213)', () => {
  it('mounts the diff MergeView', () => {
    render(
      <CmDiffEditorWithComments
        original={'a\nb\n'}
        modified={'a\nB\n'}
        language="plaintext"
        path="/t.txt"
        filePath="t.txt"
      />,
    );
    const root = screen.getByTestId('editor-diff');
    expect(root.querySelector('.cm-mergeView')).toBeTruthy();
  });

  it('installs exactly one annotation gutter, on the modified pane', () => {
    render(
      <CmDiffEditorWithComments
        original={'a\nb\nc\n'}
        modified={'a\nB\nc\n'}
        language="plaintext"
        path="/t.txt"
        filePath="t.txt"
      />,
    );
    const root = screen.getByTestId('editor-diff');
    expect(root.querySelectorAll('.cm-comment-gutter').length).toBe(1);
  });

  it('does not install the gutter when comments are disabled', () => {
    render(
      <CmDiffEditorWithComments
        original={'a\n'}
        modified={'b\n'}
        language="plaintext"
        path="/t.txt"
        filePath="t.txt"
        enableComments={false}
      />,
    );
    const root = screen.getByTestId('editor-diff');
    expect(root.querySelector('.cm-comment-gutter')).toBeNull();
  });
});
