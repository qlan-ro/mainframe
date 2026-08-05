/**
 * DaemonSwitcher — surfaces the `needs-repair` marker on the trigger's
 * ConnDot (task 6, todo #219; ported from the v1 DaemonFooterStatus test).
 * The v2 trigger is dot-only, so the status is asserted via the ConnDot's
 * aria-label rather than a status word.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DaemonMeta, DaemonTarget } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { ActiveDaemonProvider } from '@/features/daemon/active-daemon-context';
import { ConnectionStatusProvider } from '@/app/ConnectionStatusContext';
import { SidebarProvider } from '@v2/components/ui/sidebar';
import { markAuthFailure, clearAuthFailure } from '@/lib/daemon/auth-failure-store';
import { DaemonSwitcher } from '../DaemonSwitcher';

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
vi.mock('@/features/daemon/pair-daemon', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/daemon/pair-daemon')>();
  return { ...original, verifyDaemon: vi.fn(), confirmPairing: vi.fn() };
});

const TEST_PORT = 31415;

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
  token: 'jwt-secret-token',
};

function makeWrapper(initialTarget: DaemonTarget, connectionState: 'connected' | 'connecting' | 'disconnected') {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DaemonPortProvider port={TEST_PORT}>
        <ActiveDaemonProvider initialTarget={initialTarget}>
          <ConnectionStatusProvider value={{ state: connectionState, daemonStatus: 'ok' }}>
            <SidebarProvider>{children}</SidebarProvider>
          </ConnectionStatusProvider>
        </ActiveDaemonProvider>
      </DaemonPortProvider>
    );
  };
}

let fakeHost: FakeHostBridge;

beforeEach(async () => {
  fakeHost = new FakeHostBridge();
  await fakeHost.daemons.upsert(REMOTE_STUDIO);
  await fakeHost.daemons.setToken(REMOTE_STUDIO.id, 'jwt-secret-token');
  setHostForTesting(fakeHost);
  clearAuthFailure('studio');
  clearAuthFailure('other-daemon');
});

afterEach(() => {
  resetHostForTesting();
  vi.clearAllMocks();
  clearAuthFailure('studio');
  clearAuthFailure('other-daemon');
});

function trigger() {
  return screen.getByTestId('daemon-footer-trigger');
}

describe('DaemonSwitcher — needs-repair marker', () => {
  it('shows the Re-pair dot once the active remote is marked', () => {
    render(<DaemonSwitcher />, { wrapper: makeWrapper(REMOTE_STUDIO_TARGET, 'connected') });
    expect(trigger().querySelector('[aria-label="Connected"]')).toBeTruthy();

    act(() => {
      markAuthFailure('studio');
    });

    expect(trigger().querySelector('[aria-label="Re-pair needed"]')).toBeTruthy();
  });

  it('returns to Connected after the marker clears, with no remount', () => {
    render(<DaemonSwitcher />, { wrapper: makeWrapper(REMOTE_STUDIO_TARGET, 'connected') });

    act(() => {
      markAuthFailure('studio');
    });
    expect(trigger().querySelector('[aria-label="Re-pair needed"]')).toBeTruthy();

    act(() => {
      clearAuthFailure('studio');
    });
    expect(trigger().querySelector('[aria-label="Connected"]')).toBeTruthy();
  });

  it('a marker on a non-active daemon id does not change the active status', () => {
    render(<DaemonSwitcher />, { wrapper: makeWrapper(REMOTE_STUDIO_TARGET, 'connected') });

    act(() => {
      markAuthFailure('other-daemon');
    });

    expect(trigger().querySelector('[aria-label="Connected"]')).toBeTruthy();
  });

  it('needs-repair wins over connecting', () => {
    render(<DaemonSwitcher />, { wrapper: makeWrapper(REMOTE_STUDIO_TARGET, 'connecting') });

    act(() => {
      markAuthFailure('studio');
    });

    expect(trigger().querySelector('[aria-label="Re-pair needed"]')).toBeTruthy();
  });

  it('a disconnected connection state still reads unreachable even when marked', () => {
    render(<DaemonSwitcher />, { wrapper: makeWrapper(REMOTE_STUDIO_TARGET, 'disconnected') });

    act(() => {
      markAuthFailure('studio');
    });

    expect(trigger().querySelector('[aria-label="Unreachable"]')).toBeTruthy();
  });
});
