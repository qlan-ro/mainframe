/**
 * AddRemoteDialog — TDD tests.
 *
 * Behaviors covered:
 *  1. add-mode: type URL → Verify → reachable → Continue → enter code → Pair
 *     → confirmPairing called with url+code, registry.add called, onDone fired.
 *  2. repair-mode: starts at step 1 with locked URL, enter code → Re-pair
 *     → host.daemons.setToken called with correct id+token, onDone fired.
 *  3. failing code (PairingError 'invalid') → error notice rendered, no add.
 *  4. network error (PairingError 'network') → error UI shown, no crash, no add.
 *  5. every URL the dialog shows or posts to comes from the paired scheme, and
 *     a refused endpoint gets its own notice in both steps (todo #305).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { PairingError } from '@/features/daemon/pair-daemon';

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the modules under test.
// ---------------------------------------------------------------------------

vi.mock('@/features/daemon/pair-daemon', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/daemon/pair-daemon')>();
  return {
    ...original,
    verifyDaemon: vi.fn(),
    confirmPairing: vi.fn(),
  };
});

vi.mock('@/features/daemon/use-daemon-registry', () => ({
  useDaemonRegistry: vi.fn(),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
  DaemonPortProvider: ({ children }: { children: React.ReactNode }) => children,
}));

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

import React from 'react';
import { verifyDaemon, confirmPairing } from '@/features/daemon/pair-daemon';
import { useDaemonRegistry } from '@/features/daemon/use-daemon-registry';
import { AddRemoteDialog } from '../AddRemoteDialog';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_URL = 'https://my-server.example.com';
const VALID_CODE = 'ABC123';
const RETURNED_TOKEN = 'jwt-abc';

const REMOTE_META: DaemonMeta = {
  id: 'server-1',
  kind: 'remote',
  label: 'my-server',
  host: 'my-server.example.com',
};

const HTTP_META: DaemonMeta = {
  id: 'qa-daemon',
  kind: 'remote',
  label: 'QA daemon',
  host: '127.0.0.1:31500',
  scheme: 'http',
};

const INSECURE_URL = 'http://192.168.1.10:31415';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

// input-otp polls document.elementFromPoint from a timer; jsdom doesn't
// implement it and the suite would log an uncaught TypeError per test.
document.elementFromPoint ??= () => null;

const mockAdd = vi.fn();
const mockSwitchTo = vi.fn();
const mockRetoken = vi.fn();

let fakeHost: FakeHostBridge;
let setTokenSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fakeHost = new FakeHostBridge();
  setTokenSpy = vi.spyOn(fakeHost.daemons, 'setToken');
  setHostForTesting(fakeHost);

  vi.mocked(useDaemonRegistry).mockReturnValue({
    daemons: [],
    activeId: 'local',
    reload: vi.fn(),
    add: mockAdd,
    rename: vi.fn(),
    remove: vi.fn(),
    switchTo: mockSwitchTo,
    retoken: mockRetoken,
  });

  vi.mocked(verifyDaemon).mockResolvedValue({ ok: true, version: '1.2.3', ms: 45 });
  vi.mocked(confirmPairing).mockResolvedValue({ token: RETURNED_TOKEN, deviceId: 'dev-123' });
  mockAdd.mockResolvedValue(undefined);
  mockSwitchTo.mockResolvedValue(undefined);
});

afterEach(() => {
  resetHostForTesting();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: type a 6-char code. InputOTP renders ONE real input over the slot
// row (not six boxes), so the code types straight in.
// ---------------------------------------------------------------------------

async function typeCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  const codeInput = screen.getByTestId('daemon-pair-code');
  await user.click(codeInput);
  await user.keyboard(code);
}

// ---------------------------------------------------------------------------
// Helper: advance from step 0 to step 1 (verify + continue)
// ---------------------------------------------------------------------------

async function advanceToStep1(user: ReturnType<typeof userEvent.setup>) {
  const urlInput = screen.getByTestId('daemon-add-url');
  await user.clear(urlInput);
  await user.type(urlInput, TEST_URL);
  await user.click(screen.getByTestId('daemon-add-verify'));
  await waitFor(() => screen.getByText(/daemon reachable/i));
  await user.click(screen.getByTestId('daemon-add-continue'));
}

// ---------------------------------------------------------------------------
// Behavior 1 — add-mode happy path
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — add-mode happy path', () => {
  it('verify → reachable notice → continue → enter code → pair → onDone fires', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDone = vi.fn();

    render(<AddRemoteDialog open mode="add" onClose={onClose} onDone={onDone} />);

    await advanceToStep1(user);
    expect(verifyDaemon).toHaveBeenCalledWith(TEST_URL);

    await typeCode(user, VALID_CODE);

    const pairBtn = screen.getByTestId('daemon-add-confirm');
    expect(pairBtn).not.toBeDisabled();
    await user.click(pairBtn);

    await waitFor(() => {
      expect(confirmPairing).toHaveBeenCalledWith(TEST_URL, VALID_CODE, expect.any(String));
    });

    await waitFor(() => {
      expect(mockAdd).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior 1b — switchTo is deferred until after the dialog's deferred close
// (fixes AppShell's `key={target.id}` remount destroying the still-open
// dialog mid-handleConfirm, before it can ever reach the "done"/"Paired"
// phase — see AddRemoteDialog.tsx handleConfirm).
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — deferred auto-switch (add-mode)', () => {
  it('does not call registry.switchTo until the dialog has closed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDone = vi.fn();

    render(<AddRemoteDialog open mode="add" onClose={onClose} onDone={onDone} />);

    await advanceToStep1(user);
    await typeCode(user, VALID_CODE);
    await user.click(screen.getByTestId('daemon-add-confirm'));

    // onDone fires immediately on success, while the "Paired" grace window is
    // showing — switchTo must NOT have fired yet, or the resulting AppShell
    // remount would tear down this still-open dialog.
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mockSwitchTo).not.toHaveBeenCalled();

    // Once the deferred close fires, switchTo runs with the newly-added
    // daemon's id.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const addedMeta = mockAdd.mock.calls[0]?.[0] as DaemonMeta;
    expect(mockSwitchTo).toHaveBeenCalledWith(addedMeta.id);
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — repair-mode: starts at step 1 with locked URL + setToken
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — repair-mode', () => {
  it('skips step 0, shows locked URL chip, setToken called with correct id+token, onDone fires', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDone = vi.fn();

    render(<AddRemoteDialog open mode="repair" target={REMOTE_META} onClose={onClose} onDone={onDone} />);

    // Should start at step 1 (no Verify button visible)
    expect(screen.queryByTestId('daemon-add-verify')).not.toBeInTheDocument();

    // Locked URL chip should show the target host
    expect(screen.getByText(new RegExp(REMOTE_META.host))).toBeInTheDocument();

    await typeCode(user, VALID_CODE);

    await user.click(screen.getByTestId('daemon-add-confirm'));

    await waitFor(() => {
      expect(confirmPairing).toHaveBeenCalledTimes(1);
    });

    // Positive assertion: setToken must be called with the daemon id and the returned token
    await waitFor(() => {
      expect(setTokenSpy).toHaveBeenCalledWith(REMOTE_META.id, RETURNED_TOKEN);
    });

    // repair-mode must NOT call registry.add
    expect(mockAdd).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — invalid pairing code (PairingError 'invalid')
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — invalid code', () => {
  it('shows error notice and does NOT call registry.add on PairingError(invalid)', async () => {
    const user = userEvent.setup();
    vi.mocked(confirmPairing).mockRejectedValue(new PairingError('invalid'));

    const onDone = vi.fn();
    render(<AddRemoteDialog open mode="add" onClose={vi.fn()} onDone={onDone} />);

    await advanceToStep1(user);
    await typeCode(user, VALID_CODE);

    await user.click(screen.getByTestId('daemon-add-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('daemon-add-error')).toBeInTheDocument();
    });

    expect(mockAdd).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Behavior 3b — pairing succeeds server-side but local token storage fails
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — local storage failure after successful pairing', () => {
  it('shows the storage error notice and does NOT show the Paired success state', async () => {
    const user = userEvent.setup();
    mockAdd.mockRejectedValue(new Error('keychain write failed'));

    const onDone = vi.fn();
    render(<AddRemoteDialog open mode="add" onClose={vi.fn()} onDone={onDone} />);

    await advanceToStep1(user);
    await typeCode(user, VALID_CODE);

    await user.click(screen.getByTestId('daemon-add-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('daemon-add-storage-error')).toBeInTheDocument();
    });

    expect(screen.queryByText('Paired')).not.toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Behavior 4 — network error (PairingError 'network')
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — network error', () => {
  // NOT STRENGTHENED — audit flagged this test's old name ("shows error UI")
  // as a mismatch with its assertions (only mock-call-not-made was checked).
  // Tracing Step1Body/FooterStep1 in pairing-steps.tsx confirms the mismatch
  // is a real product gap, not a test gap: `step1Phase` on a PairingError
  // with kind !== 'invalid' (including 'network') is set to 'unreachable',
  // but neither Step1Body nor FooterStep1 has any branch for that phase — no
  // NoticeCard, no button/label change. A user hitting a network error while
  // pairing sees the button silently return to its idle label with zero
  // feedback. Renamed to describe what's actually verified; asserting real
  // error-UI presence would fail against current production code, so per
  // instructions this is reported as a bug rather than "fixed" in the test.
  it('does NOT crash, does NOT call add/setToken/onDone on PairingError(network) (no user-visible error UI — see comment/report)', async () => {
    const user = userEvent.setup();
    vi.mocked(confirmPairing).mockRejectedValue(new PairingError('network'));

    const onDone = vi.fn();
    render(<AddRemoteDialog open mode="add" onClose={vi.fn()} onDone={onDone} />);

    await advanceToStep1(user);
    await typeCode(user, VALID_CODE);

    await user.click(screen.getByTestId('daemon-add-confirm'));

    // Network error → unreachable phase. The confirm button stays enabled (user
    // can retry), but add/setToken/onDone must NOT have been called.
    await waitFor(() => {
      // confirmPairing was called but threw, so the dialog is still mounted
      expect(confirmPairing).toHaveBeenCalledTimes(1);
    });

    expect(mockAdd).not.toHaveBeenCalled();
    expect(setTokenSpy).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Behavior 5 — re-pair reads the scheme the daemon was paired with. Both the
// chip the user reads and the URL the code is posted to were https literals,
// so an http-paired daemon could not be re-paired at all (todo #305).
// `confirmPairing` is module-mocked here, so its first argument IS the posted
// origin — the /api/auth/confirm suffix is pinned in pair-daemon.test.ts.
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — repair-mode honors the paired scheme', () => {
  it('shows and posts to the http origin for an http-paired daemon', async () => {
    const user = userEvent.setup();

    render(<AddRemoteDialog open mode="repair" target={HTTP_META} onClose={vi.fn()} onDone={vi.fn()} />);

    expect(screen.getByText('http://127.0.0.1:31500')).toBeInTheDocument();

    await typeCode(user, VALID_CODE);
    await user.click(screen.getByTestId('daemon-add-confirm'));

    await waitFor(() => {
      expect(confirmPairing).toHaveBeenCalledWith('http://127.0.0.1:31500', VALID_CODE, expect.any(String));
    });
  });

  it('shows and posts to https for an entry with no stored scheme', async () => {
    const user = userEvent.setup();

    render(<AddRemoteDialog open mode="repair" target={REMOTE_META} onClose={vi.fn()} onDone={vi.fn()} />);

    expect(screen.getByText(`https://${REMOTE_META.host}`)).toBeInTheDocument();

    await typeCode(user, VALID_CODE);
    await user.click(screen.getByTestId('daemon-add-confirm'));

    await waitFor(() => {
      expect(confirmPairing).toHaveBeenCalledWith(`https://${REMOTE_META.host}`, VALID_CODE, expect.any(String));
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior 6 — a refused endpoint reads as refused, not as unreachable, and
// never reaches the pairing-code step.
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — refused endpoint', () => {
  it('shows the refusal notice and stays on step 0 when verify refuses', async () => {
    const user = userEvent.setup();
    vi.mocked(verifyDaemon).mockResolvedValue({ ok: false, reason: 'refused-insecure' });

    render(<AddRemoteDialog open mode="add" onClose={vi.fn()} onDone={vi.fn()} />);

    const urlInput = screen.getByTestId('daemon-add-url');
    await user.type(urlInput, INSECURE_URL);
    await user.click(screen.getByTestId('daemon-add-verify'));

    await waitFor(() => expect(screen.getByTestId('daemon-add-insecure')).toBeInTheDocument());
    expect(screen.queryByTestId('daemon-add-unreachable')).toBeNull();
    expect(screen.queryByTestId('daemon-add-continue')).toBeNull();
  });

  it('shows the refusal notice on step 1 when confirm refuses', async () => {
    const user = userEvent.setup();
    vi.mocked(confirmPairing).mockRejectedValue(new PairingError('insecure'));

    render(<AddRemoteDialog open mode="add" onClose={vi.fn()} onDone={vi.fn()} />);

    await advanceToStep1(user);
    await typeCode(user, VALID_CODE);
    await user.click(screen.getByTestId('daemon-add-confirm'));

    await waitFor(() => expect(screen.getByTestId('daemon-pair-insecure')).toBeInTheDocument());
    expect(mockAdd).not.toHaveBeenCalled();
  });
});
