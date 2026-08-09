/**
 * useDaemonRegistry — TDD test.
 *
 * Behaviors covered:
 *  1. daemons list includes a synthetic local entry prepended before persisted remotes.
 *  2. add persists meta + token and the daemon appears in the list.
 *  3. switchTo('studio') resolves a DaemonTarget with the stored token and flips activeId.
 *  4. the resolved target honors the scheme the daemon was paired with (absent means https).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DaemonMeta, DaemonTarget } from '@qlan-ro/mainframe-types';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import { disposeDaemonSession } from '@/lib/daemon/dispose-daemon-session';
import { markAuthFailure, clearAuthFailure, hasAuthFailure } from '@/lib/daemon/auth-failure-store';
import { ActiveDaemonProvider, useActiveDaemon } from '../active-daemon-context';
import { useDaemonRegistry } from '../use-daemon-registry';

// ---------------------------------------------------------------------------
// Mocks — needed because ActiveDaemonProvider.switchTo calls into modules that
// don't exist in jsdom. Mock the side-effecting modules only.
// ---------------------------------------------------------------------------

import { vi } from 'vitest';

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

// Paired over plain http on loopback — the scheme is persisted on the entry.
const REMOTE_LOOPBACK: DaemonMeta = {
  id: 'loopback',
  kind: 'remote',
  label: 'QA daemon',
  host: '127.0.0.1:31500',
  scheme: 'http',
};

const REMOTE_TOKEN = 'jwt-secret-token';

const LOCAL_TARGET: DaemonTarget = {
  id: 'local',
  kind: 'local',
  label: 'This Mac',
  baseUrl: `http://127.0.0.1:${TEST_PORT}`,
  token: null,
};

// ---------------------------------------------------------------------------
// Wrapper that provides all required contexts
// ---------------------------------------------------------------------------

function makeWrapper(_fakeHost: FakeHostBridge) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DaemonPortProvider port={TEST_PORT}>
        <ActiveDaemonProvider initialTarget={LOCAL_TARGET}>{children}</ActiveDaemonProvider>
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
  // Seed one remote daemon + token before any hook renders.
  await fakeHost.daemons.upsert(REMOTE_STUDIO);
  await fakeHost.daemons.setToken(REMOTE_STUDIO.id, REMOTE_TOKEN);
  setHostForTesting(fakeHost);
});

afterEach(() => {
  resetHostForTesting();
  vi.clearAllMocks();
  clearAuthFailure('studio');
});

// ---------------------------------------------------------------------------
// Behavior 1 — daemons list includes synthetic local + persisted remote
// ---------------------------------------------------------------------------

describe('useDaemonRegistry — initial list', () => {
  it('includes a synthetic local entry as the first item', async () => {
    const { result } = renderHook(() => useDaemonRegistry(), { wrapper: makeWrapper(fakeHost) });

    // Wait for the async load to settle.
    await act(async () => {});

    const first = result.current.daemons[0];
    expect(first).toBeDefined();
    expect(first?.id).toBe('local');
    expect(first?.kind).toBe('local');
    expect(first?.label).toBe('This Mac');
    expect(first?.host).toBe(`127.0.0.1:${TEST_PORT}`);
  });

  it('includes the persisted remote after the local entry', async () => {
    const { result } = renderHook(() => useDaemonRegistry(), { wrapper: makeWrapper(fakeHost) });

    await act(async () => {});

    expect(result.current.daemons).toHaveLength(2);
    const second = result.current.daemons[1];
    expect(second?.id).toBe('studio');
    expect(second?.label).toBe('Studio Mac');
  });

  it('activeId reflects the initial local daemon', async () => {
    const { result } = renderHook(() => useDaemonRegistry(), { wrapper: makeWrapper(fakeHost) });

    await act(async () => {});

    expect(result.current.activeId).toBe('local');
  });
});

// ---------------------------------------------------------------------------
// Behavior 2 — add persists meta + token and the daemon appears in the list
// ---------------------------------------------------------------------------

describe('useDaemonRegistry — add', () => {
  it('persists the new meta so it appears in daemons after add', async () => {
    const { result } = renderHook(() => useDaemonRegistry(), { wrapper: makeWrapper(fakeHost) });

    await act(async () => {});

    const newMeta: DaemonMeta = {
      id: 'laptop',
      kind: 'remote',
      label: 'Laptop',
      host: 'laptop.example.com:443',
    };
    const newToken = 'laptop-token';

    await act(async () => {
      await result.current.add(newMeta, newToken);
    });

    const ids = result.current.daemons.map((d) => d.id);
    expect(ids).toContain('laptop');
  });

  it('stores the token so getToken returns it after add', async () => {
    const { result } = renderHook(() => useDaemonRegistry(), { wrapper: makeWrapper(fakeHost) });

    await act(async () => {});

    const newMeta: DaemonMeta = { id: 'laptop', kind: 'remote', label: 'Laptop', host: 'laptop.example.com:443' };
    const newToken = 'laptop-token';

    await act(async () => {
      await result.current.add(newMeta, newToken);
    });

    await expect(fakeHost.daemons.getToken('laptop')).resolves.toBe('laptop-token');
  });
});

// ---------------------------------------------------------------------------
// Behavior 3 — switchTo('studio') resolves a DaemonTarget with the stored
// token and flips activeId
// ---------------------------------------------------------------------------

describe('useDaemonRegistry — switchTo', () => {
  it('switchTo("studio") flips activeId to "studio"', async () => {
    const { result } = renderHook(() => ({ registry: useDaemonRegistry(), daemon: useActiveDaemon() }), {
      wrapper: makeWrapper(fakeHost),
    });

    await act(async () => {});

    expect(result.current.registry.activeId).toBe('local');

    await act(async () => {
      await result.current.registry.switchTo('studio');
    });

    expect(result.current.registry.activeId).toBe('studio');
  });

  it('switchTo("studio") builds a DaemonTarget with the stored token', async () => {
    const { result } = renderHook(() => ({ registry: useDaemonRegistry(), daemon: useActiveDaemon() }), {
      wrapper: makeWrapper(fakeHost),
    });

    await act(async () => {});

    await act(async () => {
      await result.current.registry.switchTo('studio');
    });

    const target = result.current.daemon.target;
    expect(target.id).toBe('studio');
    expect(target.kind).toBe('remote');
    expect(target.token).toBe(REMOTE_TOKEN);
    // parseRemoteUrl normalizes https://host:443 → https://host (port 443 is the https default).
    expect(target.baseUrl).toBe('https://studio.example.com');
  });

  it(
    'a switchTo reference captured BEFORE add() still resolves the newly ' +
      'added daemon after add() resolves (bug i regression)',
    async () => {
      // Reproduces AddRemoteDialog.handleConfirm: the component destructures
      // `registry` (and therefore `switchTo`) once at render time, then awaits
      // `add()` before calling the SAME `switchTo` reference. If `switchTo`
      // closes over the pre-add `remotes` snapshot, it can never find the
      // daemon that `add()` just persisted.
      const { result } = renderHook(() => ({ registry: useDaemonRegistry(), daemon: useActiveDaemon() }), {
        wrapper: makeWrapper(fakeHost),
      });

      await act(async () => {});

      const staleAdd = result.current.registry.add;
      const staleSwitchTo = result.current.registry.switchTo;

      const newMeta: DaemonMeta = { id: 'laptop', kind: 'remote', label: 'Laptop', host: 'laptop.example.com:443' };

      await act(async () => {
        await staleAdd(newMeta, 'laptop-token');
        await staleSwitchTo(newMeta.id);
      });

      expect(result.current.registry.activeId).toBe('laptop');
      expect(result.current.daemon.target.id).toBe('laptop');
    },
  );

  it('switchTo("local") switches back to local daemon with null token', async () => {
    const { result } = renderHook(() => ({ registry: useDaemonRegistry(), daemon: useActiveDaemon() }), {
      wrapper: makeWrapper(fakeHost),
    });

    await act(async () => {});

    // First switch to remote.
    await act(async () => {
      await result.current.registry.switchTo('studio');
    });

    // Then switch back to local.
    await act(async () => {
      await result.current.registry.switchTo('local');
    });

    const target = result.current.daemon.target;
    expect(target.id).toBe('local');
    expect(target.token).toBeNull();
    expect(target.baseUrl).toBe(`http://127.0.0.1:${TEST_PORT}`);
  });
});

// ---------------------------------------------------------------------------
// Behavior 4 — the resolved target composes its base URL from the stored
// scheme. An entry written before the scheme was persisted carries none and
// must keep resolving to https (the REMOTE_STUDIO assertions above pin that);
// an http-paired entry must resolve to http, or the daemon it was paired with
// is unreachable for the life of the entry (todo #305).
// ---------------------------------------------------------------------------

describe('useDaemonRegistry — paired scheme', () => {
  async function renderWithLoopback() {
    await fakeHost.daemons.upsert(REMOTE_LOOPBACK);
    await fakeHost.daemons.setToken(REMOTE_LOOPBACK.id, 'loopback-token');

    const rendered = renderHook(() => ({ registry: useDaemonRegistry(), daemon: useActiveDaemon() }), {
      wrapper: makeWrapper(fakeHost),
    });
    await act(async () => {});
    await act(async () => {
      await rendered.result.current.registry.switchTo(REMOTE_LOOPBACK.id);
    });
    return rendered;
  }

  it('resolves an http-paired daemon to its http origin', async () => {
    const { result } = await renderWithLoopback();

    expect(result.current.daemon.target.baseUrl).toBe('http://127.0.0.1:31500');
  });

  it('derives a ws:// socket URL for an http-paired daemon', async () => {
    const { result } = await renderWithLoopback();

    // The rule ws-client.ts and lsp-client.ts both apply to the active target.
    const wsBase = result.current.daemon.target.baseUrl.replace(/^http/, 'ws');
    expect(wsBase).toBe('ws://127.0.0.1:31500');
  });

  it('resolves an entry with no stored scheme to https (pre-change registry shape)', async () => {
    const { result } = renderHook(() => ({ registry: useDaemonRegistry(), daemon: useActiveDaemon() }), {
      wrapper: makeWrapper(fakeHost),
    });
    await act(async () => {});
    await act(async () => {
      await result.current.registry.switchTo('studio');
    });

    expect(REMOTE_STUDIO.scheme).toBeUndefined();
    expect(result.current.daemon.target.baseUrl).toBe('https://studio.example.com');
    expect(result.current.daemon.target.baseUrl.replace(/^http/, 'ws')).toBe('wss://studio.example.com');
  });
});

// ---------------------------------------------------------------------------
// Behavior 5 — switchTo('local') restores the TRUE local port even when
// `useDaemonPort()` tracks the currently-ACTIVE daemon's port (App.tsx's real
// wiring: DaemonGatedShell derives its `port` prop from `target.baseUrl`, so
// it changes to the remote's port while a remote is active — see App.tsx's
// `DaemonGatedShell`). `makeWrapper` above uses a STATIC port, which masked
// this: it can't reproduce the bug where `switchTo('local')`, resolving
// `buildLocalTarget(port)` from the *current* (remote-derived) port instead of
// the true local sidecar port, permanently corrupts the local entry's host
// after any remote switch.
// ---------------------------------------------------------------------------

function DynamicPortFromActiveTarget({ children }: { children: ReactNode }) {
  const { target } = useActiveDaemon();
  const url = new URL(target.baseUrl);
  const activePort = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  return <DaemonPortProvider port={activePort}>{children}</DaemonPortProvider>;
}

function makeDynamicPortWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ActiveDaemonProvider initialTarget={LOCAL_TARGET}>
        <DynamicPortFromActiveTarget>{children}</DynamicPortFromActiveTarget>
      </ActiveDaemonProvider>
    );
  };
}

const REMOTE_DEVBOX: DaemonMeta = {
  id: 'devbox',
  kind: 'remote',
  label: 'Devbox',
  host: 'devbox.example.com:9443',
};

// ---------------------------------------------------------------------------
// Behavior 6 — retoken() swaps the active target's token in place after a
// re-pair, without the teardown/reconnect switchTo performs (todo #219).
// ---------------------------------------------------------------------------

describe('useDaemonRegistry — retoken', () => {
  async function renderActiveStudio() {
    const rendered = renderHook(() => ({ registry: useDaemonRegistry(), daemon: useActiveDaemon() }), {
      wrapper: makeWrapper(fakeHost),
    });
    await act(async () => {});
    await act(async () => {
      await rendered.result.current.registry.switchTo('studio');
    });
    vi.mocked(disposeDaemonSession).mockClear();
    return rendered;
  }

  it('re-reads the stored token into the active target', async () => {
    const { result } = await renderActiveStudio();
    expect(result.current.daemon.target.token).toBe(REMOTE_TOKEN);

    await fakeHost.daemons.setToken('studio', 'repaired-token');
    await act(async () => {
      await result.current.registry.retoken('studio');
    });

    expect(result.current.daemon.target.token).toBe('repaired-token');
    expect(result.current.daemon.target.baseUrl).toBe('https://studio.example.com');
  });

  it('clears the daemon auth-failure marker', async () => {
    const { result } = await renderActiveStudio();
    markAuthFailure('studio');

    await fakeHost.daemons.setToken('studio', 'repaired-token');
    await act(async () => {
      await result.current.registry.retoken('studio');
    });

    expect(hasAuthFailure('studio')).toBe(false);
  });

  it('does not tear the session down', async () => {
    const { result } = await renderActiveStudio();

    await fakeHost.daemons.setToken('studio', 'repaired-token');
    await act(async () => {
      await result.current.registry.retoken('studio');
    });

    expect(disposeDaemonSession).not.toHaveBeenCalled();
  });

  it('warns and leaves the target alone when no token is stored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = await renderActiveStudio();

    await act(async () => {
      await result.current.registry.retoken('laptop');
    });

    expect(warn).toHaveBeenCalled();
    expect(result.current.daemon.target.token).toBe(REMOTE_TOKEN);
    warn.mockRestore();
  });
});

describe('useDaemonRegistry — switchTo("local") with a dynamic (active-daemon-derived) port provider', () => {
  it('restores the true local port, not the remote port left behind in context', async () => {
    await fakeHost.daemons.upsert(REMOTE_DEVBOX);
    await fakeHost.daemons.setToken(REMOTE_DEVBOX.id, 'devbox-token');

    const { result } = renderHook(() => ({ registry: useDaemonRegistry(), daemon: useActiveDaemon() }), {
      wrapper: makeDynamicPortWrapper(),
    });

    await act(async () => {});
    expect(result.current.daemon.target.baseUrl).toBe(`http://127.0.0.1:${TEST_PORT}`);

    await act(async () => {
      await result.current.registry.switchTo('devbox');
    });
    expect(result.current.daemon.target.baseUrl).toBe('https://devbox.example.com:9443');

    await act(async () => {
      await result.current.registry.switchTo('local');
    });

    const target = result.current.daemon.target;
    expect(target.id).toBe('local');
    expect(target.baseUrl).toBe(`http://127.0.0.1:${TEST_PORT}`);
  });
});
