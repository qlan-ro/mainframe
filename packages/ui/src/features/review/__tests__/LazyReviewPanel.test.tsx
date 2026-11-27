import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

vi.mock('../ReviewPanel', () => ({ ReviewPanel: () => <div data-testid="review-panel-stub" /> }));

import { LazyReviewPanel } from '../LazyReviewPanel';
import { useOverlaysStore } from '@/store/overlays';

describe('LazyReviewPanel', () => {
  beforeEach(() => {
    useOverlaysStore.getState().setReviewOpen(false);
  });

  it('renders nothing until the review modal is opened', () => {
    render(<LazyReviewPanel />);
    expect(screen.queryByTestId('review-panel-stub')).toBeNull();
  });

  it('mounts the panel on first open and keeps it mounted after close', async () => {
    render(<LazyReviewPanel />);
    await act(async () => {
      useOverlaysStore.getState().setReviewOpen(true);
    });
    expect(await screen.findByTestId('review-panel-stub')).toBeTruthy();
    await act(async () => {
      useOverlaysStore.getState().setReviewOpen(false);
    });
    expect(screen.getByTestId('review-panel-stub')).toBeTruthy();
  });
});
