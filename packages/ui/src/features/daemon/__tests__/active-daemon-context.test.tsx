/**
 * ActiveDaemonProvider + useActiveDaemon — TDD test.
 *
 * Behaviors covered:
 *  1. switchTo calls disposeDaemonSession exactly once.
 *  2. switchTo updates getActiveDaemon().id to the remote id.
 *  3. switchTo sets a non-null port on daemonWs and calls connect.
 *  4. switchTo causes the keyed child to remount (React key changes on target.id).
 *  5. useActiveDaemon.target reflects the active daemon.
 */
import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Hoisted mocks — must appear before any import that pulls the mocked modules.
// ---------------------------------------------------------------------------

const disposeDaemonSessionMock = vi.fn();
vi.mock('@/lib/daemon/dispose-daemon-session', () => ({
  disposeDaemonSession: () => disposeDaemonSessionMock(),
}));

const rebindLspMock = vi.fn(() => Promise.resolve());
vi.mock('@/lib/lsp', () => ({
  rebindLspToActiveDaemon: () => rebindLspMock(),
  initLspPort: vi.fn(() => Promise.resolve()),
  lspClientManager: {},
  getLspLanguage: vi.fn(() => null),
  hasLspSupport: vi.fn(() => false),
  initAutoConnect: vi.fn(() => () => undefined),
}));

const { daemonWsMock } = vi.hoisted(() => ({
  daemonWsMock: {
    setPort: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    subscribe: vi.fn(),
    send: vi.fn(),
  },
}));
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: daemonWsMock,
}));

// ---------------------------------------------------------------------------
// Module imports — after mocks.
// ---------------------------------------------------------------------------

import { getActiveDaemon, setActiveDaemon } from '@/lib/daemon/active-daemon';
import { ActiveDaemonProvider, useActiveDaemon } from '../active-daemon-context';
import type { DaemonTarget } from '@qlan-ro/mainframe-types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const LOCAL_TARGET: DaemonTarget = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
};

const REMOTE_TARGET: DaemonTarget = {
  id: 'remote-1',
  kind: 'remote',
  label: 'Remote Dev',
  baseUrl: 'https://tunnel.example.com:443',
  token: 'jwt-token-123',
};

// ---------------------------------------------------------------------------
// Test components.
//
// TestShell — mirrors how App.tsx uses the provider: reads the active target,
// renders a button that calls switchTo, and uses `key={target.id}` on the
// daemon-scoped subtree (KeyedChild) so React REMOUNTS it on every switch.
//
// KeyedChild — the daemon-scoped subtree. Its useEffect mount-counter lets the
// test assert that a React remount occurred after the switch.
// ---------------------------------------------------------------------------

let mountCount = 0;

function KeyedChild() {
  useEffect(() => {
    mountCount += 1;
  }, []);

  return <div data-testid="child-mount-marker" />;
}

function TestShell() {
  const { target, switchTo } = useActiveDaemon();

  return (
    <div>
      <span data-testid="active-target-id">{target.id}</span>
      <button
        data-testid="switch-btn"
        onClick={() => {
          void switchTo(REMOTE_TARGET);
        }}
      >
        Switch
      </button>
      {/* key={target.id} mirrors the App.tsx keyed remount pattern */}
      <KeyedChild key={target.id} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reset state before each test.
// ---------------------------------------------------------------------------

beforeEach(() => {
  mountCount = 0;
  vi.clearAllMocks();
  setActiveDaemon(LOCAL_TARGET);
});

afterEach(() => {
  setActiveDaemon(LOCAL_TARGET);
});

// ---------------------------------------------------------------------------
// Behavior 1 — switchTo calls disposeDaemonSession exactly once.
// ---------------------------------------------------------------------------

describe('ActiveDaemonProvider — switchTo calls disposeDaemonSession once', () => {
  it('clicking the switch button invokes disposeDaemonSession exactly once', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <ActiveDaemonProvider initialTarget={LOCAL_TARGET}>
          <TestShell />
        </ActiveDaemonProvider>,
      );
    });

    await act(async () => {
      await user.click(screen.getByTestId('switch-btn'));
    });

    expect(disposeDaemonSessionMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — switchTo updates getActiveDaemon().id to the remote id.
// ---------------------------------------------------------------------------

describe('ActiveDaemonProvider — switchTo updates getActiveDaemon().id', () => {
  it('after clicking switch, getActiveDaemon().id equals the remote target id', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <ActiveDaemonProvider initialTarget={LOCAL_TARGET}>
          <TestShell />
        </ActiveDaemonProvider>,
      );
    });

    await act(async () => {
      await user.click(screen.getByTestId('switch-btn'));
    });

    expect(getActiveDaemon().id).toBe('remote-1');
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — switchTo sets a non-null port on daemonWs and calls connect.
// ---------------------------------------------------------------------------

describe('ActiveDaemonProvider — switchTo wires daemonWs with a non-null port and connects', () => {
  it('after clicking switch, daemonWs.setPort is called with a non-null number and connect is called', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <ActiveDaemonProvider initialTarget={LOCAL_TARGET}>
          <TestShell />
        </ActiveDaemonProvider>,
      );
    });

    await act(async () => {
      await user.click(screen.getByTestId('switch-btn'));
    });

    expect(daemonWsMock.setPort).toHaveBeenCalled();
    const portArg: unknown = daemonWsMock.setPort.mock.calls[daemonWsMock.setPort.mock.calls.length - 1]?.[0];
    expect(portArg).toBeGreaterThan(0);
    expect(daemonWsMock.connect).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Behavior 4 — switchTo causes the keyed child to remount.
//
// KeyedChild's useEffect increments mountCount on every mount. When target.id
// changes, the `key` on KeyedChild changes, React unmounts + remounts it,
// incrementing mountCount. We assert mountCount >= 2 (initial + remount).
// ---------------------------------------------------------------------------

describe('ActiveDaemonProvider — keyed child remounts on daemon switch', () => {
  it('after clicking switch, the child has been mounted at least twice (initial + remount)', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(
        <ActiveDaemonProvider initialTarget={LOCAL_TARGET}>
          <TestShell />
        </ActiveDaemonProvider>,
      );
    });

    expect(mountCount).toBe(1);

    await act(async () => {
      await user.click(screen.getByTestId('switch-btn'));
    });

    expect(mountCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Behavior 5 — useActiveDaemon.target reflects the active daemon.
// ---------------------------------------------------------------------------

describe('ActiveDaemonProvider — useActiveDaemon.target reflects active daemon', () => {
  it('renders the local target id initially', async () => {
    await act(async () => {
      render(
        <ActiveDaemonProvider initialTarget={LOCAL_TARGET}>
          <TestShell />
        </ActiveDaemonProvider>,
      );
    });

    expect(screen.getByTestId('active-target-id').textContent).toBe('local');
  });
});
