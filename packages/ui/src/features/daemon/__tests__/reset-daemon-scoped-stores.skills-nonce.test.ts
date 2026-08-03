// @vitest-environment jsdom
/**
 * reset-daemon-scoped-stores.skills-nonce.test.ts (spec Decision D9; plan T40 / Group I3)
 *
 * Red until `resetDaemonScopedStores()` calls `bumpSkillsRevalidation()`
 * (Group J2). D9: a daemon switch must BUMP the shared skills nonce, never
 * reset it to 0 — a reset to 0 could collide with a value a subscriber
 * already observed and suppress the refetch the switch requires.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

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

vi.mock('@/lib/daemon/daemon-scoped-storage', () => ({
  daemonScopedKey: (key: string) => key,
}));

vi.mock('@/lib/daemon/active-daemon', () => ({
  getActiveDaemon: vi.fn(() => ({
    id: 'local',
    kind: 'local',
    label: 'Local',
    baseUrl: 'http://127.0.0.1:31415',
    token: null,
  })),
  setActiveDaemon: vi.fn(),
  subscribeActiveDaemon: vi.fn(() => () => {}),
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

import { useSkillsNonce } from '@/features/skills/use-skills-revalidation';
import { resetDaemonScopedStores } from '../reset-daemon-scoped-stores';

/** `useSkillsNonce` is a hook selector with no exported store; read its current
 * value by mounting it in a throwaway render, mirroring the pattern in
 * use-skills-revalidation.test.ts. */
function readNonce(): number {
  const { result, unmount } = renderHook(() => useSkillsNonce());
  const value = result.current;
  unmount();
  return value;
}

describe('resetDaemonScopedStores — skills revalidation nonce (D9)', () => {
  it('increases the nonce rather than resetting it to 0', () => {
    const before = readNonce();

    resetDaemonScopedStores();

    expect(readNonce()).toBeGreaterThan(before);
  });

  it('calling it twice yields two distinct values', () => {
    resetDaemonScopedStores();
    const afterFirst = readNonce();

    resetDaemonScopedStores();
    const afterSecond = readNonce();

    expect(afterSecond).not.toBe(afterFirst);
    expect(afterSecond).toBeGreaterThan(afterFirst);
  });
});
