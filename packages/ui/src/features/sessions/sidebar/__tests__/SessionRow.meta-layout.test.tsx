/**
 * SessionRow — the title-floor / row starvation contract (#285 rework).
 *
 * session-row-layout.ts is the one place this contract is defined: the title
 * floor and the row's fixed PR region never yield; only the purely
 * decorative worktree glyph and tag dots give up width, each independently,
 * at its own container-query threshold. This file's regression proves that
 * an inflated decorative cluster — far more tags than any real session
 * carries today — still cannot take the title's floor away, and that a PR
 * can never become unreachable regardless of how many are detected.
 *
 * A fresh minimal harness (not the shared one from SessionRow.test.tsx):
 * nothing here clicks, renames, pins or archives, so it only needs the four
 * modules SessionRow reaches for on render, with constant returns and no
 * spies. vi.mock is hoisted per test file — sharing a harness would make
 * mock registration order depend on module-evaluation timing.
 */
import { isValidElement } from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DetectedPr } from '@qlan-ro/mainframe-types';
import type { SessionCustom, SessionItem } from '../../view-model/chat-to-thread-custom';
import {
  SESSION_ROW_DOT_THRESHOLD_NO_PR_PX,
  SESSION_ROW_DOT_THRESHOLD_PX,
  SESSION_ROW_DOT_YIELD_CLASS,
  SESSION_ROW_WORKTREE_THRESHOLD_NO_PR_PX,
  SESSION_ROW_WORKTREE_THRESHOLD_PX,
  SESSION_ROW_WORKTREE_YIELD_CLASS,
  SESSION_ROW_DOT_YIELD_CLASS_NO_PR,
  SESSION_ROW_WORKTREE_YIELD_CLASS_NO_PR,
} from '../session-row-layout';

