import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { DaemonTarget } from '@qlan-ro/mainframe-types';
import { ActiveDaemonProvider, useActiveDaemon } from '@/features/daemon/active-daemon-context';
import { useDaemonIsLocal } from '../use-daemon-is-local';

// Stub out side-effectful modules that ActiveDaemonProvider's switchTo invokes.
vi.mock('@/lib/daemon/dispose-daemon-session', () => ({ disposeDaemonSession: vi.fn() }));
vi.mock('@/lib/daemon/ws-client', () => ({ daemonWs: { setPort: vi.fn(), connect: vi.fn() } }));
vi.mock('@/lib/lsp', () => ({ rebindLspToActiveDaemon: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/features/daemon/reset-daemon-scoped-stores', () => ({
  resetDaemonScopedStores: vi.fn(),
}));

const LOCAL_TARGET = {
  id: 'local',
  kind: 'local' as const,
  label: 'Local',
  baseUrl: 'http://127.0.0.1:31415',
  token: null,
};

const REMOTE_TARGET = {
  id: 'studio',
  kind: 'remote' as const,
  label: 'Studio',
  baseUrl: 'https://studio.example.com',
  token: 'jwt-token',
};

function makeWrapper(initialTarget: DaemonTarget = LOCAL_TARGET) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <ActiveDaemonProvider initialTarget={initialTarget}>{children}</ActiveDaemonProvider>;
  };
}

describe('useDaemonIsLocal', () => {
  it('returns true when the active target is local', () => {
    const { result } = renderHook(() => useDaemonIsLocal(), { wrapper: makeWrapper(LOCAL_TARGET) });
    expect(result.current).toBe(true);
  });

  it('returns false when the active target is remote', () => {
    const { result } = renderHook(() => useDaemonIsLocal(), {
      wrapper: makeWrapper(REMOTE_TARGET),
    });
    expect(result.current).toBe(false);
  });

  it('updates reactively after switchTo changes the target from local to remote', async () => {
    const { result } = renderHook(() => ({ isLocal: useDaemonIsLocal(), daemon: useActiveDaemon() }), {
      wrapper: makeWrapper(LOCAL_TARGET),
    });

    expect(result.current.isLocal).toBe(true);

    await act(async () => {
      await result.current.daemon.switchTo(REMOTE_TARGET);
    });

    expect(result.current.isLocal).toBe(false);
  });
});
