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
 *  - Mock `@/store/unread-store` so unread state is controlled per test.
 *  - Mock `../../runtime/daemon-port-context` so useDaemonPort returns 31415.
 *  - Mock `@/lib/api/chats` so pinChat is a spy (never hits the network).
 */
import { isValidElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionCustom, SessionItem } from '../../view-model/chat-to-thread-custom';
import type { SessionBadge } from '../../view-model/session-status';
import { useTagPopoverTarget } from '../../tags/use-tag-popover-target';

// ---------------------------------------------------------------------------
// Mutable control flags — set per test before rendering
// ---------------------------------------------------------------------------

/** Controls what useAuiState returns per test. */
let __mainThreadId: string | null = null;

/** Controls whether useUnreadStore.unread contains 'chat-1'. */
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
  useUnreadStore: (selector: (s: { unread: Set<string>; isUnread: (id: string) => boolean }) => unknown) =>
    selector({
      unread: __isUnread ? new Set(['chat-1']) : new Set(),
      isUnread: (id: string) => id === 'chat-1' && __isUnread,
    }),
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

const { SessionRow, StatusDot } = await import('../SessionRow');

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
    transcriptMissing: false,
    updatedAt: 1749284160000,
    ...overrides,
  };
  return { id: 'chat-1', title: 'Build the sidebar', status: 'regular', custom };
}

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

afterEach(() => {
  // Some tests open the tag popover via the shared store; keep it from leaking.
  useTagPopoverTarget.getState().close();
});

it('renders data-testid="sessions-row" with text "Build the sidebar"', () => {
  render(<SessionRow item={makeItem()} />);
  expect(screen.getByTestId('sessions-row')).toBeTruthy();
  expect(screen.getByText('Build the sidebar')).toBeTruthy();
});

it('renders sessions-row-status-dot with aria-label="working"', () => {
  render(<SessionRow item={makeItem({ adapterId: 'codex', displayStatus: 'working' })} />);
  const dot = screen.getByTestId('sessions-row-status-dot');
  expect(dot.getAttribute('aria-label')).toBe('working');
  expect(screen.getByTestId('sessions-row-provider-logo')).toHaveAttribute('data-provider-id', 'openai');
});

it('renders sessions-row-status-dot with aria-label="waiting" when hasPending=true and not unread', () => {
  __isUnread = false;
  render(<SessionRow item={makeItem({ hasPending: true, displayStatus: 'idle' })} />);
  const dot = screen.getByTestId('sessions-row-status-dot');
  expect(dot.getAttribute('aria-label')).toBe('waiting');
});

it('sessions-row-title className contains "font-bold" when unread', () => {
  __isUnread = true;
  render(<SessionRow item={makeItem()} />);
  const title = screen.getByTestId('sessions-row-title');
  expect(title.className).toContain('font-bold');
});

it('does not make the selected read title use unread typography', () => {
  __mainThreadId = 'chat-1';
  __isUnread = false;
  render(<SessionRow item={makeItem()} />);

  const title = screen.getByTestId('sessions-row-title');
  expect(title.className).not.toContain('group-data-[active=true]:font-semibold');
  expect(title.className).not.toContain('group-data-[active=true]:text-foreground');
  expect(title.className).toContain('font-medium text-muted-foreground');
});

it('keeps a pinned read title muted while still rendering the pin glyph', () => {
  render(<SessionRow item={makeItem({ pinned: true })} />);

  const title = screen.getByTestId('sessions-row-title');
  expect(title.className).not.toContain('font-bold');
  expect(title.className).toContain('font-medium text-muted-foreground');
  expect(screen.getByTestId('sessions-row-pin-glyph')).toBeTruthy();
});

