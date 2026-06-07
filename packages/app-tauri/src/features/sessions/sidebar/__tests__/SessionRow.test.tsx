/**
 * SessionRow — behavior tests (TDD red phase).
 *
 * Strategy:
 *  - Mock `@assistant-ui/react` so the assistant-ui hooks (useThreadListRuntime,
 *    useThreadListItemRuntime, useAuiState) are fully controlled per test.
 *    ThreadListItemPrimitive.Root is stubbed to a <div> that forwards data-testid
 *    and also sets data-active="true" when the stub state reports it is active.
 *    ThreadListItemPrimitive.Trigger is stubbed to a passthrough <span>.
 *    ThreadListItemRuntimeProvider just renders children.
 *  - Mock `@/store/unread-store` so isUnread is controlled per test.
 *  - Mock `../runtime/daemon-port-context` so useDaemonPort returns 31415.
 *  - Mock `@/lib/api/chats` so pinChat is a spy (never hits the network).
 *
 * Behaviors covered:
 *  1. item.id="chat-1", item.title="Build the sidebar" → renders
 *     data-testid="sessions-row" and text "Build the sidebar".
 *  2. custom.displayStatus='working' → sessions-row-status-dot aria-label="working".
 *  3. custom.hasPending=true (resolves 'waiting'), isUnread=false →
 *     sessions-row-status-dot aria-label="waiting".
 *  4. isUnread=true → sessions-row-title has class containing "font-semibold".
 *  5. useAuiState reports mainThreadId==='chat-1' → row carries data-active="true".
 *  6. Right-click → click sessions-ctx-rename → sessions-rename-input appears;
 *     committing new title calls itemRuntime.rename spy once with "New name".
 *  7. Right-click → click sessions-ctx-archive → itemRuntime.archive spy called once.
 *  8. sessions-row-relative-time renders non-empty text for updatedAt=1749284160000.
 */
import { isValidElement } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionCustom, SessionItem } from '../../view-model/chat-to-thread-custom';

// ---------------------------------------------------------------------------
// Mutable control flags — set per test before rendering
// ---------------------------------------------------------------------------

/** Controls what useAuiState returns per test. */
let __mainThreadId: string | null = null;

/** Controls whether useUnreadStore.isUnread returns true for 'chat-1'. */
let __isUnread = false;

/** Spies on itemRuntime.rename and .archive — reset per test. */
const renameSpy = vi.fn();
const archiveSpy = vi.fn();

// ---------------------------------------------------------------------------
// Mock @assistant-ui/react
// ---------------------------------------------------------------------------
//
// ThreadListItemPrimitive.Root is the native component that sets data-active
// when mainThreadId matches the item's id. In the test we replicate that
// behaviour by reading our __mainThreadId stub: if it equals 'chat-1' we set
// data-active="true", otherwise "false".
//
// ThreadListItemRuntimeProvider and ThreadListItemPrimitive.Trigger are
// passthrough stubs; useThreadListItemRuntime returns the rename/archive spies.
// useThreadListRuntime.getItemById returns a non-null dummy so the guard inside
// SessionRow passes (ItemRuntimeProvider receives a truthy runtime).
// useAuiState is used by deriving contexts internally — we forward the selector
// against a synthetic state so the component can compute mainThreadId checks.

vi.mock('@assistant-ui/react', () => ({
  ThreadListItemRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,

  ThreadListItemPrimitive: {
    Root: ({
      children,
      'data-testid': testId,
      className,
      ...rest
    }: React.HTMLAttributes<HTMLDivElement> & { 'data-testid'?: string }) => {
      const isActive = __mainThreadId === 'chat-1';
      return (
        <div {...rest} data-testid={testId} className={className} data-active={String(isActive)}>
          {children}
        </div>
      );
    },
    Trigger: ({ children, asChild, ...rest }: React.HTMLAttributes<HTMLElement> & { asChild?: boolean }) => {
      if (asChild && isValidElement(children)) {
        return children;
      }
      return <button {...rest}>{children}</button>;
    },
  },

  useThreadListRuntime: () => ({
    getItemById: (_id: string) => ({ rename: renameSpy, archive: archiveSpy }),
  }),

  useThreadListItemRuntime: () => ({ rename: renameSpy, archive: archiveSpy }),

  useAuiState: (selector: (s: { thread: { id: string } }) => unknown) =>
    selector({ thread: { id: __mainThreadId ?? '' } }),
}));

// ---------------------------------------------------------------------------
// Mock @/store/unread-store
// ---------------------------------------------------------------------------

vi.mock('@/store/unread-store', () => ({
  useUnreadStore: (selector: (s: { isUnread: (id: string) => boolean }) => unknown) =>
    selector({ isUnread: (id: string) => id === 'chat-1' && __isUnread }),
}));

// ---------------------------------------------------------------------------
// Mock ../runtime/daemon-port-context
// ---------------------------------------------------------------------------

