/**
 * ChatSurface — behavior tests (TDD red phase).
 *
 * Strategy:
 *  - Mock `../../../../features/chat/thread/ChatThread` → <div data-testid="chat-thread-stub" />
 *  - Mock `./NewThreadConfigPicker` → <div data-testid="picker-stub" data-port={p.port} />
 *  - Mock `@assistant-ui/react` → useAuiState driven per test via fakeAuiState.
 *
 * Behaviors covered:
 *  1. New empty local thread (__LOCALID_* / status 'new' / no messages) and NOT ready
 *     → picker shown, chat-thread-stub absent; picker carries data-port="31415".
 *  2. Local thread WITH messages (already sent) → chat-thread-stub shown, picker absent.
 *  3. Status 'regular' (pre-existing chat), even with no messages → chat-thread-stub shown,
 *     picker absent. An empty pre-existing chat still shows the transcript surface.
 *  4. No main thread (mainThreadId=undefined) → chat-thread-stub shown, picker absent.
 *  5. New empty local thread that IS ready (project+adapter chosen → marked ready) →
 *     chat-thread-stub shown (so the real composer is available), picker absent. This
 *     is the picker→composer transition that makes a new session startable (HIGH-1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';

// ---------------------------------------------------------------------------
// Controlled fakeAuiState — mutated per test before the component reads it
// ---------------------------------------------------------------------------

type FakeMessage = { id: string };

interface FakeAuiState {
  threads: { mainThreadId: string | undefined };
  threadListItem: { id: string | undefined; status: string | undefined };
  thread: { messages: FakeMessage[] };
}

let fakeAuiState: FakeAuiState = {
  threads: { mainThreadId: undefined },
  threadListItem: { id: undefined, status: undefined },
  thread: { messages: [] },
};

// ---------------------------------------------------------------------------
// Mocks — must be registered before the component is imported
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (sel: (s: FakeAuiState) => unknown) => sel(fakeAuiState),
}));

vi.mock('../../../../features/chat/thread/ChatThread', () => ({
  ChatThread: () => <div data-testid="chat-thread-stub" />,
}));

vi.mock('../NewThreadConfigPicker', () => ({
  NewThreadConfigPicker: (p: { port: number }) => <div data-testid="picker-stub" data-port={p.port} />,
}));

// Mock session filters — driven per test via fakeFilterProjectId.
let fakeFilterProjectId: string | null = null;
vi.mock('@/store/session-filters', () => ({
  useSessionFilters: (sel: (s: { filterProjectId: string | null }) => unknown) =>
    sel({ filterProjectId: fakeFilterProjectId }),
}));

// Mock the auto-config hook to a no-op so it doesn't fight the filter mock.
vi.mock('../use-new-thread-auto-config', () => ({
  useNewThreadAutoConfig: () => undefined,
}));

// ---------------------------------------------------------------------------
// Import component AFTER all mocks are registered
// ---------------------------------------------------------------------------

const { ChatSurface } = await import('../ChatSurface');

// ---------------------------------------------------------------------------
// Reset the (real) ready store + filter between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  useNewThreadReady.getState().clearReady('__LOCALID_x');
  fakeFilterProjectId = null;
});

// ---------------------------------------------------------------------------
// 1. New empty local thread (not ready) → picker shown, no chat-thread
// ---------------------------------------------------------------------------

describe('ChatSurface — new empty local thread shows picker', () => {
  it('renders picker-stub with data-port="31415" and no chat-thread-stub', () => {
    fakeAuiState = {
      threads: { mainThreadId: '__LOCALID_x' },
      threadListItem: { id: '__LOCALID_x', status: 'new' },
      thread: { messages: [] },
    };

    render(<ChatSurface port={31415} />);

    const picker = screen.getByTestId('picker-stub');
    expect(picker.getAttribute('data-port')).toBe('31415');
    expect(screen.queryByTestId('chat-thread-stub')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Local thread WITH messages (already sent) → chat thread shown, no picker
// ---------------------------------------------------------------------------

describe('ChatSurface — local thread with messages shows chat thread', () => {
  it('renders chat-thread-stub and no picker-stub when messages exist', () => {
    fakeAuiState = {
      threads: { mainThreadId: '__LOCALID_x' },
      threadListItem: { id: '__LOCALID_x', status: 'new' },
      thread: { messages: [{ id: 'm1' }] },
    };

    render(<ChatSurface port={31415} />);

    expect(screen.getByTestId('chat-thread-stub')).toBeTruthy();
    expect(screen.queryByTestId('picker-stub')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Status 'regular' (pre-existing), no messages → chat thread shown, no picker
// ---------------------------------------------------------------------------

describe('ChatSurface — pre-existing chat (status regular) shows chat thread', () => {
  it('renders chat-thread-stub and no picker-stub even when messages array is empty', () => {
    fakeAuiState = {
      threads: { mainThreadId: 'chat-9' },
      threadListItem: { id: 'chat-9', status: 'regular' },
      thread: { messages: [] },
    };

    render(<ChatSurface port={31415} />);

    expect(screen.getByTestId('chat-thread-stub')).toBeTruthy();
    expect(screen.queryByTestId('picker-stub')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. No main thread (mainThreadId=undefined) → chat thread shown, no picker
// ---------------------------------------------------------------------------

describe('ChatSurface — no main thread shows blank transcript surface', () => {
  it('renders chat-thread-stub and no picker-stub when mainThreadId is undefined', () => {
    fakeAuiState = {
      threads: { mainThreadId: undefined },
      threadListItem: { id: undefined, status: undefined },
      thread: { messages: [] },
    };

    render(<ChatSurface port={31415} />);

    expect(screen.getByTestId('chat-thread-stub')).toBeTruthy();
    expect(screen.queryByTestId('picker-stub')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. New empty local thread that IS ready → chat thread (composer) shown, no picker
// ---------------------------------------------------------------------------

describe('ChatSurface — ready new local thread switches to the composer', () => {
  it('renders chat-thread-stub and no picker-stub once the local id is marked ready', () => {
    fakeAuiState = {
      threads: { mainThreadId: '__LOCALID_x' },
      threadListItem: { id: '__LOCALID_x', status: 'new' },
      thread: { messages: [] },
    };
    // The picker marks the local id ready after project+adapter are chosen.
    useNewThreadReady.getState().markReady('__LOCALID_x');

    render(<ChatSurface port={31415} />);

    expect(screen.getByTestId('chat-thread-stub')).toBeTruthy();
    expect(screen.queryByTestId('picker-stub')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. filterProjectId != null on a new local thread → composer shown (not picker)
// ---------------------------------------------------------------------------

describe('ChatSurface — filterProjectId active on new local thread skips the picker', () => {
  it('renders chat-thread (not the picker surface) when a project pill is active', () => {
    fakeAuiState = {
      threads: { mainThreadId: '__LOCALID_x' },
      threadListItem: { id: '__LOCALID_x', status: 'new' },
      thread: { messages: [] },
    };
    // Project pill is active — the auto-config hook seeds + marks ready; the picker
    // should be bypassed (filterProjectId != null gates it out in ChatSurface).
    fakeFilterProjectId = 'proj-99';

    render(<ChatSurface port={31415} />);

    expect(screen.getByTestId('chat-thread-stub')).toBeTruthy();
    expect(screen.queryByTestId('sessions-new-thread-surface')).toBeNull();
    expect(screen.queryByTestId('picker-stub')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. filterProjectId is null on a new local thread (not ready) → picker shown
// ---------------------------------------------------------------------------

describe('ChatSurface — filterProjectId null on new local thread shows picker', () => {
  it('renders the picker surface when no project pill is active and thread is not ready', () => {
    fakeAuiState = {
      threads: { mainThreadId: '__LOCALID_x' },
      threadListItem: { id: '__LOCALID_x', status: 'new' },
      thread: { messages: [] },
    };
    fakeFilterProjectId = null;

    render(<ChatSurface port={31415} />);

    expect(screen.getByTestId('sessions-new-thread-surface')).toBeTruthy();
    expect(screen.queryByTestId('chat-thread-stub')).toBeNull();
  });
});
