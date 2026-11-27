// Separate file: the loader caches its import at module level, so this must run
// against a module instance that has never imported the panel successfully.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const state = vi.hoisted(() => ({ fail: true }));

// Reading `ReviewPanel` throws while `fail` is set, which rejects the dynamic
// import the same way a missing chunk does.
vi.mock('../ReviewPanel', () => ({
  get ReviewPanel() {
    if (state.fail) throw new Error('Failed to fetch dynamically imported module');
    return () => <div data-testid="review-panel-stub" />;
  },
}));
vi.mock('@/lib/toast', () => ({ mfToast: { error: vi.fn() } }));

import { LazyReviewPanel } from '../LazyReviewPanel';
import { useOverlaysStore } from '@/store/overlays';
import { mfToast } from '@/lib/toast';

describe('LazyReviewPanel chunk failure', () => {
  beforeEach(() => {
    useOverlaysStore.getState().setReviewOpen(false);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('closes the modal, toasts, and retries the import on the next open', async () => {
    render(<LazyReviewPanel />);
    await act(async () => {
      useOverlaysStore.getState().setReviewOpen(true);
    });
    await vi.waitFor(() => expect(mfToast.error).toHaveBeenCalledTimes(1));
    expect(useOverlaysStore.getState().reviewOpen).toBe(false);
    expect(screen.queryByTestId('review-panel-stub')).toBeNull();

    state.fail = false;
    await act(async () => {
      useOverlaysStore.getState().setReviewOpen(true);
    });
    expect(await screen.findByTestId('review-panel-stub')).toBeTruthy();
  });
});
