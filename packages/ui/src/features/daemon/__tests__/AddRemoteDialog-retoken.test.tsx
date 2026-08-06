/**
 * AddRemoteDialog — repair-mode re-token propagation (task 7, todo #219).
 *
 * A repair only calls `getHost().daemons.setToken` today; it never updates the
 * live active-daemon singleton (so in-flight REST calls keep using the stale
 * token) and never clears the daemon's auth-failure marker. Uses the REAL
 * `active-daemon` singleton and `ActiveDaemonProvider` (not the fully-mocked
 * `useDaemonRegistry` from the sibling `AddRemoteDialog.test.tsx`) so the
 * singleton's observed token is meaningful evidence, not a mock echo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DaemonMeta, DaemonTarget } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { getActiveDaemon, setActiveDaemon, subscribeActiveDaemon } from '@/lib/daemon/active-daemon';
import { PairingError } from '../pair-daemon';

const { clearAuthFailureSpy, markAuthFailureSpy } = vi.hoisted(() => ({
  clearAuthFailureSpy: vi.fn(),
  markAuthFailureSpy: vi.fn(),
}));

vi.mock('../../../lib/daemon/auth-failure-store', () => ({
  markAuthFailure: markAuthFailureSpy,
  clearAuthFailure: clearAuthFailureSpy,
  hasAuthFailure: vi.fn(() => false),
  subscribeAuthFailures: vi.fn(() => () => {}),
}));

vi.mock('../pair-daemon', async (importOriginal) => {
  const original = await importOriginal<typeof import('../pair-daemon')>();
  return { ...original, verifyDaemon: vi.fn(), confirmPairing: vi.fn() };
});

const { disposeDaemonSessionSpy } = vi.hoisted(() => ({ disposeDaemonSessionSpy: vi.fn() }));
vi.mock('@/lib/daemon/dispose-daemon-session', () => ({
  disposeDaemonSession: disposeDaemonSessionSpy,
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
import { confirmPairing } from '../pair-daemon';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { ActiveDaemonProvider } from '../active-daemon-context';
import { AddRemoteDialog } from '@v2/features/daemon/AddRemoteDialog';

// input-otp polls document.elementFromPoint from a timer; jsdom doesn't
// implement it.
document.elementFromPoint ??= () => null;

const TEST_PORT = 31415;
const VALID_CODE = 'ABC123';
const OLD_TOKEN = 'old-token';
const NEW_TOKEN = 'new-token';

const REMOTE_STUDIO: DaemonMeta = {
  id: 'studio',
  kind: 'remote',
  label: 'Studio Mac',
  host: 'studio.example.com:443',
};

const REMOTE_STUDIO_TARGET: DaemonTarget = {
  id: 'studio',
  kind: 'remote',
  label: 'Studio Mac',
  baseUrl: `https://${REMOTE_STUDIO.host}`,
  token: OLD_TOKEN,
};

const LOCAL_TARGET: DaemonTarget = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: 'http://127.0.0.1:0',
  token: null,
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <DaemonPortProvider port={TEST_PORT}>
      <ActiveDaemonProvider>{children}</ActiveDaemonProvider>
    </DaemonPortProvider>
  );
}

// The v2 code field is an input-otp: one hidden input behind slot divs, so
// the code is typed as a whole after focusing the field.
async function typeCode(user: ReturnType<typeof userEvent.setup>, code: string) {
  const codeInput = screen.getByTestId('daemon-pair-code');
  await user.click(codeInput);
  await user.keyboard(code);
}

let fakeHost: FakeHostBridge;
let setTokenSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  fakeHost = new FakeHostBridge();
  await fakeHost.daemons.upsert(REMOTE_STUDIO);
  await fakeHost.daemons.setToken(REMOTE_STUDIO.id, OLD_TOKEN);
  setTokenSpy = vi.spyOn(fakeHost.daemons, 'setToken');
  setHostForTesting(fakeHost);

  // Seed the REAL singleton (not just a Provider prop) so the code under test
  // sees this remote as the currently-active daemon, matching the real app's
  // repair-your-own-connection scenario.
  setActiveDaemon(REMOTE_STUDIO_TARGET);

  vi.mocked(confirmPairing).mockResolvedValue({ token: NEW_TOKEN, deviceId: 'dev-123' });
});

afterEach(() => {
  resetHostForTesting();
  vi.clearAllMocks();
  setActiveDaemon(LOCAL_TARGET);
});

describe('AddRemoteDialog — repair re-tokens the active singleton', () => {
  it('setToken, then the singleton token, then clearAuthFailure — in that order', async () => {
    const user = userEvent.setup();
    const singletonUpdateSpy = vi.fn();
    const unsubscribe = subscribeActiveDaemon((t) => {
      if (t.token === NEW_TOKEN) singletonUpdateSpy(t);
    });

    render(<AddRemoteDialog open mode="repair" target={REMOTE_STUDIO} onClose={vi.fn()} onDone={vi.fn()} />, {
      wrapper: Wrapper,
    });

    await typeCode(user, VALID_CODE);
    await user.click(screen.getByTestId('daemon-add-confirm'));

    await waitFor(() => {
      expect(setTokenSpy).toHaveBeenCalledWith(REMOTE_STUDIO.id, NEW_TOKEN);
    });
    await waitFor(() => {
      expect(getActiveDaemon().token).toBe(NEW_TOKEN);
    });
    await waitFor(() => {
      expect(clearAuthFailureSpy).toHaveBeenCalledWith(REMOTE_STUDIO.id);
    });

    expect(singletonUpdateSpy.mock.invocationCallOrder[0]).toBeGreaterThan(setTokenSpy.mock.invocationCallOrder[0]!);
    expect(clearAuthFailureSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
      singletonUpdateSpy.mock.invocationCallOrder[0]!,
    );

    unsubscribe();
  });

  it('does not run the full teardown/reconnect (registry.switchTo) on repair', async () => {
    const user = userEvent.setup();

    render(<AddRemoteDialog open mode="repair" target={REMOTE_STUDIO} onClose={vi.fn()} onDone={vi.fn()} />, {
      wrapper: Wrapper,
    });

    await typeCode(user, VALID_CODE);
    await user.click(screen.getByTestId('daemon-add-confirm'));

    await waitFor(() => {
      expect(setTokenSpy).toHaveBeenCalledWith(REMOTE_STUDIO.id, NEW_TOKEN);
    });

    expect(disposeDaemonSessionSpy).not.toHaveBeenCalled();
  });

  it('a PairingError("invalid") leaves the stored token and the marker untouched', async () => {
    const user = userEvent.setup();
    vi.mocked(confirmPairing).mockRejectedValue(new PairingError('invalid'));

    render(<AddRemoteDialog open mode="repair" target={REMOTE_STUDIO} onClose={vi.fn()} onDone={vi.fn()} />, {
      wrapper: Wrapper,
    });

    await typeCode(user, VALID_CODE);
    await user.click(screen.getByTestId('daemon-add-confirm'));

    await waitFor(() => {
      expect(confirmPairing).toHaveBeenCalledTimes(1);
    });

    expect(setTokenSpy).not.toHaveBeenCalled();
    expect(clearAuthFailureSpy).not.toHaveBeenCalled();
    expect(markAuthFailureSpy).not.toHaveBeenCalled();
    expect(getActiveDaemon().token).toBe(OLD_TOKEN);
  });
});
