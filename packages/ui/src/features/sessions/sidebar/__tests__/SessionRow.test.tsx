/**
 * SessionRow — behavior tests (TDD red phase).
 *
 * Strategy:
 *  - Mock `@assistant-ui/react` so the assistant-ui hooks (useAssistantRuntime,
 *    useThreadListItemRuntime, useAuiState) are fully controlled per test.
 *    ThreadListItemPrimitive.Root is stubbed to a <div> that forwards data-testid
 *    and also sets data-active="true" when the stub state reports it is active.
 *    ThreadListItemPrimitive.Trigger is stubbed to a passthrough <span>.
 *    ThreadListItemRuntimeProvider just renders children.
 *  - Mock `@/store/unread-store` so isUnread is controlled per test.
 *  - Mock `../../runtime/daemon-port-context` so useDaemonPort returns 31415.
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
 *  9. (replaced) StatusDot/AnswerPill badge presentation tests.
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

/** Spy on runtime.threads.reload — reset per test. */
const reloadSpy = vi.fn();

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
// useAssistantRuntime().threads.getItemById returns a non-null dummy so the
// guard inside SessionRow passes (ItemRuntimeProvider receives a truthy runtime).
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

  useAssistantRuntime: () => ({
    threads: {
      getState: () => ({ threadItems: { 'chat-1': {} } }),
      getItemById: (_id: string) => ({ rename: renameSpy, archive: archiveSpy }),
      reload: reloadSpy,
    },
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
// Mock ../../runtime/daemon-port-context
// ---------------------------------------------------------------------------

vi.mock('../../runtime/daemon-port-context', () => ({
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

const { SessionRow, StatusDot, AnswerPill } = await import('../SessionRow');

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
  reloadSpy.mockReset();
  reloadSpy.mockResolvedValue(undefined);
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

// ---------------------------------------------------------------------------
// 9. Badge presentation — StatusDot + AnswerPill standalone unit tests
// ---------------------------------------------------------------------------

describe('session row badge presentation', () => {
  it('waiting + unread → amber ping-halo dot + Answer ready pill', () => {
    render(
      <>
        <StatusDot badge={{ base: 'waiting', unread: true }} />
        <AnswerPill badge={{ base: 'waiting', unread: true }} />
      </>,
    );
    const dot = screen.getByTestId('sessions-row-status-dot');
    // The dot uses a ping-halo structure: the outer container has a child
    // span with the amber color and animate-ping (the halo beacon).
    const halo = dot.querySelector('.bg-mf-warning');
    expect(halo).toBeTruthy();
    expect(screen.getByText('Answer ready')).toBeTruthy();
  });
  it('waiting + seen → Your turn pill', () => {
    render(<AnswerPill badge={{ base: 'waiting', unread: false }} />);
    expect(screen.getByText('Your turn')).toBeTruthy();
  });
  it('idle + unread → accent-tinted dot, no pill', () => {
    render(
      <>
        <StatusDot badge={{ base: 'idle', unread: true }} />
        <AnswerPill badge={{ base: 'idle', unread: true }} />
      </>,
    );
    expect(screen.getByTestId('sessions-row-status-dot').className).toContain('bg-primary');
    expect(screen.queryByText('Answer ready')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9b. AnswerPill visible in full row render when hasPending=true (via SessionRowMeta)
// ---------------------------------------------------------------------------

describe('SessionRow — answer pill visible when hasPending=true', () => {
  it('renders sessions-row-answer-pill with text "Your turn" when hasPending=true and not unread', () => {
    __isUnread = false;
    render(<SessionRow item={makeItem({ hasPending: true, displayStatus: 'idle' })} />);
    const pill = screen.getByTestId('sessions-row-answer-pill');
    expect(pill.textContent).toBe('Your turn');
  });

  it('renders sessions-row-answer-pill with text "Answer ready" when hasPending=true and unread', () => {
    __isUnread = true;
    render(<SessionRow item={makeItem({ hasPending: true, displayStatus: 'idle' })} />);
    const pill = screen.getByTestId('sessions-row-answer-pill');
    expect(pill.textContent).toBe('Answer ready');
  });

  it('does not render sessions-row-answer-pill when status is idle', () => {
    render(<SessionRow item={makeItem({ hasPending: false, displayStatus: 'idle' })} />);
    expect(screen.queryByTestId('sessions-row-answer-pill')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. Tag dots cluster renders when custom.tags is non-empty
// ---------------------------------------------------------------------------

describe('SessionRow — tag dots cluster when tags are present', () => {
  it('renders sessions-row-meta-tag-dots when custom.tags has entries', () => {
    render(<SessionRow item={makeItem({ tags: ['alpha', 'beta'] })} />);
    expect(screen.getByTestId('sessions-row-meta-tag-dots')).toBeTruthy();
  });

  it('does not render sessions-row-meta-tag-dots when custom.tags is empty', () => {
    render(<SessionRow item={makeItem({ tags: [] })} />);
    expect(screen.queryByTestId('sessions-row-meta-tag-dots')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. Pin triggers runtime.threads.reload() (MED-3/4)
// ---------------------------------------------------------------------------

describe('SessionRow — pin calls runtime.threads.reload() on success', () => {
  it('calls reloadSpy once after pinChat(true) resolves when sessions-ctx-pin is clicked', async () => {
    // pinned=false so the context menu shows the "Pin" action
    render(<SessionRow item={makeItem({ pinned: false })} />);

    fireEvent.contextMenu(screen.getByTestId('sessions-row'));
    await act(async () => {
      await userEvent.click(screen.getByTestId('sessions-ctx-pin'));
    });

    expect(pinChatSpy).toHaveBeenCalledTimes(1);
    expect(pinChatSpy).toHaveBeenCalledWith(31415, 'chat-1', true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 13. data-chat-id on the row for deterministic e2e selection
// ---------------------------------------------------------------------------

describe('SessionRow — exposes data-chat-id on the row', () => {
  it('exposes the chat id on the row for deterministic e2e selection', () => {
    render(<SessionRow item={makeItem()} />);
    expect(screen.getByTestId('sessions-row')).toHaveAttribute('data-chat-id', 'chat-1');
  });
});

// ---------------------------------------------------------------------------
// 14. AnswerPill design-parity (artboard Phase-3 majors)
// ---------------------------------------------------------------------------

describe('AnswerPill design-parity', () => {
  it('"Answer ready" pill uses solid amber fill (bg-mf-warning) with white text', () => {
    render(<AnswerPill badge={{ base: 'waiting', unread: true }} />);
    const pill = screen.getByTestId('sessions-row-answer-pill');
    expect(pill.className).toContain('bg-mf-warning');
    expect(pill.className).toContain('text-white');
  });

  it('"Answer ready" pill uses rounded-[5px] (not rounded-full)', () => {
    render(<AnswerPill badge={{ base: 'waiting', unread: true }} />);
    const pill = screen.getByTestId('sessions-row-answer-pill');
    expect(pill.className).toContain('rounded-[5px]');
    expect(pill.className).not.toContain('rounded-full');
  });

  it('"Your turn" pill uses rounded-[5px] (not rounded-full)', () => {
    render(<AnswerPill badge={{ base: 'waiting', unread: false }} />);
    const pill = screen.getByTestId('sessions-row-answer-pill');
    expect(pill.className).toContain('rounded-[5px]');
    expect(pill.className).not.toContain('rounded-full');
  });

  it('"Your turn" pill uses amber shadow ring (not generic border)', () => {
    render(<AnswerPill badge={{ base: 'waiting', unread: false }} />);
    const pill = screen.getByTestId('sessions-row-answer-pill');
    expect(pill.className).toContain('shadow-[inset');
    expect(pill.className).not.toContain('border:0.5px_solid_var(--border)');
  });
});

// ---------------------------------------------------------------------------
// 15. StatusDot waiting-unread ping-halo (artboard Phase-3 majors)
// ---------------------------------------------------------------------------

describe('StatusDot waiting-unread ping-halo', () => {
  it('waiting + unread status dot renders a child halo span with animate-ping class', () => {
    render(<StatusDot badge={{ base: 'waiting', unread: true }} />);
    const dot = screen.getByTestId('sessions-row-status-dot');
    // The halo is a child element with animate-ping
    const halo = dot.querySelector('.animate-ping');
    expect(halo).toBeTruthy();
  });

  it('waiting + seen status dot does NOT render animate-ping halo', () => {
    render(<StatusDot badge={{ base: 'waiting', unread: false }} />);
    const dot = screen.getByTestId('sessions-row-status-dot');
    expect(dot.querySelector('.animate-ping')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. Unpin triggers runtime.threads.reload() (MED-3/4)
// ---------------------------------------------------------------------------

describe('SessionRow — unpin calls runtime.threads.reload() on success', () => {
  it('calls reloadSpy once after pinChat(false) resolves when sessions-ctx-pin is clicked while pinned', async () => {
    // pinned=true so the context menu shows the "Unpin" action
    render(<SessionRow item={makeItem({ pinned: true })} />);

    fireEvent.contextMenu(screen.getByTestId('sessions-row'));
    await act(async () => {
      await userEvent.click(screen.getByTestId('sessions-ctx-pin'));
    });

    expect(pinChatSpy).toHaveBeenCalledTimes(1);
    expect(pinChatSpy).toHaveBeenCalledWith(31415, 'chat-1', false);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});