vi.mock('../runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));

// ---------------------------------------------------------------------------
// Mock @/lib/api/chats
// ---------------------------------------------------------------------------

const pinChatSpy = vi.fn().mockResolvedValue({});

vi.mock('@/lib/api/chats', () => ({
  pinChat: (...args: unknown[]) => pinChatSpy(...args),
}));

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are registered
// ---------------------------------------------------------------------------

const { SessionRow } = await import('../SessionRow');

// ---------------------------------------------------------------------------
// Shared fixture builder
// ---------------------------------------------------------------------------

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
    updatedAt: 1749284160000,
    ...overrides,
  };
  return { id: 'chat-1', title: 'Build the sidebar', status: 'regular', custom };
}

// ---------------------------------------------------------------------------
// Reset per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  __mainThreadId = null;
  __isUnread = false;
  renameSpy.mockReset();
  archiveSpy.mockReset();
  pinChatSpy.mockReset();
  pinChatSpy.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// 1. Row renders with title text
// ---------------------------------------------------------------------------

describe('SessionRow — renders row and title', () => {
  it('renders data-testid="sessions-row" with text "Build the sidebar"', () => {
    render(<SessionRow item={makeItem()} />);
    expect(screen.getByTestId('sessions-row')).toBeTruthy();
    expect(screen.getByText('Build the sidebar')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Status dot: displayStatus='working' → aria-label="working"
// ---------------------------------------------------------------------------

describe('SessionRow — status dot aria-label when displayStatus=working', () => {
  it('renders sessions-row-status-dot with aria-label="working"', () => {
    render(<SessionRow item={makeItem({ displayStatus: 'working' })} />);
    const dot = screen.getByTestId('sessions-row-status-dot');
    expect(dot.getAttribute('aria-label')).toBe('working');
  });
});

// ---------------------------------------------------------------------------
// 3. Status dot: hasPending=true + isUnread=false → aria-label="waiting"
// ---------------------------------------------------------------------------

describe('SessionRow — status dot aria-label when hasPending=true and not unread', () => {
  it('renders sessions-row-status-dot with aria-label="waiting"', () => {
    __isUnread = false;
    render(<SessionRow item={makeItem({ hasPending: true, displayStatus: 'idle' })} />);
    const dot = screen.getByTestId('sessions-row-status-dot');
    expect(dot.getAttribute('aria-label')).toBe('waiting');
  });
});

// ---------------------------------------------------------------------------
// 4. Unread → title has font-semibold class
// ---------------------------------------------------------------------------

describe('SessionRow — title is font-semibold when isUnread=true', () => {
  it('sessions-row-title className contains "font-semibold" when unread', () => {
    __isUnread = true;
    render(<SessionRow item={makeItem()} />);
    const title = screen.getByTestId('sessions-row-title');
    expect(title.className).toContain('font-semibold');
  });
});

// ---------------------------------------------------------------------------
// 5. Native data-active="true" when mainThreadId==='chat-1'
// ---------------------------------------------------------------------------

describe('SessionRow — data-active="true" when mainThreadId matches item.id', () => {
  it('row carries data-active="true" when useAuiState reports mainThreadId="chat-1"', () => {
    __mainThreadId = 'chat-1';
    render(<SessionRow item={makeItem()} />);
    expect(screen.getByTestId('sessions-row').getAttribute('data-active')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// 6. Right-click → rename → input appears → commit calls rename spy
// ---------------------------------------------------------------------------

describe('SessionRow — right-click rename flow calls itemRuntime.rename', () => {
  it('shows rename input after clicking sessions-ctx-rename, then calls rename once with "New name"', async () => {
    render(<SessionRow item={makeItem()} />);

    // Open context menu via right-click on the row
    fireEvent.contextMenu(screen.getByTestId('sessions-row'));

    // Click Rename in the context menu
    const renameItem = screen.getByTestId('sessions-ctx-rename');
    await userEvent.click(renameItem);

    // Rename input should now be visible
    const input = screen.getByTestId('sessions-rename-input') as HTMLInputElement;
    expect(input).toBeTruthy();

    // Type new title and press Enter to commit
    await userEvent.clear(input);
    await userEvent.type(input, 'New name');
    await userEvent.keyboard('{Enter}');

    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledWith('New name');
  });
});

// ---------------------------------------------------------------------------
// 7. Right-click → archive → calls itemRuntime.archive once
// ---------------------------------------------------------------------------

describe('SessionRow — right-click archive calls itemRuntime.archive', () => {
  it('calls archive spy exactly once when sessions-ctx-archive is clicked', async () => {
    render(<SessionRow item={makeItem()} />);

    fireEvent.contextMenu(screen.getByTestId('sessions-row'));

    await act(async () => {
      await userEvent.click(screen.getByTestId('sessions-ctx-archive'));
    });

    expect(archiveSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Relative time renders non-empty text for updatedAt=1749284160000
// ---------------------------------------------------------------------------

describe('SessionRow — relative time renders non-empty text', () => {
  it('sessions-row-relative-time is non-empty for updatedAt=1749284160000', () => {
    render(<SessionRow item={makeItem({ updatedAt: 1749284160000 })} />);
    const timeEl = screen.getByTestId('sessions-row-relative-time');
    expect(timeEl.textContent?.trim().length).toBeGreaterThan(0);
  });
});
