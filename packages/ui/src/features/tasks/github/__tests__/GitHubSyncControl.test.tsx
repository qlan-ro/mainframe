// @vitest-environment jsdom
/**
 * GitHubSyncControl.test.tsx
 *
 * Red-phase test for the tasks-board header sync control (`../GitHubSyncControl`,
 * not yet created — task 35 of the plan implements it against this file, per the
 * spec's "Linking a project to a repository" section).
 *
 * Behaviors covered:
 *  1. Unlinked -> renders `tasks-github-link`, an outline button reading "Link GitHub repo".
 *  2. Clicking it opens the link dialog (`openDialog({ kind: 'link' })`).
 *  3. Linked -> renders `tasks-github-pill` showing `owner/repo` and the syncedAgo text
 *     ("never synced" / "synced ... ago").
 *  4. Clicking the pill opens the menu with its four items in order, each carrying its
 *     frozen testid and copy: Sync now / Import issues… / Last sync report / Unlink repo….
 *  5. `tasks-github-menu-report` is disabled until a run exists (`lastRun` present).
 *  6. `tasks-github-menu-sync` is disabled while `running`, and the pill reads "syncing…" (AC35).
 *  7. Clicking an enabled `tasks-github-menu-sync` calls `sync()`; clicking
 *     `tasks-github-menu-import` calls `openDialog({ kind: 'import' })`.
 */
import { TooltipProvider } from '@/components/ui/tooltip';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Link, RunSummary } from '@/lib/api/todos-github';

const LINK_FIXTURE: Link = {
  projectId: 'proj-abc',
  owner: 'qlan-ro',
  repo: 'mainframe',
  remoteName: 'origin',
  credentialLabel: 'github',
  lastSyncedAt: null,
};

const RUN_FIXTURE: RunSummary = {
  runId: 'run-1',
  finishedAt: '2026-07-31T14:22:00.000Z',
  pairsReconciled: 5,
  overwrites: 4,
  failure: null,
  reached: 5,
  total: 5,
};

const openDialog = vi.fn();
const sync = vi.fn();

let storeState: {
  link: Link | null;
  running: boolean;
  lastRun: RunSummary | null;
};

vi.mock('../use-github-sync-store', () => ({
  useGitHubSyncStore: () => ({ ...storeState, openDialog, sync }),
}));

const { GitHubSyncControl } = await import('../GitHubSyncControl');

beforeEach(() => {
  vi.clearAllMocks();
  storeState = { link: null, running: false, lastRun: null };
});

describe('GitHubSyncControl — unlinked', () => {
  it('renders tasks-github-link reading "Link GitHub repo"', () => {
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    const button = screen.getByTestId('tasks-github-link');
    expect(button.textContent).toContain('Link GitHub repo');
  });

  it('clicking tasks-github-link opens the link dialog', async () => {
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('tasks-github-link'));
    expect(openDialog).toHaveBeenCalledWith({ kind: 'link' });
  });

  it('does not render tasks-github-pill', () => {
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    expect(screen.queryByTestId('tasks-github-pill')).toBeNull();
  });
});

describe('GitHubSyncControl — linked pill', () => {
  it('shows owner/repo and "never synced" before the first run', () => {
    storeState.link = LINK_FIXTURE;
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    const pill = screen.getByTestId('tasks-github-pill');
    expect(pill.textContent).toContain('qlan-ro/mainframe');
    expect(pill.textContent).toContain('never synced');
  });

  it('shows a "synced ... ago" phrase once lastSyncedAt is set', () => {
    storeState.link = { ...LINK_FIXTURE, lastSyncedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString() };
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    const pill = screen.getByTestId('tasks-github-pill');
    expect(pill.textContent).toMatch(/synced .+ ago/);
  });

  it('reads "syncing…" while a run is in progress, in place of the synced-ago text', () => {
    storeState.link = LINK_FIXTURE;
    storeState.running = true;
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    const pill = screen.getByTestId('tasks-github-pill');
    expect(pill.textContent).toContain('syncing…');
  });
});

describe('GitHubSyncControl — menu', () => {
  beforeEach(() => {
    storeState.link = LINK_FIXTURE;
  });

  it('opens with the four items reading Sync now / Import issues… / Last sync report / Unlink repo…', async () => {
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('tasks-github-pill'));

    expect(screen.getByTestId('tasks-github-menu-sync').textContent).toContain('Sync now');
    expect(screen.getByTestId('tasks-github-menu-import').textContent).toContain('Import issues…');
    expect(screen.getByTestId('tasks-github-menu-report').textContent).toContain('Last sync report');
    expect(screen.getByTestId('tasks-github-menu-unlink').textContent).toContain('Unlink repo…');
  });

  it('disables tasks-github-menu-report until a run exists', async () => {
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('tasks-github-pill'));
    expect(screen.getByTestId('tasks-github-menu-report').getAttribute('aria-disabled')).toBe('true');
  });

  it('enables tasks-github-menu-report once lastRun is set', async () => {
    storeState.lastRun = RUN_FIXTURE;
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('tasks-github-pill'));
    expect(screen.getByTestId('tasks-github-menu-report').getAttribute('aria-disabled')).not.toBe('true');
  });

  it('disables tasks-github-menu-sync while running (AC35)', async () => {
    storeState.running = true;
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('tasks-github-pill'));
    expect(screen.getByTestId('tasks-github-menu-sync').getAttribute('aria-disabled')).toBe('true');
  });

  it('calls sync() when an enabled tasks-github-menu-sync is clicked', async () => {
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('tasks-github-pill'));
    await userEvent.click(screen.getByTestId('tasks-github-menu-sync'));
    expect(sync).toHaveBeenCalledOnce();
  });

  it('calls openDialog({ kind: "import" }) when tasks-github-menu-import is clicked', async () => {
    render(
      <TooltipProvider>
        <GitHubSyncControl />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('tasks-github-pill'));
    await userEvent.click(screen.getByTestId('tasks-github-menu-import'));
    expect(openDialog).toHaveBeenCalledWith({ kind: 'import' });
  });
});
