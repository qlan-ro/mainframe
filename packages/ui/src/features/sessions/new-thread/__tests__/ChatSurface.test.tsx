/**
 * ChatSurface — behavior tests (TDD red phase, post-interstitial-removal).
 *
 * The in-surface "choose a project" picker (NewThreadConfigPicker) is gone;
 * ChatSurface now branches into ChatEmptyState variants instead:
 *
 *  1. Zero projects (first-run) → the firstrun hero only — NO ChatThread at all
 *     (there is nowhere to send a message yet).
 *  2. A brand-new local thread (__LOCALID_* / status 'new' / no messages) whose
 *     draft already resolved a project → ChatThread renders WITH the welcome
 *     empty-state passed through as its `emptyState` prop (composer stays live).
 *  3. A brand-new local thread whose draft has NOT resolved a project → the same
 *     ChatThread + welcome empty-state, handed no projectId: the welcome screen
 *     owns the picker, so there is no boot-settle fallback and no dead end.
 *  4. Anything else (a pre-existing/regular chat with messages) → a plain
 *     ChatThread, no welcome empty-state.
 *
 * The session panel mounts in branch 2/3 only, and `SessionPanel` is stubbed
 * here: it is covered by its own suite, and rendering it for real would drag the
 * whole panel tree (daemon port, WS, launch actions) into a branch-selection
 * test. What this file owns is where the panel mounts and what it is handed —
 * including that the ResizeObserver measures the thread row, not the panel.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { SessionPanelState } from '@/features/session-panel/use-session-panel-state';

let __mainThreadId: string | null = '__LOCALID_1';
let __itemStatus: string | undefined = 'new';
let __messageCount = 0;
let __projects: { id: string }[] = [{ id: 'proj-a' }];
let __loading = false;
let __draftMap = new Map<string, { projectId: string; adapterId: string }>([
  ['__LOCALID_1', { projectId: 'proj-a', adapterId: 'claude' }],
]);
let __filterProjectId: string | null = null;
let __initialization: { status: 'idle' | 'initializing' | 'ready' | 'error'; retry?: () => Promise<unknown> } = {
  status: 'ready',
};

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: unknown) => unknown) =>
    sel({
      threads: { mainThreadId: __mainThreadId },
      threadListItem: { id: __mainThreadId, status: __itemStatus },
      thread: { messages: { length: __messageCount } },
    }),
  // The split machinery (reconciler, hotkeys, zone focus clicks) needs the
  // client; no case here opens a split, so the switch is inert.
  useAui: () => ({ threads: { switchToThread: () => {} } }),
}));
vi.mock('../../use-projects', () => ({ useProjects: () => ({ projects: __projects, loading: __loading }) }));
vi.mock('../../runtime/draft-config', () => ({
  useDraftConfigStore: (sel: (s: unknown) => unknown) => sel({ drafts: __draftMap }),
}));
vi.mock('../../runtime/new-thread-ready-store', () => ({
  useNewThreadReady: (sel: (s: unknown) => unknown) =>
    sel({
      getInitialization: () => __initialization,
      readyIds: __initialization.status === 'ready' ? new Set(['__LOCALID_1']) : new Set(),
    }),
}));
vi.mock('@/store/session-filters', () => ({
  useSessionFilters: (sel: (s: { filterProjectId: string | null }) => unknown) =>
    sel({ filterProjectId: __filterProjectId }),
}));
vi.mock('../use-new-thread-auto-config', () => ({ useNewThreadAutoConfig: () => undefined }));
vi.mock('../../../chat/thread/ChatThread', () => ({
  ChatThread: ({ emptyState }: { emptyState?: React.ReactNode }) => <div data-testid="chat-thread">{emptyState}</div>,
}));
vi.mock('../../../chat/thread/ChatCardHeader', () => ({ ChatCardHeader: () => <div data-testid="chat-header" /> }));
vi.mock('../ChatEmptyState', () => ({
  ChatEmptyState: ({ variant, projectId }: { variant: string; projectId?: string }) => (
    <div data-testid={`empty-${variant}`} data-project={projectId ?? ''} />
  ),
}));
vi.mock('@/features/session-panel/SessionPanel', () => ({
  SessionPanel: ({ state }: { state: SessionPanelState }) => (
    <div data-testid="session-panel-root" data-mode={state.mode} />
  ),
}));

// The shared setup's ResizeObserver stub is inert; this one records what was
// observed so the host-row wiring is assertable.
let observed: Element[] = [];
class RecordingResizeObserver {
  observe(el: Element) {
    observed.push(el);
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RecordingResizeObserver;

import { ChatSurface } from '../ChatSurface';

describe('ChatSurface', () => {
  beforeEach(() => {
    observed = [];
    __mainThreadId = '__LOCALID_1';
    __itemStatus = 'new';
    __messageCount = 0;
    __projects = [{ id: 'proj-a' }];
    __loading = false;
    __filterProjectId = null;
    __draftMap = new Map([['__LOCALID_1', { projectId: 'proj-a', adapterId: 'claude' }]]);
    __initialization = { status: 'ready' };
  });

  it('renders the first-run hero (no ChatThread) when there are no projects', () => {
    __projects = [];
    __loading = false;
    render(<ChatSurface />);
    expect(screen.getByTestId('empty-firstrun')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-thread')).toBeNull();
  });

  it('does not show the first-run hero while projects are still loading', () => {
    __projects = [];
    __loading = true;
    render(<ChatSurface />);
    expect(screen.queryByTestId('empty-firstrun')).toBeNull();
    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();
  });

  it('renders ChatThread with the welcome empty-state for a resolved draft', () => {
    render(<ChatSurface />);
    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();
    expect(screen.getByTestId('empty-welcome')).toHaveAttribute('data-project', 'proj-a');
  });

  it('renders the welcome empty-state with no project for a projectless new local thread', () => {
    __draftMap = new Map();
    __filterProjectId = null;
    __initialization = { status: 'idle' };
    render(<ChatSurface />);

    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();
    expect(screen.getByTestId('empty-welcome')).toHaveAttribute('data-project', '');
    // No boot-settle picker and no dead end: the welcome screen owns the choice.
    expect(screen.queryByText('Initializing session…')).toBeNull();
    expect(screen.queryByTestId('empty-firstrun')).toBeNull();
  });

  it('renders a plain ChatThread (no empty-state) for a non-draft chat', () => {
    __mainThreadId = 'chat-123';
    __itemStatus = 'regular';
    __messageCount = 4;
    render(<ChatSurface />);
    expect(screen.getByTestId('chat-thread')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-welcome')).toBeNull();
  });

  it('hides ChatThread and its composer while initialization is pending', () => {
    __initialization = { status: 'initializing' };
    render(<ChatSurface />);

    expect(screen.getByText('Initializing session…')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-thread')).toBeNull();
  });

  it('hides ChatThread during the initial idle render for a project-filtered draft', () => {
    __draftMap = new Map();
    __filterProjectId = 'proj-a';
    __initialization = { status: 'idle' };
    render(<ChatSurface />);

    expect(screen.getByText('Initializing session…')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-thread')).toBeNull();
  });

  it('hides ChatThread on error and retries the same initialization', async () => {
    const retry = vi.fn(async () => undefined);
    __initialization = { status: 'error', retry };
    render(<ChatSurface />);

    expect(screen.queryByTestId('chat-thread')).toBeNull();
    await act(async () => screen.getByTestId('new-session-initialization-retry').click());
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('mounts the session panel over the thread, handed the panel state', () => {
    render(<ChatSurface />);

    const panel = screen.getByTestId('session-panel-root');
    expect(panel).toBeInTheDocument();
    // jsdom reports a 0px host, under even the rail band — the pre-measurement
    // width derives `hidden` so nothing flashes before the first real measure.
    expect(panel).toHaveAttribute('data-mode', 'hidden');
  });

  it('observes the row holding the thread, so a split surface measures what shrinks', () => {
    render(<ChatSurface />);

    // Two observers: the surface root (split-fits width gate) and the panel's
    // host row. The row is the one that excludes the header.
    expect(observed).toHaveLength(2);
    const row = observed.find((el) => !el.contains(screen.getByTestId('chat-header'))) as HTMLElement;
    expect(row.contains(screen.getByTestId('chat-thread'))).toBe(true);
    expect(row.contains(screen.getByTestId('session-panel-root'))).toBe(true);
    expect(row.contains(screen.getByTestId('chat-header'))).toBe(false);
    // The measured row is the panel's containing block AND its full width: the
    // thread column keeps all of it, and the panel floats in the gutter the
    // centred transcript leaves inside it.
    expect(row).toHaveClass('relative');
    expect(row.querySelector('[data-testid="chat-thread"]')?.parentElement).toHaveClass('flex-1');
  });

  it('does not mount the session panel in the first-run branch', () => {
    __projects = [];
    __loading = false;
    render(<ChatSurface />);

    expect(screen.queryByTestId('session-panel-root')).toBeNull();
    expect(observed).toHaveLength(0);
  });

  it('does not mount the session panel while initialization is pending', () => {
    __initialization = { status: 'initializing' };
    render(<ChatSurface />);

    expect(screen.queryByTestId('session-panel-root')).toBeNull();
  });

  it('does not mount the session panel on an initialization error', () => {
    __initialization = { status: 'error', retry: vi.fn(async () => undefined) };
    render(<ChatSurface />);

    expect(screen.queryByTestId('session-panel-root')).toBeNull();
  });
});