it('shows rename input after clicking sessions-ctx-rename, then calls rename once with "New name"', async () => {
  render(<SessionRow item={makeItem()} />);

  fireEvent.contextMenu(screen.getByTestId('sessions-row'));

  const renameItem = screen.getByTestId('sessions-ctx-rename');
  await userEvent.click(renameItem);

  const input = screen.getByTestId('sessions-rename-input') as HTMLInputElement;
  expect(input).toBeTruthy();

  await userEvent.clear(input);
  await userEvent.type(input, 'New name');
  await userEvent.keyboard('{Enter}');

  expect(renameSpy).toHaveBeenCalledTimes(1);
  expect(renameSpy).toHaveBeenCalledWith('New name');
});

it('calls archive spy exactly once when sessions-ctx-archive is clicked', async () => {
  render(<SessionRow item={makeItem()} />);

  fireEvent.contextMenu(screen.getByTestId('sessions-row'));

  await act(async () => {
    await userEvent.click(screen.getByTestId('sessions-ctx-archive'));
  });

  expect(archiveSpy).toHaveBeenCalledTimes(1);
});

it('sessions-row-relative-time is non-empty for updatedAt=1749284160000', () => {
  render(<SessionRow item={makeItem({ updatedAt: 1749284160000 })} />);
  const timeEl = screen.getByTestId('sessions-row-relative-time');
  expect(timeEl.textContent?.trim().length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// StatusDot badge presentation — one row per status/unread/adapter combination.
// StatusDot is the row's sole status indicator (the old AnswerPill is gone).
// ---------------------------------------------------------------------------

it.each<{
  name: string;
  badge: SessionBadge;
  adapterId: string;
  toContain: string[];
  notToContain: string[];
  providerId?: string;
}>([
  {
    name: 'waiting + unread → vivid pulsing provider logo, no warning color',
    badge: { base: 'waiting', unread: true },
    adapterId: 'claude',
    toContain: ['animate-pulse'],
    notToContain: ['text-mf-warning', 'opacity-50'],
    providerId: 'claude',
  },
  {
    name: 'idle + unread → accent-tinted, non-pulsing provider logo',
    badge: { base: 'idle', unread: true },
    adapterId: 'gemini',
    toContain: ['text-primary'],
    notToContain: ['animate-pulse'],
    providerId: 'gemini',
  },
  {
    name: 'idle + read → muted provider logo',
    badge: { base: 'idle', unread: false },
    adapterId: 'opencode',
    toContain: ['text-mf-text-3'],
    notToContain: ['opacity-50', 'grayscale', 'animate-pulse'],
    providerId: 'opencode',
  },
  {
    name: 'working + read → rotating full-colour provider logo',
    badge: { base: 'working', unread: false },
    adapterId: 'codex',
    toContain: ['animate-spin', 'text-primary'],
    notToContain: ['opacity-50', 'grayscale'],
    providerId: 'openai',
  },
  {
    name: 'working Claude → uses the Claude avatar motion instead of generic spin',
    badge: { base: 'working', unread: false },
    adapterId: 'claude',
    toContain: ['animate-[mf-claude-logo-working_1.52s_linear_infinite]'],
    notToContain: ['animate-spin'],
    providerId: 'claude',
  },
  {
    name: 'worktree missing + read → does not make the provider logo destructive',
    badge: { base: 'worktree-missing', unread: false },
    adapterId: 'claude',
    toContain: [],
    notToContain: ['text-destructive', 'opacity-50', 'grayscale'],
  },
])('StatusDot: $name', ({ badge, adapterId, toContain, notToContain, providerId }) => {
  render(<StatusDot badge={badge} adapterId={adapterId} />);
  const dot = screen.getByTestId('sessions-row-status-dot');
  for (const cls of toContain) expect(dot.className).toContain(cls);
  for (const cls of notToContain) expect(dot.className).not.toContain(cls);
  if (providerId) {
    expect(screen.getByTestId('sessions-row-provider-logo')).toHaveAttribute('data-provider-id', providerId);
  }
});

// ---------------------------------------------------------------------------
// StatusDot — Hint tooltip labels per badge state
// ---------------------------------------------------------------------------

it.each<{ base: SessionBadge['base']; unread: boolean; label: string }>([
  { base: 'worktree-missing', unread: false, label: 'Worktree missing' },
  { base: 'working', unread: false, label: 'Working' },
  { base: 'waiting', unread: true, label: 'Your turn' },
  { base: 'waiting', unread: false, label: 'Your turn' },
  { base: 'idle', unread: true, label: 'Unread response' },
  { base: 'idle', unread: false, label: 'Idle' },
])('shows "$label" on hover when badge.base=$base and unread=$unread', async ({ base, unread, label }) => {
  const user = userEvent.setup();
  render(<StatusDot badge={{ base, unread }} />);
  await user.hover(screen.getByTestId('sessions-row-status-dot'));
  expect(screen.getByRole('tooltip')).toHaveTextContent(label);
});

describe('SessionRow — compact tag-dot glyphs when tags are present', () => {
  it('renders sessions-row-meta-icon-tag-dots when custom.tags has entries', () => {
    render(<SessionRow item={makeItem({ tags: ['alpha', 'beta'] })} />);
    expect(screen.getByTestId('sessions-row-meta-icon-tag-dots')).toBeTruthy();
  });

  it('does not render sessions-row-meta-icon-tag-dots when custom.tags is empty', () => {
    render(<SessionRow item={makeItem({ tags: [] })} />);
    expect(screen.queryByTestId('sessions-row-meta-icon-tag-dots')).toBeNull();
  });
});

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

it('exposes the chat id on the row for deterministic e2e selection', () => {
  render(<SessionRow item={makeItem()} />);
  expect(screen.getByTestId('sessions-row')).toHaveAttribute('data-chat-id', 'chat-1');
});

describe('StatusDot provider logos', () => {
  it('waiting + unread status logo uses animate-pulse', () => {
    render(<StatusDot badge={{ base: 'waiting', unread: true }} adapterId="claude" />);
    const dot = screen.getByTestId('sessions-row-status-dot');
    expect(dot.className).toContain('animate-pulse');
  });

  it('waiting + seen status logo DOES animate-pulse at full colour', () => {
    render(<StatusDot badge={{ base: 'waiting', unread: false }} adapterId="claude" />);
    const dot = screen.getByTestId('sessions-row-status-dot');
    expect(dot.className).toContain('animate-pulse');
    expect(dot.className).toContain('text-primary');
    expect(dot.className).not.toContain('opacity-50');
    expect(dot.className).not.toContain('grayscale');
  });

  it('status logo wrapper uses a 24px slot and a 20px logo (2026-07 single-row compaction)', () => {
    render(<StatusDot badge={{ base: 'waiting', unread: false }} adapterId="claude" />);
    const dot = screen.getByTestId('sessions-row-status-dot');
    const logo = screen.getByTestId('sessions-row-provider-logo');
    expect(dot.className).toContain('size-6');
    expect(logo.getAttribute('class')).toContain('size-5');
  });

  it('unknown adapter falls back to the generic provider logo identity', () => {
    render(<StatusDot badge={{ base: 'idle', unread: false }} adapterId="custom-cli" />);
    expect(screen.getByTestId('sessions-row-provider-logo')).toHaveAttribute('data-provider-id', 'unknown');
  });
});

it('working status logo uses the same 24px slot as every other status', () => {
  render(<StatusDot badge={{ base: 'working', unread: false }} adapterId="codex" />);
  const dot = screen.getByTestId('sessions-row-status-dot');
  expect(dot.className).toContain('size-6');
  expect(dot.className).not.toContain('size-[8px]');
});

// ---------------------------------------------------------------------------
// 17. Row hover-action glyphs. The inline Rename shortcut was removed — the
// right-click context menu (SessionContextMenu) already offers Rename. The
// Archive hover action uses the ArchiveIcon glyph (was the xmark glyph before
// the archive-confirm-flow rework).
// ---------------------------------------------------------------------------

describe('SessionRow hover-action glyphs', () => {
  it('has no inline Rename hover-action button (right-click context menu covers it)', () => {
    render(<SessionRow item={makeItem()} />);
    expect(screen.queryByTestId('sessions-row-action-rename')).toBeNull();
  });

  it('Archive action uses the ArchiveIcon glyph, not the xmark glyph', () => {
    render(<SessionRow item={makeItem()} />);
    const btn = screen.getByTestId('sessions-row-action-archive');
    expect(btn.querySelector('svg.lucide-archive')).toBeTruthy();
    expect(btn.querySelector('svg.lucide-x')).toBeNull();
  });
});

describe('SessionRow — hover-actions Pin/Unpin toggle', () => {
  it('calls pinChat(port, id, true) and reloads when unpinned and the hover pin action is clicked', async () => {
    render(<SessionRow item={makeItem({ pinned: false })} />);

    await act(async () => {
      await userEvent.click(screen.getByTestId('sessions-row-action-pin'));
    });

    expect(pinChatSpy).toHaveBeenCalledTimes(1);
    expect(pinChatSpy).toHaveBeenCalledWith(31415, 'chat-1', true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('calls pinChat(port, id, false) and reloads when pinned and the hover pin action is clicked', async () => {
    render(<SessionRow item={makeItem({ pinned: true })} />);

    await act(async () => {
      await userEvent.click(screen.getByTestId('sessions-row-action-pin'));
    });

    expect(pinChatSpy).toHaveBeenCalledTimes(1);
    expect(pinChatSpy).toHaveBeenCalledWith(31415, 'chat-1', false);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it('does not select the row when the hover pin action is clicked (stopPropagation)', async () => {
    const rowClickSpy = vi.fn();
    render(
      <div onClick={rowClickSpy}>
        <SessionRow item={makeItem({ pinned: false })} />
      </div>,
    );

    await act(async () => {
      await userEvent.click(screen.getByTestId('sessions-row-action-pin'));
    });

    expect(rowClickSpy).not.toHaveBeenCalled();
  });
});

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

// ---------------------------------------------------------------------------
// Regression: Tags context-menu action anchors popover at right-click coords
//
// Bug: the context-menu "Tags" path called handleTags with no rect, so
// anchorRect was null and the popover rendered at (0,0).
// Fix: onContextMenu on the inner trigger div captures clientX/clientY into a
// ref; the context-menu onTags builds new DOMRect(x, y, 0, 0) from that ref.
// This test guards against a regression to the null/(0,0) anchor.
// ---------------------------------------------------------------------------

it('sets anchorRect.left=120 and anchorRect.top=80 after right-clicking at (120, 80) and selecting Tags', async () => {
  render(<SessionRow item={makeItem()} />);

  // Dispatch contextMenu on an inner element (the title span) so the event
  // bubbles through the div that carries onContextMenu and captures the coords.
  fireEvent.contextMenu(screen.getByTestId('sessions-row-title'), {
    clientX: 120,
    clientY: 80,
  });

  await act(async () => {
    await userEvent.click(screen.getByTestId('sessions-ctx-tags'));
  });

  const { target } = useTagPopoverTarget.getState();
  expect(target).not.toBeNull();
  expect(target?.anchorRect).not.toBeNull();
  // Hardcoded coords — must equal the right-click position, not (0,0).
  expect(target?.anchorRect?.left).toBe(120);
  expect(target?.anchorRect?.top).toBe(80);
});

// ---------------------------------------------------------------------------
// Regression (bug b): right-click "Tags" never opened the popover live.
//
// A first attempt deferred the store update with `queueMicrotask` (mirroring
// onRename). That is provably insufficient: Radix's ContextMenu is a MODAL
// DismissableLayer (`@radix-ui/react-menu`, `modal=true` by default). Closing
// it on select schedules a focus-restoration callback (its FocusScope hands
// focus back to the trigger) via `requestAnimationFrame` — which always runs
// AFTER the microtask queue drains. A `queueMicrotask`-deferred open lets our
// popover grab focus (it autofocuses its search input) BEFORE that rAF fires;
// when the rAF then steals focus back to the row, our popover's own
// FocusScope reads that as "focus moved outside" and dismisses itself. Net
// effect live: the popover flashes open and instantly closes.
//
// The fix must defer past a macrotask (`setTimeout`), which reliably runs
// after that rAF-scheduled focus restoration. This test proves the mechanism
// directly: with fake timers, a microtask-only flush must NOT be enough to
// open the popover; only flushing a macrotask does.
// ---------------------------------------------------------------------------

describe('SessionRow — Tags context-menu action defers past a macrotask (not just a microtask)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not open the tag popover synchronously within the click dispatch', () => {
    render(<SessionRow item={makeItem()} />);

    fireEvent.contextMenu(screen.getByTestId('sessions-row'));
    fireEvent.click(screen.getByTestId('sessions-ctx-tags'));

    expect(useTagPopoverTarget.getState().target).toBeNull();
  });

  it('does NOT open merely from flushing the microtask queue (a microtask alone is not a safe-enough defer)', async () => {
    render(<SessionRow item={makeItem()} />);

    fireEvent.contextMenu(screen.getByTestId('sessions-row'));
    fireEvent.click(screen.getByTestId('sessions-ctx-tags'));
    await Promise.resolve();
    await Promise.resolve();

    expect(useTagPopoverTarget.getState().target).toBeNull();
  });

  it('opens the tag popover once the deferred macrotask runs', async () => {
    render(<SessionRow item={makeItem()} />);

    fireEvent.contextMenu(screen.getByTestId('sessions-row'));
    fireEvent.click(screen.getByTestId('sessions-ctx-tags'));
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(useTagPopoverTarget.getState().target).not.toBeNull();
  });
});

describe('SessionRow — hovering raises the SessionMetaCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows sessions-meta-card with the row title after the hover delay', async () => {
    render(<SessionRow item={makeItem()} />);

    fireEvent.mouseEnter(screen.getByTestId('sessions-row').firstChild as Element);
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(screen.getByTestId('sessions-meta-card')).toBeTruthy();
    expect(screen.getByTestId('sessions-meta-card-title').textContent).toBe('Build the sidebar');
  });

  it('hides the card again on mouse-leave', async () => {
    render(<SessionRow item={makeItem()} />);

    const trigger = screen.getByTestId('sessions-row').firstChild as Element;
    fireEvent.mouseEnter(trigger);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    fireEvent.mouseLeave(trigger);

    expect(screen.queryByTestId('sessions-meta-card')).toBeNull();
  });

  it('does not show the card before the hover delay elapses', () => {
    render(<SessionRow item={makeItem()} />);

    fireEvent.mouseEnter(screen.getByTestId('sessions-row').firstChild as Element);

    expect(screen.queryByTestId('sessions-meta-card')).toBeNull();
  });
});

describe('SessionRow — compact worktree/PR glyphs render inline', () => {
  it('renders sessions-row-meta-icon-worktree when custom.worktreePath is set', () => {
    render(<SessionRow item={makeItem({ worktreePath: '/repos/mf/.git/worktrees/feat-x' })} />);
    expect(screen.getByTestId('sessions-row-meta-icon-worktree')).toBeTruthy();
  });

  it('renders sessions-row-meta-icon-pr with "#42" when a PR is detected', () => {
    render(
      <SessionRow
        item={makeItem({
          detectedPrs: [
            { number: 42, url: 'https://github.com/org/r/pull/42', owner: 'org', repo: 'r', source: 'created' },
          ],
        })}
      />,
    );
    expect(screen.getByTestId('sessions-row-meta-icon-pr').textContent).toBe('#42');
  });
});
