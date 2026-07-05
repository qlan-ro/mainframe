/**
 * DaemonFooterStatus — TDD tests.
 *
 * Behaviors covered:
 *  1. The trigger shows the active daemon's label.
 *  2. Opening the picker and clicking a remote entry calls registry.switchTo
 *     and updates the active daemon id.
 *  3. When the active daemon is a remote and connection state is 'disconnected',
 *     the unreachable overlay renders (data-testid="connection-overlay" via
 *     data-testid="daemon-unreachable") and its switch-to-local routes to local.
 *  4. Full add-remote flow through the REAL useDaemonRegistry (bug i/j
 *     regressions): pairing auto-switches the active daemon, and the
 *     "Paired" grace window stays open until the deferred close fires.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { DaemonMeta, DaemonTarget } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { ActiveDaemonProvider, useActiveDaemon } from '../active-daemon-context';
import { ConnectionStatusProvider } from '@/app/ConnectionStatusContext';
import { DaemonFooterStatus } from '../DaemonFooterStatus';
import { verifyDaemon, confirmPairing } from '../pair-daemon';

// ---------------------------------------------------------------------------
// Mocks — same set as use-daemon-registry.test.tsx
// ---------------------------------------------------------------------------

vi.mock('@/lib/daemon/dispose-daemon-session', () => ({
  disposeDaemonSession: vi.fn(),
}));
vi.mock('@/lib/lsp', () => ({
  rebindLspToActiveDaemon: vi.fn(() => Promise.resolve()),
  initLspPort: vi.fn(() => Promise.resolve()),
  lspClientManager: {},
  getLspLanguage: vi.fn(() => null),
  hasLspSupport: vi.fn(() => false),
  initAutoConnect: vi.fn(() => () => undefined),
}));
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    setPort: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    subscribe: vi.fn(),
    send: vi.fn(),
  },
}));
vi.mock('../pair-daemon', async (importOriginal) => {
  const original = await importOriginal<typeof import('../pair-daemon')>();
  return {
    ...original,
    verifyDaemon: vi.fn(),
    confirmPairing: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const TEST_PORT = 31415;

const REMOTE_STUDIO: DaemonMeta = {
  id: 'studio',
  kind: 'remote',
  label: 'Studio Mac',
  host: 'studio.example.com:443',
};

const REMOTE_TOKEN = 'jwt-secret-token';

const LOCAL_TARGET: DaemonTarget = {
  id: 'local',
  kind: 'local',
  label: 'This Mac',
  baseUrl: `http://127.0.0.1:${TEST_PORT}`,
  token: null,
};

const REMOTE_STUDIO_TARGET: DaemonTarget = {
  id: 'studio',
  kind: 'remote',
  label: 'Studio Mac',
  baseUrl: `https://${REMOTE_STUDIO.host}`,
  token: REMOTE_TOKEN,
};

// ---------------------------------------------------------------------------
// Wrapper factory
// ---------------------------------------------------------------------------

function makeWrapper(initialTarget: DaemonTarget, connectionState: 'connected' | 'connecting' | 'disconnected') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DaemonPortProvider port={TEST_PORT}>
        <ActiveDaemonProvider initialTarget={initialTarget}>
          <ConnectionStatusProvider value={{ state: connectionState, daemonStatus: 'ok' }}>
            {children}
          </ConnectionStatusProvider>
        </ActiveDaemonProvider>
      </DaemonPortProvider>
    );
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let fakeHost: FakeHostBridge;

beforeEach(async () => {
  fakeHost = new FakeHostBridge();
  await fakeHost.daemons.upsert(REMOTE_STUDIO);
  await fakeHost.daemons.setToken(REMOTE_STUDIO.id, REMOTE_TOKEN);
  setHostForTesting(fakeHost);
});

afterEach(() => {
  resetHostForTesting();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Behavior 1 — trigger shows the active daemon's label
// ---------------------------------------------------------------------------

describe('DaemonFooterStatus — trigger label', () => {
  it('shows the local daemon label when local is active', async () => {
    render(<DaemonFooterStatus />, {
      wrapper: makeWrapper(LOCAL_TARGET, 'connected'),
    });

    expect(screen.getByTestId('daemon-footer-trigger')).toHaveTextContent('This Mac');
  });

  it('shows the remote daemon label when a remote is active', async () => {
    render(<DaemonFooterStatus />, {
      wrapper: makeWrapper(REMOTE_STUDIO_TARGET, 'connected'),
    });

    expect(screen.getByTestId('daemon-footer-trigger')).toHaveTextContent('Studio Mac');
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — clicking a remote row in the picker calls switchTo
// ---------------------------------------------------------------------------

describe('DaemonFooterStatus — picker switch', () => {
  it('opening the picker and clicking the remote calls switchTo and updates active id', async () => {
    const user = userEvent.setup();
    const captured: { target: DaemonTarget | null } = { target: null };

    function Spy() {
      const { target } = useActiveDaemon();
      captured.target = target;
      return null;
    }

    render(
      <>
        <DaemonFooterStatus />
        <Spy />
      </>,
      {
        wrapper: makeWrapper(LOCAL_TARGET, 'connected'),
      },
    );

    // Trigger opens the picker
    await user.click(screen.getByTestId('daemon-footer-trigger'));

    // Wait for the daemon list to load
    const remoteRow = await screen.findByTestId(`daemon-row-${REMOTE_STUDIO.id}`);
    await user.click(remoteRow);

    // activeId should now be 'studio'
    expect(captured.target?.id).toBe('studio');
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — unreachable overlay when active remote is disconnected
// ---------------------------------------------------------------------------

describe('DaemonFooterStatus — unreachable overlay', () => {
  it('renders the daemon-unreachable overlay when active is remote and state is disconnected', () => {
    render(<DaemonFooterStatus />, {
      wrapper: makeWrapper(REMOTE_STUDIO_TARGET, 'disconnected'),
    });

    // The ConnectionOverlay should be open and show DaemonUnreachableBody
    expect(screen.getByTestId('daemon-unreachable')).toBeInTheDocument();
  });

  it('does NOT render the unreachable overlay when local is active even if disconnected', () => {
    render(<DaemonFooterStatus />, {
      wrapper: makeWrapper(LOCAL_TARGET, 'disconnected'),
    });

    expect(screen.queryByTestId('daemon-unreachable')).not.toBeInTheDocument();
  });

  it('switch-to-local button in the overlay routes to local', async () => {
    const user = userEvent.setup();
    const captured: { target: DaemonTarget | null } = { target: null };

    function Spy() {
      const { target } = useActiveDaemon();
      captured.target = target;
      return null;
    }

    render(
      <>
        <DaemonFooterStatus />
        <Spy />
      </>,
      {
        wrapper: makeWrapper(REMOTE_STUDIO_TARGET, 'disconnected'),
      },
    );

    await user.click(screen.getByTestId('daemon-unreachable-switchlocal'));

    expect(captured.target?.id).toBe('local');
  });
});

// ---------------------------------------------------------------------------
// Regression I1 — single overlay when active is remote + disconnected
// ---------------------------------------------------------------------------

describe('DaemonFooterStatus — single overlay regression (I1)', () => {
  it('active REMOTE + disconnected: renders daemon-unreachable, NOT the generic reconnect card', () => {
    render(<DaemonFooterStatus />, {
      wrapper: makeWrapper(REMOTE_STUDIO_TARGET, 'disconnected'),
    });

    // DaemonUnreachableBody must be present (owned by DaemonFooterStatus).
    expect(screen.getByTestId('daemon-unreachable')).toBeInTheDocument();

    // The generic reconnect card (data-testid="connection-overlay") must NOT
    // appear here — the App.tsx overlay is gated to local-only in DaemonGatedShell
    // and does not render in this unit test. We verify DaemonFooterStatus itself
    // does not render a second generic overlay alongside the unreachable body.
    expect(screen.queryByTestId('connection-overlay')).not.toBeInTheDocument();
  });

  it('active LOCAL + disconnected: DaemonFooterStatus does not emit any overlay', () => {
    render(<DaemonFooterStatus />, {
      wrapper: makeWrapper(LOCAL_TARGET, 'disconnected'),
    });

    // Neither overlay body should come from DaemonFooterStatus when local is active.
    expect(screen.queryByTestId('daemon-unreachable')).not.toBeInTheDocument();
    expect(screen.queryByTestId('connection-overlay')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Behavior 4 — full add-remote flow through the REAL registry (bugs i & j)
// ---------------------------------------------------------------------------

const NEW_REMOTE_URL = 'https://new-server.example.com';
const NEW_REMOTE_TOKEN = 'jwt-new-server';

async function typeCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  const codeInput = screen.getByTestId('daemon-pair-code');
  const boxes = codeInput.querySelectorAll('input');
  expect(boxes).toHaveLength(6);
  for (let i = 0; i < code.length; i++) {
    await user.click(boxes[i]!);
    await user.keyboard(code[i]!);
  }
}

async function openAddDialogAndPair(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('daemon-footer-trigger'));
  await user.click(await screen.findByTestId('daemon-picker-add'));

  const urlInput = await screen.findByTestId('daemon-add-url');
  await user.type(urlInput, NEW_REMOTE_URL);
  await user.click(screen.getByTestId('daemon-add-verify'));
  await waitFor(() => screen.getByText(/daemon reachable/i));
  await user.click(screen.getByTestId('daemon-add-continue'));

  await typeCode(user, 'ABC123');
  await user.click(screen.getByTestId('daemon-add-confirm'));
}

describe('DaemonFooterStatus — add-remote flow (bugs i & j)', () => {
  beforeEach(() => {
    vi.mocked(verifyDaemon).mockResolvedValue({ ok: true, version: '1.2.3', ms: 10 });
    vi.mocked(confirmPairing).mockResolvedValue({ token: NEW_REMOTE_TOKEN, deviceId: 'dev-1' });
  });

  it('auto-switches the active daemon to the newly paired remote (bug i)', async () => {
    const user = userEvent.setup();
    const captured: { target: DaemonTarget | null } = { target: null };

    function Spy() {
      const { target } = useActiveDaemon();
      captured.target = target;
      return null;
    }

    render(
      <>
        <DaemonFooterStatus />
        <Spy />
      </>,
      { wrapper: makeWrapper(LOCAL_TARGET, 'connected') },
    );

    await openAddDialogAndPair(user);

    await waitFor(() => {
      expect(captured.target?.kind).toBe('remote');
    });
    expect(captured.target?.baseUrl).toBe(NEW_REMOTE_URL);
  });

  it('keeps the "Paired" dialog open through the grace window before closing (bug j)', async () => {
    const user = userEvent.setup();

    render(<DaemonFooterStatus />, { wrapper: makeWrapper(LOCAL_TARGET, 'connected') });

    await openAddDialogAndPair(user);

    // The moment confirmPairing has resolved, the dialog must still be open —
    // onDone must NOT collapse the documented ~800ms "Paired" grace window.
    await waitFor(() => expect(confirmPairing).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('daemon-add-close')).toBeInTheDocument();

    // It must still eventually close once the deferred onClose fires.
    await waitFor(() => expect(screen.queryByTestId('daemon-add-close')).not.toBeInTheDocument(), {
      timeout: 2000,
    });
  });
});
