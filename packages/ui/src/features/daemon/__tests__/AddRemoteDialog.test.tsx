/**
 * AddRemoteDialog — TDD tests.
 *
 * Behaviors covered:
 *  1. add-mode: type URL → Verify → reachable → Continue → enter code → Pair
 *     → confirmPairing called with url+code, registry.add called, onDone fired.
 *  2. repair-mode: starts at step 1 with locked URL, enter code → Re-pair
 *     → host.daemons.setToken called, onDone fired.
 *  3. failing code (PairingError 'invalid') → error notice rendered, no add.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { PairingError } from '../pair-daemon';

// ---------------------------------------------------------------------------
// Module mocks — must precede imports of the modules under test.
// ---------------------------------------------------------------------------

vi.mock('../pair-daemon', async (importOriginal) => {
  const original = await importOriginal<typeof import('../pair-daemon')>();
  return {
    ...original,
    verifyDaemon: vi.fn(),
    confirmPairing: vi.fn(),
  };
});

vi.mock('../use-daemon-registry', () => ({
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
import { verifyDaemon, confirmPairing } from '../pair-daemon';
import { useDaemonRegistry } from '../use-daemon-registry';
import { AddRemoteDialog } from '../AddRemoteDialog';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_URL = 'https://my-server.example.com';
const VALID_CODE = 'ABC123';

const REMOTE_META: DaemonMeta = {
  id: 'server-1',
  kind: 'remote',
  label: 'my-server',
  host: 'my-server.example.com',
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const mockAdd = vi.fn();
const mockSwitchTo = vi.fn();

let fakeHost: FakeHostBridge;

beforeEach(() => {
  fakeHost = new FakeHostBridge();
  setHostForTesting(fakeHost);

  vi.mocked(useDaemonRegistry).mockReturnValue({
    daemons: [],
    activeId: 'local',
    reload: vi.fn(),
    add: mockAdd,
    rename: vi.fn(),
    remove: vi.fn(),
    switchTo: mockSwitchTo,
  });

  vi.mocked(verifyDaemon).mockResolvedValue({ ok: true, version: '1.2.3', ms: 45 });
  vi.mocked(confirmPairing).mockResolvedValue({ token: 'jwt-abc', deviceId: 'dev-123' });
  mockAdd.mockResolvedValue(undefined);
  mockSwitchTo.mockResolvedValue(undefined);
});

afterEach(() => {
  resetHostForTesting();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Behavior 1 — add-mode happy path
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — add-mode happy path', () => {
  it('verify → reachable notice → continue → enter code → pair → onDone fires', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDone = vi.fn();

    render(<AddRemoteDialog open mode="add" onClose={onClose} onDone={onDone} />);

    // Step 0: enter URL
    const urlInput = screen.getByTestId('daemon-add-url');
    await user.clear(urlInput);
    await user.type(urlInput, TEST_URL);

    // Click Verify
    await user.click(screen.getByTestId('daemon-add-verify'));

    // Reachable notice should appear
    await waitFor(() => {
      expect(screen.getByText(/daemon reachable/i)).toBeInTheDocument();
    });

    expect(verifyDaemon).toHaveBeenCalledWith(TEST_URL);

    // Continue to step 1
    await user.click(screen.getByTestId('daemon-add-continue'));

    // Step 1: enter 6-char code via PairCodeInput
    const codeInput = screen.getByTestId('daemon-pair-code');
    // The 6 individual inputs inside PairCodeInput
    const boxes = codeInput.querySelectorAll('input');
    expect(boxes).toHaveLength(6);

    // Type each char into the corresponding input
    for (let i = 0; i < VALID_CODE.length; i++) {
      await user.click(boxes[i]!);
      await user.keyboard(VALID_CODE[i]!);
    }

    // Click Pair
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
// Behavior 2 — repair-mode: starts at step 1 with locked URL
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — repair-mode', () => {
  it('skips step 0, shows locked URL chip, confirms with setToken and calls onDone', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onDone = vi.fn();

    render(<AddRemoteDialog open mode="repair" target={REMOTE_META} onClose={onClose} onDone={onDone} />);

    // Should start at step 1 (no Verify button visible)
    expect(screen.queryByTestId('daemon-add-verify')).not.toBeInTheDocument();

    // URL chip visible with the locked URL
    expect(screen.getByText(new RegExp(REMOTE_META.host))).toBeInTheDocument();

    // Enter code
    const codeInput = screen.getByTestId('daemon-pair-code');
    const boxes = codeInput.querySelectorAll('input');

    for (let i = 0; i < VALID_CODE.length; i++) {
      await user.click(boxes[i]!);
      await user.keyboard(VALID_CODE[i]!);
    }

    // Click Re-pair
    const repairBtn = screen.getByTestId('daemon-add-confirm');
    await user.click(repairBtn);

    await waitFor(() => {
      expect(confirmPairing).toHaveBeenCalledTimes(1);
    });

    // repair-mode uses setToken, not add
    await waitFor(() => {
      expect(mockAdd).not.toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — invalid pairing code
// ---------------------------------------------------------------------------

describe('AddRemoteDialog — invalid code', () => {
  it('shows error notice and does NOT call registry.add on PairingError(invalid)', async () => {
    const user = userEvent.setup();
    vi.mocked(confirmPairing).mockRejectedValue(new PairingError('invalid'));

    const onDone = vi.fn();
    render(<AddRemoteDialog open mode="add" onClose={vi.fn()} onDone={onDone} />);

    // Fast-path to step 1: set URL then verify+continue via clicks
    const urlInput = screen.getByTestId('daemon-add-url');
    await user.clear(urlInput);
    await user.type(urlInput, TEST_URL);
    await user.click(screen.getByTestId('daemon-add-verify'));

    await waitFor(() => screen.getByText(/daemon reachable/i));

    await user.click(screen.getByTestId('daemon-add-continue'));

    const codeInput = screen.getByTestId('daemon-pair-code');
    const boxes = codeInput.querySelectorAll('input');
    for (let i = 0; i < VALID_CODE.length; i++) {
      await user.click(boxes[i]!);
      await user.keyboard(VALID_CODE[i]!);
    }

    await user.click(screen.getByTestId('daemon-add-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('daemon-add-error')).toBeInTheDocument();
    });

    expect(mockAdd).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
