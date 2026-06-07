/**
 * App integration — behavior tests (TDD red phase).
 *
 * Behaviors covered:
 *  1. renders sidebar shell, dev harness gone — app-chatid-input absent, sessions-sidebar present.
 *  2. renders chat surface — chat-thread-area present, chat-surface-stub present inside it.
 *  3. mounts the single archive dialog outlet — sessions-archive-confirm-dialog present, exactly 1.
 *  4. mounts the tag popover host — tag-popover-host-stub present.
 *  5. connection dot present — app-connection-dot present.
 *  6. runs the session-list router under the runtime — useSessionListRouter mock was called.
 *  7. provides the daemon port to the runtime layer — DaemonPortProvider is mounted; the
 *     useSessionsThreadList mock calls the REAL useDaemonPort and sees 31415.
 *  8. waits for daemon when port is null — app-waiting-daemon present, sessions-sidebar absent.
 *
 * Strategy:
 *  - All heavy modules mocked so the test stays a pure unit for App's wiring.
 *  - useConnectionState default: { state: 'connected', daemonStatus: 'running', port: 31415 }.
 *  - Behavior 7: useSessionsThreadList mock imports the REAL useDaemonPort via vi.importActual
 *    so the DaemonPortProvider wrapping is genuinely exercised.
 *  - Behavior 8: vi.mocked(useConnectionState).mockReturnValueOnce overrides for that one test.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module-scope let — behavior 7: records the port seen inside the runtime mock.
// ---------------------------------------------------------------------------

let daemonPortSeenByRuntime: number | null = null;

// ---------------------------------------------------------------------------
// Hoisted spy for useSessionListRouter — referenced in behavior 6.
// ---------------------------------------------------------------------------

const useSessionListRouterMock = vi.fn();

// ---------------------------------------------------------------------------
// vi.mock declarations — must appear before any import of the module under test.
// ---------------------------------------------------------------------------

vi.mock('../useConnectionState', () => ({
  useConnectionState: vi.fn(() => ({ state: 'connected', daemonStatus: 'running', port: 31415 })),
}));

vi.mock('../../lib/daemon/ws-client', () => ({
  daemonWs: {
    setPort: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    subscribe: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@assistant-ui/react');
  return {
    ...actual,
    AssistantRuntimeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('../../features/sessions/runtime/use-sessions-thread-list', async () => {
  // Import the REAL useDaemonPort so the DaemonPortProvider wrapping is exercised.
  const { useDaemonPort } = await vi.importActual<typeof import('../../features/sessions/runtime/daemon-port-context')>(
    '../../features/sessions/runtime/daemon-port-context',
  );

  return {
    useSessionsThreadList: () => {
      daemonPortSeenByRuntime = useDaemonPort();
      return {};
    },
  };
});

vi.mock('../../features/sessions/ws/use-session-list-router', () => ({
  useSessionListRouter: useSessionListRouterMock,
}));

vi.mock('../../features/sessions/sidebar/SessionSidebar', () => ({
  SessionSidebar: () => <div data-testid="sessions-sidebar" />,
}));

vi.mock('../../features/sessions/sidebar/ArchiveWorktreeDialog', () => ({
  ArchiveWorktreeDialog: () => <div data-testid="sessions-archive-confirm-dialog" />,
}));

vi.mock('../../features/sessions/tags/TagPopoverHost', () => ({
  TagPopoverHost: (p: { port: number }) => <div data-testid="tag-popover-host-stub" data-port={p.port} />,
}));

vi.mock('../../features/sessions/new-thread/ChatSurface', () => ({
  ChatSurface: (p: { port: number }) => <div data-testid="chat-surface-stub" data-port={p.port} />,
}));

vi.mock('@/components/ui/sonner', () => ({
  Toaster: () => null,
}));

// ---------------------------------------------------------------------------
// Import the component under test — AFTER all mocks.
// ---------------------------------------------------------------------------

import { useConnectionState } from '../useConnectionState';
import { App } from '../App';

// ---------------------------------------------------------------------------
// Reset per-test
// ---------------------------------------------------------------------------

beforeEach(() => {
  daemonPortSeenByRuntime = null;
  useSessionListRouterMock.mockReset();
  vi.mocked(useConnectionState).mockReturnValue({
    state: 'connected',
    daemonStatus: 'running',
    port: 31415,
  });
});

// ---------------------------------------------------------------------------
// Behavior 1 — sidebar shell present, dev harness gone
// ---------------------------------------------------------------------------

describe('App integration — renders sidebar shell, dev harness gone', () => {
  it('app-chatid-input is null and sessions-sidebar is defined', async () => {
    await act(async () => {
      render(<App />);
    });

    expect(screen.queryByTestId('app-chatid-input')).toBeNull();
    expect(screen.getByTestId('sessions-sidebar')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — chat surface
// ---------------------------------------------------------------------------

describe('App integration — renders chat surface', () => {
  it('chat-thread-area is defined and contains chat-surface-stub', async () => {
    await act(async () => {
      render(<App />);
    });

    expect(screen.getByTestId('chat-thread-area')).toBeDefined();
    expect(screen.getByTestId('chat-surface-stub')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — single archive dialog outlet
// ---------------------------------------------------------------------------

describe('App integration — mounts the single archive dialog outlet', () => {
  it('sessions-archive-confirm-dialog is defined and appears exactly once', async () => {
    await act(async () => {
      render(<App />);
    });

    expect(screen.getByTestId('sessions-archive-confirm-dialog')).toBeDefined();
    expect(screen.getAllByTestId('sessions-archive-confirm-dialog')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Behavior 4 — tag popover host
// ---------------------------------------------------------------------------

describe('App integration — mounts the tag popover host', () => {
  it('tag-popover-host-stub is defined', async () => {
    await act(async () => {
      render(<App />);
    });

    expect(screen.getByTestId('tag-popover-host-stub')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Behavior 5 — connection dot present
// ---------------------------------------------------------------------------

describe('App integration — connection dot present', () => {
  it('app-connection-dot is defined', async () => {
    await act(async () => {
      render(<App />);
    });

    expect(screen.getByTestId('app-connection-dot')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Behavior 6 — session-list router is called
// ---------------------------------------------------------------------------

describe('App integration — runs the session-list router under the runtime', () => {
  it('useSessionListRouter mock has been called', async () => {
    await act(async () => {
      render(<App />);
    });

    expect(useSessionListRouterMock).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Behavior 7 — daemon port provided to runtime layer
// ---------------------------------------------------------------------------

describe('App integration — provides the daemon port to the runtime layer', () => {
  it('does not throw and daemonPortSeenByRuntime is 31415', async () => {
    await expect(
      act(async () => {
        render(<App />);
      }),
    ).resolves.not.toThrow();

    expect(daemonPortSeenByRuntime).toBe(31415);
  });
});

// ---------------------------------------------------------------------------
// Behavior 8 — waiting for daemon when port is null
// ---------------------------------------------------------------------------

describe('App integration — waits for daemon when port is null', () => {
  it('app-waiting-daemon is present and sessions-sidebar is null', async () => {
    vi.mocked(useConnectionState).mockReturnValueOnce({
      state: 'connecting',
      daemonStatus: 'initializing',
      port: null,
    });

    await act(async () => {
      render(<App />);
    });

    expect(screen.getByTestId('app-waiting-daemon')).toBeDefined();
    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();
  });
});