vi.mock('@assistant-ui/react', () => ({
  ThreadListItemRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,

  ThreadListItemPrimitive: {
    Root: ({
      children,
      'data-testid': testId,
      className,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & { 'data-testid'?: string }) => (
      <div {...rest} data-testid={testId} className={className} data-active="false">
        {children}
      </div>
    ),
    Trigger: ({ children, asChild, ...rest }: React.HTMLAttributes<HTMLElement> & { asChild?: boolean }) => {
      if (asChild && isValidElement(children)) {
        return children;
      }
      return <button {...rest}>{children}</button>;
    },
  },

  useAssistantRuntime: () => ({
    threads: {
      getState: () => ({ threadItems: { 'chat-1': {} } }),
      getItemById: () => ({}),
    },
  }),

  useThreadListItemRuntime: () => ({}),

  useAuiState: (selector: (s: { thread: { id: string } }) => unknown) => selector({ thread: { id: '' } }),
}));

vi.mock('@/store/unread-store', () => ({
  useUnreadStore: (selector: (s: { unread: Set<string> }) => unknown) => selector({ unread: new Set() }),
}));

vi.mock('../../runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/lib/api/chats', () => ({
  pinChat: vi.fn(),
}));

const { SessionRow } = await import('../SessionRow');

function makeItem(overrides?: Partial<SessionCustom>): SessionItem {
  const custom: SessionCustom = {
    projectId: 'proj-1',
    adapterId: 'claude',
    tags: [],
    pinned: false,
    status: 'active',
    displayStatus: 'idle',
    hasPending: false,
    detectedPrs: [],
    worktreeMissing: false,
    transcriptMissing: false,
    updatedAt: 1749284160000,
    ...overrides,
  };
  return { id: 'chat-1', title: 'Build the sidebar', status: 'regular', custom };
}

it("a bloated decorative cluster cannot take the title's floor, and a PR is never unreachable", () => {
  const eightPrs: DetectedPr[] = Array.from({ length: 8 }, (_, i) => ({
    number: i + 1,
    url: `https://github.com/org/r/pull/${i + 1}`,
    owner: 'org',
    repo: 'r',
    source: i % 2 === 0 ? 'created' : 'mentioned',
  }));

  render(
    <SessionRow
      item={makeItem({
        detectedPrs: eightPrs,
        tags: ['a', 'b', 'c', 'd', 'e'],
        worktreePath: '/repos/mf/.git/worktrees/feat-x',
      })}
    />,
  );

  const title = screen.getByTestId('sessions-row-title');
  expect(title.className).toContain('min-w-[44px]');
  expect(title.className).toContain('truncate');
  expect(title.className.match(/min-w-\S+/g)).toHaveLength(1);

  const cluster = screen.getByTestId('sessions-row-meta-icons');
  expect(cluster.querySelectorAll('[data-testid^="sessions-row-meta-icon-pr-"]')).toHaveLength(0);

  const indicator = screen.getByTestId('sessions-row-pr-overflow');
  expect(indicator.textContent).toContain('8');
  expect(cluster.contains(indicator)).toBe(false);

  expect(screen.getByTestId('sessions-row-meta-icon-tag-dots').children).toHaveLength(3);
});

it('renders the inline chip, not the count indicator, for exactly one detected PR', () => {
  render(
    <SessionRow
      item={makeItem({
        detectedPrs: [
          { number: 42, url: 'https://github.com/org/r/pull/42', owner: 'org', repo: 'r', source: 'created' },
        ],
      })}
    />,
  );
  expect(screen.getByTestId('sessions-row-meta-icon-pr-42')).toBeTruthy();
  expect(screen.queryByTestId('sessions-row-pr-overflow')).toBeNull();
});

it('gives the worktree glyph and tag dots their own independent container-query yield class, on a row carrying a PR', () => {
  render(
    <SessionRow
      item={makeItem({
        worktreePath: '/repos/mf/.git/worktrees/feat-x',
        tags: ['a'],
        detectedPrs: [
          { number: 42, url: 'https://github.com/org/r/pull/42', owner: 'org', repo: 'r', source: 'created' },
        ],
      })}
    />,
  );

  expect(screen.getByTestId('sessions-row-meta-icon-worktree').className).toContain(SESSION_ROW_WORKTREE_YIELD_CLASS);
  expect(screen.getByTestId('sessions-row-meta-icon-tag-dots').className).toContain(SESSION_ROW_DOT_YIELD_CLASS);
});

it('keeps the worktree glyph available at the 280px sidebar floor for PR-bearing rows', () => {
  expect(SESSION_ROW_WORKTREE_THRESHOLD_PX).toBe(280);
  expect(SESSION_ROW_WORKTREE_YIELD_CLASS).toBe('@max-[280px]:hidden');
});

it('aligns yield classes to their exported thresholds without a one-pixel early reveal', () => {
  expect(SESSION_ROW_DOT_YIELD_CLASS).toBe(`@max-[${SESSION_ROW_DOT_THRESHOLD_PX}px]:hidden`);
  expect(SESSION_ROW_WORKTREE_YIELD_CLASS_NO_PR).toBe(`@max-[${SESSION_ROW_WORKTREE_THRESHOLD_NO_PR_PX}px]:hidden`);
  expect(SESSION_ROW_DOT_YIELD_CLASS_NO_PR).toBe(`@max-[${SESSION_ROW_DOT_THRESHOLD_NO_PR_PX}px]:hidden`);
});

it('gives a PR-less row the looser no-PR yield classes, since it never pays the PR affordance width cost', () => {
  render(<SessionRow item={makeItem({ worktreePath: '/repos/mf/.git/worktrees/feat-x', tags: ['a'] })} />);

  expect(screen.getByTestId('sessions-row-meta-icon-worktree').className).toContain(
    SESSION_ROW_WORKTREE_YIELD_CLASS_NO_PR,
  );
  expect(screen.getByTestId('sessions-row-meta-icon-tag-dots').className).toContain(SESSION_ROW_DOT_YIELD_CLASS_NO_PR);
});

it('reserves the trailing slot at rest, unaffected by how many PRs or tags the row carries', () => {
  const eightPrs: DetectedPr[] = Array.from({ length: 8 }, (_, i) => ({
    number: i + 1,
    url: `https://github.com/org/r/pull/${i + 1}`,
    owner: 'org',
    repo: 'r',
    source: 'created' as const,
  }));
  render(<SessionRow item={makeItem({ detectedPrs: eightPrs, tags: ['a', 'b', 'c', 'd'] })} />);

  const slot = screen.getByTestId('sessions-row-trailing-slot');
  expect(slot.style.width).toBe('78px');
  expect(screen.getByTestId('sessions-row-relative-time')).toBeTruthy();
});
