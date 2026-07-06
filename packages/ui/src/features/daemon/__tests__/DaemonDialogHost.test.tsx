/**
 * DaemonDialogHost — TDD tests.
 *
 * Behaviors covered:
 *  1. Renders nothing when the store's dialog is null.
 *  2. openRename(target) renders the rename dialog wired to registry.rename.
 *  3. openRemove(target) renders the remove dialog wired to registry.remove.
 *  4. openAdd() renders the AddRemoteDialog pairing flow.
 *  5. Bug-1 regression (root hoist): a dialog opened via the store survives a
 *     sibling subtree remounting under `key={target.id}` on a real switchTo —
 *     proving the host is genuinely ABOVE the keyed subtree, not inside it
 *     (mirrors the real App.tsx `<AppShell key={target.id} />` relationship).
 *  6. Bug-1 regression (full pairing flow): the "Paired" grace window created by
 *     AddRemoteDialog.handleConfirm survives the registry.switchTo-triggered
 *     remount of a sibling keyed subtree — the exact scenario from the bug
 *     report (switching daemons used to destroy the open pairing dialog before
 *     the ~800ms confirmation rendered).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import type { DaemonMeta, DaemonTarget } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { ActiveDaemonProvider, useActiveDaemon } from '../active-daemon-context';
import { DaemonDialogHost } from '../DaemonDialogHost';
import { useDaemonDialogTarget } from '../use-daemon-dialog-target';
import { verifyDaemon, confirmPairing } from '../pair-daemon';

// ---------------------------------------------------------------------------
// Mocks — same set used by DaemonFooterStatus.test.tsx / active-daemon-context.test.tsx
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
// Fixtures
// ---------------------------------------------------------------------------

const TEST_PORT = 31415;

const REMOTE_STUDIO: DaemonMeta = {
  id: 'studio',
  kind: 'remote',
  label: 'Studio Mac',
  host: 'studio.example.com:443',
};

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
  token: 'jwt-secret-token',
};

// ---------------------------------------------------------------------------
// Wrapper factory
// ---------------------------------------------------------------------------

function makeWrapper(initialTarget: DaemonTarget) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DaemonPortProvider port={TEST_PORT}>
        <ActiveDaemonProvider initialTarget={initialTarget}>{children}</ActiveDaemonProvider>
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
  await fakeHost.daemons.setToken(REMOTE_STUDIO.id, 'jwt-secret-token');
  setHostForTesting(fakeHost);
  act(() => {
    useDaemonDialogTarget.getState().close();
  });
});

afterEach(() => {
  resetHostForTesting();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 1. Renders nothing when dialog is null
// ---------------------------------------------------------------------------

describe('DaemonDialogHost — closed by default', () => {
  it('renders no dialog testids when dialog is null', () => {
    render(<DaemonDialogHost />, { wrapper: makeWrapper(LOCAL_TARGET) });

    expect(screen.queryByTestId('daemon-rename-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('daemon-remove-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('daemon-add-url')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 2. openRename renders the rename dialog, wired to registry.rename
// ---------------------------------------------------------------------------

describe('DaemonDialogHost — openRename', () => {
  it('renders daemon-rename-dialog and Save calls the host bridge upsert with the new label', async () => {
    const user = userEvent.setup();
    render(<DaemonDialogHost />, { wrapper: makeWrapper(LOCAL_TARGET) });

    act(() => {
      useDaemonDialogTarget.getState().openRename(REMOTE_STUDIO);
    });

    expect(screen.getByTestId('daemon-rename-dialog')).toBeInTheDocument();

    const input = screen.getByTestId('daemon-rename-input');
    await user.clear(input);
    await user.type(input, 'Renamed Studio');
    await user.click(screen.getByTestId('daemon-rename-save'));

    await waitFor(() => {
      expect(useDaemonDialogTarget.getState().dialog).toBeNull();
    });
    const list = await fakeHost.daemons.list();
    expect(list.find((d) => d.id === REMOTE_STUDIO.id)?.label).toBe('Renamed Studio');
  });
});

// ---------------------------------------------------------------------------
// 3. openRemove renders the remove dialog, wired to registry.remove
// ---------------------------------------------------------------------------

describe('DaemonDialogHost — openRemove', () => {
  it('renders daemon-remove-dialog and confirm calls the host bridge remove', async () => {
    const user = userEvent.setup();
    render(<DaemonDialogHost />, { wrapper: makeWrapper(LOCAL_TARGET) });

    act(() => {
      useDaemonDialogTarget.getState().openRemove(REMOTE_STUDIO);
    });

    expect(screen.getByTestId('daemon-remove-dialog')).toBeInTheDocument();

    await user.click(screen.getByTestId('daemon-remove-confirm'));

    await waitFor(() => {
      expect(useDaemonDialogTarget.getState().dialog).toBeNull();
    });
    const list = await fakeHost.daemons.list();
    expect(list.find((d) => d.id === REMOTE_STUDIO.id)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. openAdd renders the AddRemoteDialog pairing flow
// ---------------------------------------------------------------------------

describe('DaemonDialogHost — openAdd', () => {
  it('renders the add-remote pairing dialog', () => {
    render(<DaemonDialogHost />, { wrapper: makeWrapper(LOCAL_TARGET) });

    act(() => {
      useDaemonDialogTarget.getState().openAdd();
    });

    expect(screen.getByTestId('daemon-add-url')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Shared harness for the root-hoist regressions — mirrors App.tsx's
// `<AppShell key={target.id} /> ... <DaemonDialogHost />` sibling relationship.
// ---------------------------------------------------------------------------

let keyedMountCount = 0;

function KeyedAppShellStub() {
  useEffect(() => {
    keyedMountCount += 1;
  }, []);
  return <div data-testid="appshell-stub" />;
}

function RootHoistHarness() {
  const { target, switchTo } = useActiveDaemon();
  return (
    <>
      <KeyedAppShellStub key={target.id} />
      <DaemonDialogHost />
      <button data-testid="switch-btn" onClick={() => void switchTo(REMOTE_STUDIO_TARGET)}>
        Switch
      </button>
      <span data-testid="active-target-id">{target.id}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// 5. Bug-1 regression — dialog survives a sibling keyed remount on a real switchTo
// ---------------------------------------------------------------------------

describe('DaemonDialogHost — bug-1 regression: survives a sibling keyed remount', () => {
  it('a dialog opened via the store stays mounted after switchTo remounts the sibling', async () => {
    keyedMountCount = 0;
    render(<RootHoistHarness />, { wrapper: makeWrapper(LOCAL_TARGET) });

    act(() => {
      useDaemonDialogTarget.getState().openRename(REMOTE_STUDIO);
    });
    expect(screen.getByTestId('daemon-rename-dialog')).toBeInTheDocument();
    expect(keyedMountCount).toBe(1);

    // Simulate the daemon-switch remount: switchTo updates the active target,
    // which changes `key={target.id}` on the sibling, unmounting + remounting
    // it exactly like AppShell does on a real switch — while the host does not.
    // fireEvent (not userEvent) is used because the open modal Dialog
    // legitimately makes the rest of the page inert to real pointer input; we
    // only care whether state survives a switch triggered by any means (e.g.
    // AddRemoteDialog's own internal handleConfirm → registry.switchTo,
    // covered end-to-end via real user interaction by the next test).
    await act(async () => {
      fireEvent.click(screen.getByTestId('switch-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('active-target-id').textContent).toBe('studio');
    });
    expect(keyedMountCount).toBe(2); // proves the sibling really did remount
    expect(screen.getByTestId('daemon-rename-dialog')).toBeInTheDocument(); // dialog survived
  });
});

// ---------------------------------------------------------------------------
// 6. Bug-1 regression — full pairing flow survives the registry.switchTo remount
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

describe('DaemonDialogHost — bug-1 regression: pairing grace window survives a switchTo remount', () => {
  it('the "Paired" notice stays mounted through the switchTo-triggered sibling remount', async () => {
    vi.mocked(verifyDaemon).mockResolvedValue({ ok: true, version: '1.2.3', ms: 10 });
    vi.mocked(confirmPairing).mockResolvedValue({ token: NEW_REMOTE_TOKEN, deviceId: 'dev-1' });

    keyedMountCount = 0;
    const user = userEvent.setup();
    render(<RootHoistHarness />, { wrapper: makeWrapper(LOCAL_TARGET) });

    act(() => {
      useDaemonDialogTarget.getState().openAdd();
    });

    const urlInput = await screen.findByTestId('daemon-add-url');
    await user.type(urlInput, NEW_REMOTE_URL);
    await user.click(screen.getByTestId('daemon-add-verify'));
    await waitFor(() => screen.getByText(/daemon reachable/i));
    await user.click(screen.getByTestId('daemon-add-continue'));

    await typeCode(user, 'ABC123');
    await user.click(screen.getByTestId('daemon-add-confirm'));

    // handleConfirm's own registry.switchTo(newMeta.id) fires as part of a
    // successful "add" pairing — this changes the active target id, which
    // remounts the keyed sibling exactly like AppShell would on a real switch.
    await waitFor(() => {
      expect(screen.getByTestId('active-target-id').textContent).not.toBe('local');
    });
    expect(keyedMountCount).toBe(2); // the sibling DID remount, proving this isn't a no-op check

    // The "Paired" grace window (the dialog's own onDone/onClose deferral) must
    // still be visible — this is the regression: it used to be torn down the
    // instant the keyed AppShell sibling remounted mid-confirm.
    expect(screen.queryByTestId('daemon-add-close')).toBeInTheDocument();

    // It must still eventually close once the deferred onClose fires.
    await waitFor(() => expect(screen.queryByTestId('daemon-add-close')).not.toBeInTheDocument(), {
      timeout: 2000,
    });
  });
});
