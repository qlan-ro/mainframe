// @vitest-environment jsdom
/**
 * SyncRunBanner.test.tsx
 *
 * Red-phase test for the post-run banner (`../SyncRunBanner`, not yet created —
 * task 36 of the plan implements it against this file, per the spec's
 * "After a run..." paragraph).
 *
 * Behaviors covered:
 *  1. Renders nothing when there is no lastRun, and nothing once dismissed.
 *  2. Renders the counts line "N pairs synced · M fields overwritten".
 *  3. A "View report" button (`tasks-github-banner-report`) opens the report
 *     (`openDialog({ kind: 'report' })`) — present only when something was overwritten.
 *  4. Offers no report link when nothing was overwritten (overwrites === 0).
 *  5. Amber partial-failure variant renders the failure's reason on a second line.
 *  6. `tasks-github-banner-dismiss` calls `dismissBanner()`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RunSummary } from '@/lib/api/todos-github';

const RUN_FIXTURE: RunSummary = {
  runId: 'run-1',
  finishedAt: '2026-07-31T14:22:00.000Z',
  pairsReconciled: 5,
  overwrites: 4,
  failure: null,
  reached: 5,
  total: 5,
};

const PARTIAL_FAILURE_RUN: RunSummary = {
  runId: 'run-2',
  finishedAt: '2026-07-31T14:22:00.000Z',
  pairsReconciled: 3,
  overwrites: 2,
  failure: {
    kind: 'rate-limit',
    message: 'Rate limited by GitHub after 3 of 7 pairs. The 4 pairs not reached were left untouched.',
    reached: 3,
    total: 7,
  },
  reached: 3,
  total: 7,
};

const openDialog = vi.fn();
const dismissBanner = vi.fn();

let storeState: { lastRun: RunSummary | null; bannerDismissed: boolean };

vi.mock('../use-github-sync-store', () => ({
  useGitHubSyncStore: () => ({ ...storeState, openDialog, dismissBanner }),
}));

const { SyncRunBanner } = await import('../SyncRunBanner');

beforeEach(() => {
  vi.clearAllMocks();
  storeState = { lastRun: null, bannerDismissed: false };
});

describe('SyncRunBanner — visibility', () => {
  it('renders nothing when there is no lastRun', () => {
    const { container } = render(<SyncRunBanner />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing once dismissed', () => {
    storeState.lastRun = RUN_FIXTURE;
    storeState.bannerDismissed = true;
    const { container } = render(<SyncRunBanner />);
    expect(container.textContent).toBe('');
  });
});

describe('SyncRunBanner — counts and report link', () => {
  it('renders "5 pairs synced · 4 fields overwritten" and a View report button', () => {
    storeState.lastRun = RUN_FIXTURE;
    render(<SyncRunBanner />);
    const banner = screen.getByTestId('tasks-github-banner');
    expect(banner.textContent).toContain('5 pairs synced');
    expect(banner.textContent).toContain('4 fields overwritten');
    expect(screen.getByTestId('tasks-github-banner-report').textContent).toContain('View report');
  });

  it('opens the report dialog when View report is clicked', async () => {
    storeState.lastRun = RUN_FIXTURE;
    render(<SyncRunBanner />);
    await userEvent.click(screen.getByTestId('tasks-github-banner-report'));
    expect(openDialog).toHaveBeenCalledWith({ kind: 'report' });
  });

  it('offers no report link when nothing was overwritten', () => {
    storeState.lastRun = { ...RUN_FIXTURE, overwrites: 0 };
    render(<SyncRunBanner />);
    expect(screen.queryByTestId('tasks-github-banner-report')).toBeNull();
  });
});

describe('SyncRunBanner — partial-failure variant', () => {
  it('renders the failure reason on a second line', () => {
    storeState.lastRun = PARTIAL_FAILURE_RUN;
    render(<SyncRunBanner />);
    const banner = screen.getByTestId('tasks-github-banner');
    expect(banner.textContent).toContain(
      'Rate limited by GitHub after 3 of 7 pairs. The 4 pairs not reached were left untouched.',
    );
  });
});

describe('SyncRunBanner — dismiss', () => {
  it('calls dismissBanner()', async () => {
    storeState.lastRun = RUN_FIXTURE;
    render(<SyncRunBanner />);
    await userEvent.click(screen.getByTestId('tasks-github-banner-dismiss'));
    expect(dismissBanner).toHaveBeenCalledOnce();
  });
});
