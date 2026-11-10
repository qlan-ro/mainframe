// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReviewActions } from '../use-review-actions';
import type { FileNote } from '../use-file-notes';

const mockSendReview = vi.fn();
vi.mock('../use-send-review', () => ({ useSendReview: () => mockSendReview }));

const toast = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: toast }));

const notes: FileNote[] = [
  { id: 'n1', startLine: 1, endLine: 1, lineContent: 'a', text: 'one' },
  { id: 'n2', startLine: 2, endLine: 2, lineContent: 'b', text: 'two' },
] as FileNote[];

function setup() {
  const deleteNote = vi.fn();
  const { result } = renderHook(() => useReviewActions({ filePath: 'a.ts', model: { notes, drafts: {}, deleteNote } }));
  return { result, deleteNote };
}

describe.each([
  ['submit all', (r: ReturnType<typeof setup>['result']) => r.current.handleSubmitReview(), 2],
  ['send one', (r: ReturnType<typeof setup>['result']) => r.current.handleSendOne('n1'), 1],
])('useReviewActions — %s', (_name, run, cleared) => {
  beforeEach(() => vi.clearAllMocks());

  it('clears notes on sent', async () => {
    mockSendReview.mockResolvedValue('sent');
    const { result, deleteNote } = setup();
    await act(() => run(result));
    expect(deleteNote).toHaveBeenCalledTimes(cleared);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps notes and shows an error toast on rejection', async () => {
    mockSendReview.mockRejectedValue(new Error('boom'));
    const { result, deleteNote } = setup();
    await act(() => run(result));
    expect(deleteNote).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ description: 'boom' }));
  });

  it('keeps notes and toasts on no-session', async () => {
    mockSendReview.mockResolvedValue('no-session');
    const { result, deleteNote } = setup();
    await act(() => run(result));
    expect(deleteNote).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalled();
  });
});
