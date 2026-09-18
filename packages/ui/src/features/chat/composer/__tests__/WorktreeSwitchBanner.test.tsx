/**
 * Behavior tests for WorktreeSwitchBanner — the composer chrome that offers to
 * move the session into a worktree an agent just created, and reports the
 * restart while it happens. Copy is load-bearing (it explains why the agent
 * restarts), so every string is hardcoded here; no production logic re-derived.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorktreeSwitchOffer } from '@qlan-ro/mainframe-types';

type SwitchingState = { worktreePath: string; phase: 'restarting' | 'settled' } | null;
type CurrentBinding = { worktreePath: string | null; branchName: string | null };

let __chatId: string;
let __offers: WorktreeSwitchOffer[];
let __switching: SwitchingState;
let __current: CurrentBinding;
let __busy: boolean;
let __accept: Mock<(worktreePath: string) => Promise<void>>;
let __dismiss: Mock<(worktreePath: string) => Promise<void>>;
let __clear: Mock<() => void>;

vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({ state: { chatId: __chatId } }),
  useWorktreeOffer: () => ({
    offers: __offers,
    switching: __switching,
    current: __current,
    busy: __busy,
    accept: __accept,
    dismiss: __dismiss,
    clear: __clear,
  }),
}));

import { WorktreeSwitchBanner } from '../WorktreeSwitchBanner';

function offer(worktreePath: string, branchName: string | null, detectedAt: number): WorktreeSwitchOffer {
  return { chatId: 'chat-1', worktreePath, branchName, detectedAt };
}

function paths(testId: string): (string | null)[] {
  return screen.getAllByTestId(testId).map((el) => el.getAttribute('data-path'));
}

describe('WorktreeSwitchBanner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __chatId = 'chat-1';
    __offers = [];
    __switching = null;
    __current = { worktreePath: null, branchName: null };
    __busy = false;
    __accept = vi.fn(async () => {});
    __dismiss = vi.fn(async () => {});
    __clear = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when there is no offer and no switch in flight', () => {
    const { container } = render(<WorktreeSwitchBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing on a draft thread even with an offer pending', () => {
    __chatId = '__LOCALID_draft-1';
    __offers = [offer('/tmp/wt/x', 'feat/x', 1)];

    const { container } = render(<WorktreeSwitchBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('offers a single worktree with its branch, path and restart warning', () => {
    __offers = [offer('/tmp/wt/x', 'feat/x', 1)];

    render(<WorktreeSwitchBanner />);

    const banner = screen.getByTestId('worktree-switch-banner');
    expect(banner.textContent).toContain('New worktree: feat/x');
    expect(banner.textContent).toContain(
      "Created at /tmp/wt/x. Switch this session into it? The agent restarts in the new folder — a running process can't change directory. History carries over.",
    );

    const accept = screen.getByTestId('worktree-switch-accept');
    expect(accept).toHaveAttribute('data-path', '/tmp/wt/x');
    expect(accept.textContent).toContain('Switch session');

    const dismiss = screen.getByTestId('worktree-switch-dismiss');
    expect(dismiss).toHaveAttribute('data-path', '/tmp/wt/x');
    expect(dismiss.textContent).toContain('Stay here');
  });

  it('collapses three offers into one banner with a counted title and a single shared warning', () => {
    __offers = [offer('/tmp/wt/a', 'feat/a', 1), offer('/tmp/wt/b', 'feat/b', 2), offer('/tmp/wt/c', 'feat/c', 3)];

    render(<WorktreeSwitchBanner />);

    expect(screen.getAllByTestId('worktree-switch-banner')).toHaveLength(1);

    const banner = screen.getByTestId('worktree-switch-banner');
    expect(banner.textContent).toContain('3 new worktrees — switch this session?');

    const warning =
      "Switching restarts the agent in the chosen folder — a running process can't change directory. History carries over.";
    expect(banner.textContent).toContain(warning);
    expect(banner.textContent?.split(warning)).toHaveLength(2);

    expect(paths('worktree-switch-row')).toEqual(['/tmp/wt/a', '/tmp/wt/b', '/tmp/wt/c']);
    expect(paths('worktree-switch-accept')).toEqual(['/tmp/wt/a', '/tmp/wt/b', '/tmp/wt/c']);
    expect(paths('worktree-switch-dismiss')).toEqual(['/tmp/wt/a', '/tmp/wt/b', '/tmp/wt/c']);

    const rows = screen.getAllByTestId('worktree-switch-row');
    expect(rows[0]!.textContent).toContain('feat/a');
    expect(rows[1]!.textContent).toContain('feat/b');
    expect(rows[2]!.textContent).toContain('feat/c');
  });

  describe('a turn in flight', () => {
    it('blocks the single offer and says when it will be available', () => {
      __offers = [offer('/tmp/wt/x', 'feat/x', 1)];
      __busy = true;

      render(<WorktreeSwitchBanner />);

      expect(screen.getByTestId('worktree-switch-banner').textContent).toContain(
        'Created at /tmp/wt/x. Available once the current response finishes — restarting now would cut it off.',
      );
      expect(screen.getByTestId('worktree-switch-accept')).toBeDisabled();
      expect(screen.getByTestId('worktree-switch-dismiss')).not.toBeDisabled();
    });

    it('blocks every row of a multi-offer banner', () => {
      __offers = [offer('/tmp/wt/a', 'feat/a', 1), offer('/tmp/wt/b', 'feat/b', 2)];
      __busy = true;

      render(<WorktreeSwitchBanner />);

      expect(screen.getByTestId('worktree-switch-banner').textContent).toContain(
        'Available once the current response finishes — restarting now would cut it off.',
      );
      const accepts = screen.getAllByTestId('worktree-switch-accept');
      expect(accepts[0]).toBeDisabled();
      expect(accepts[1]).toBeDisabled();
    });
  });

  it('replaces the single offer with a restarting status while switching', () => {
    __offers = [offer('/tmp/wt/x', 'feat/x', 1)];
    __switching = { worktreePath: '/tmp/wt/x', phase: 'restarting' };

    render(<WorktreeSwitchBanner />);

    expect(screen.getAllByTestId('worktree-switch-banner')).toHaveLength(1);
    expect(screen.getByTestId('worktree-switch-status').textContent).toBe(
      'Switching — restarting the agent in feat/x…',
    );
    expect(screen.queryByTestId('worktree-switch-accept')).toBeNull();
  });

  it('shows the status on the accepted row only and disables the other rows accept buttons', () => {
    __offers = [offer('/tmp/wt/a', 'feat/a', 1), offer('/tmp/wt/b', 'feat/b', 2), offer('/tmp/wt/c', 'feat/c', 3)];
    __switching = { worktreePath: '/tmp/wt/b', phase: 'restarting' };

    render(<WorktreeSwitchBanner />);

    expect(paths('worktree-switch-row')).toEqual(['/tmp/wt/a', '/tmp/wt/b', '/tmp/wt/c']);

    const status = screen.getAllByTestId('worktree-switch-status');
    expect(status).toHaveLength(1);
    expect(status[0]!.textContent).toBe('Switching — restarting the agent in feat/b…');

    expect(paths('worktree-switch-accept')).toEqual(['/tmp/wt/a', '/tmp/wt/c']);
    const accepts = screen.getAllByTestId('worktree-switch-accept');
    expect(accepts[0]).toBeDisabled();
    expect(accepts[1]).toBeDisabled();

    expect(paths('worktree-switch-dismiss')).toEqual(['/tmp/wt/a', '/tmp/wt/c']);
    const dismisses = screen.getAllByTestId('worktree-switch-dismiss');
    expect(dismisses[0]).not.toBeDisabled();
    expect(dismisses[1]).not.toBeDisabled();
  });

  it('reports the settled session from the live binding and clears itself after 2 seconds', () => {
    __offers = [];
    __switching = { worktreePath: '/tmp/wt/x', phase: 'settled' };
    __current = { worktreePath: '/tmp/wt/x', branchName: 'feat/x' };

    render(<WorktreeSwitchBanner />);

    expect(screen.getByTestId('worktree-switch-status').textContent).toBe('Session is now in /tmp/wt/x on feat/x.');
    expect(__clear).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(__clear).toHaveBeenCalledTimes(1);
  });

  describe('detached worktree falls back to the path basename', () => {
    it('labels the pending offer with the folder name', () => {
      __offers = [offer('/tmp/wt/hotfix', null, 1)];

      render(<WorktreeSwitchBanner />);

      expect(screen.getByTestId('worktree-switch-banner').textContent).toContain('New worktree: hotfix');
    });

    it('labels the restarting status with the folder name', () => {
      __offers = [offer('/tmp/wt/hotfix', null, 1)];
      __switching = { worktreePath: '/tmp/wt/hotfix', phase: 'restarting' };

      render(<WorktreeSwitchBanner />);

      expect(screen.getByTestId('worktree-switch-status').textContent).toBe(
        'Switching — restarting the agent in hotfix…',
      );
    });

    it('labels the settled line with the folder name', () => {
      __switching = { worktreePath: '/tmp/wt/hotfix', phase: 'settled' };
      __current = { worktreePath: '/tmp/wt/hotfix', branchName: null };

      render(<WorktreeSwitchBanner />);

      expect(screen.getByTestId('worktree-switch-status').textContent).toBe(
        'Session is now in /tmp/wt/hotfix on hotfix.',
      );
    });
  });

  it('accepts and dismisses the offer whose row was clicked', async () => {
    // userEvent's own delay loop deadlocks against vitest's fake clock here; this
    // case asserts click routing, not the settled timer.
    vi.useRealTimers();
    const user = userEvent.setup();
    __offers = [offer('/tmp/wt/a', 'feat/a', 1), offer('/tmp/wt/b', 'feat/b', 2), offer('/tmp/wt/c', 'feat/c', 3)];

    render(<WorktreeSwitchBanner />);

    await user.click(screen.getAllByTestId('worktree-switch-accept')[1]!);
    expect(__accept).toHaveBeenCalledTimes(1);
    expect(__accept).toHaveBeenCalledWith('/tmp/wt/b');

    await user.click(screen.getAllByTestId('worktree-switch-dismiss')[2]!);
    expect(__dismiss).toHaveBeenCalledTimes(1);
    expect(__dismiss).toHaveBeenCalledWith('/tmp/wt/c');
  });
});
