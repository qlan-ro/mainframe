/**
 * SessionRow — the title-floor / meta-cluster yield contract.
 *
 * session-row-layout.ts is the one place this contract is defined: a new
 * meta glyph goes INSIDE SessionRowMetaIcons's cluster (and inherits the
 * yield behavior for free), never beside it. This file's regression proves
 * that an inflated meta cluster — far more items than any real session
 * carries today — still cannot take the title's floor away.
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

it("a bloated meta cluster cannot take the title's floor", () => {
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
  expect(cluster.querySelectorAll('[data-testid^="sessions-row-meta-icon-pr-"]')).toHaveLength(2);

  const indicator = screen.getByTestId('sessions-row-pr-overflow');
  expect(indicator.textContent).toContain('8');
  expect(cluster.contains(indicator)).toBe(false);

  expect(screen.getByTestId('sessions-row-meta-icon-tag-dots').children).toHaveLength(3);
});
