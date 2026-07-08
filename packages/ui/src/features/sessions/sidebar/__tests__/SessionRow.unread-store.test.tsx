import { isValidElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { SessionCustom, SessionItem } from '../../view-model/chat-to-thread-custom';
import { useUnreadStore } from '@/store/unread-store';

let __mainThreadId: string | null = null;

const renameSpy = vi.fn();
const archiveSpy = vi.fn();
const reloadSpy = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  ThreadListItemRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,

  ThreadListItemPrimitive: {
    Root: ({
      children,
      'data-testid': testId,
      className,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & { 'data-testid'?: string }) => (
      <div {...rest} data-testid={testId} className={className} data-active={String(__mainThreadId === 'thread-1')}>
        {children}
      </div>
    ),
    Trigger: ({ children, asChild, ...rest }: React.HTMLAttributes<HTMLElement> & { asChild?: boolean }) => {
      if (asChild && isValidElement(children)) return children;
      return <button {...rest}>{children}</button>;
    },
  },

  useAssistantRuntime: () => ({
    threads: {
      getState: () => ({ threadItems: { 'thread-1': {}, 'chat-1': {} } }),
      getItemById: (_id: string) => ({ rename: renameSpy, archive: archiveSpy }),
      reload: reloadSpy,
    },
  }),

  useThreadListItemRuntime: () => ({ rename: renameSpy, archive: archiveSpy }),

  useAuiState: (selector: (s: { thread: { id: string } }) => unknown) =>
    selector({ thread: { id: __mainThreadId ?? '' } }),
}));

vi.mock('../../runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

vi.mock('@/lib/api/chats', () => ({
  pinChat: vi.fn().mockResolvedValue({}),
}));

const { SessionRow } = await import('../SessionRow');

function makeItem(overrides: Partial<SessionItem> = {}): SessionItem {
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
    updatedAt: 1749284160000,
  };
  return {
    id: 'thread-1',
    remoteId: 'chat-1',
    title: 'Build the sidebar',
    status: 'regular',
    custom,
    ...overrides,
  };
}

beforeEach(() => {
  __mainThreadId = null;
  renameSpy.mockReset();
  archiveSpy.mockReset();
  reloadSpy.mockReset();
  useUnreadStore.setState({ unread: new Set() });
});

describe('SessionRow — unread store integration', () => {
  it('updates the provider logo to full color when the stable row id becomes unread', () => {
    render(<SessionRow item={makeItem({ id: 'chat-1', remoteId: 'chat-1' })} />);

    const logo = screen.getByTestId('sessions-row-status-dot');
    expect(logo.className).toContain('opacity-50');

    act(() => {
      useUnreadStore.getState().markUnread('chat-1');
    });

    expect(logo.className).not.toContain('opacity-50');
    expect(screen.getByTestId('sessions-row-title').className).toContain('font-bold');
  });

  it('uses the daemon remoteId when unread notifications arrive for an adopted thread', () => {
    render(<SessionRow item={makeItem()} />);

    act(() => {
      useUnreadStore.getState().markUnread('chat-1');
    });

    expect(screen.getByTestId('sessions-row-status-dot').className).not.toContain('opacity-50');
    expect(screen.getByTestId('sessions-row-title').className).toContain('font-bold');
  });
});
