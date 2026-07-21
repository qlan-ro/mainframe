// @vitest-environment jsdom
/**
 * resetDaemonScopedStores() — unit + integration tests.
 *
 * Behaviors covered:
 *  1. session-todos store resets to { byChat: {} }
 *  2. unread-store resets to empty Set
 *  3. active-bases-store resets bases to {} and scopeKey to null
 *  4. sandbox store resets processStatuses / logsOutput / captures / selectedConfigByScope / lastStartedProcess
 *  5. settings store clears providers, resets general to defaults, sets loading true, clears selectedProvider
 *  6. session-filters store clears filterProjectId, selectedTags, selectedSynthetic
 *  7. quota store clears byId (a daemon switch never shows the previous daemon's quota)
 *  8. Integration: switchTo invokes the reset (useUnreadStore is empty after a switch)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy deps that stores transitively import (ws-client, daemon-scoped-storage).
// These must be hoisted before the stores are imported.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Imports — after mocks.
// ---------------------------------------------------------------------------

import { GENERAL_DEFAULTS } from '@qlan-ro/mainframe-types';
import type { DaemonTarget } from '@qlan-ro/mainframe-types';
import { useSessionTodosStore } from '@/store/session-todos';
import { useUnreadStore } from '@/store/unread-store';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useSandboxStore } from '@/store/sandbox';
import { useSettingsStore } from '@/store/settings';
import { useSessionFilters } from '@/store/session-filters';
import { useQuotaStore, applyProviderQuota } from '@/store/quota';
import { resetDaemonScopedStores } from '../reset-daemon-scoped-stores';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seedStores() {
  useSessionTodosStore.setState({ byChat: { c1: [{ content: 'todo', status: 'pending', activeForm: 'TodoWrite' }] } });
  useUnreadStore.setState({ unread: new Set(['c1', 'c2']) });
  useActiveBasesStore.setState({ bases: { worktreePath: '/projects/myapp' }, scopeKey: 'proj:path' });
  useSandboxStore.setState({
    captures: [{ id: 'cap1', type: 'screenshot', imageDataUrl: 'data:...' }],
    processStatuses: { 'scope:path': { 'my-server': 'running' as any } },
    logsOutput: [{ seq: 1, scopeKey: 'scope:path', name: 'my-server', data: 'started', stream: 'stdout' }],
    selectedConfigByScope: { 'scope:path': 'dev' },
    lastStartedProcess: 'my-server',
  });
  useSettingsStore.setState({
    providers: { claude: { name: 'Claude', executable: 'claude', env: {} } as any },
    selectedProvider: 'claude',
    loading: false,
  });
  useSessionFilters.setState({
    filterProjectId: 'proj-1',
    selectedTags: new Set(['tag-a']),
    selectedSynthetic: new Set(['unread'] as any),
  });
  applyProviderQuota('claude', {
    status: 'ok',
    observedAt: Date.now(),
    modelWindows: [],
    session: { kind: 'session', usedPercent: 42, resetsAt: Date.now() + 3_600_000 },
  } as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  seedStores();
});

describe('resetDaemonScopedStores — session-todos', () => {
  it('resets byChat to an empty object', () => {
    resetDaemonScopedStores();
    expect(useSessionTodosStore.getState().byChat).toEqual({});
  });
});

describe('resetDaemonScopedStores — unread-store', () => {
  it('resets unread to an empty Set', () => {
    resetDaemonScopedStores();
    expect([...useUnreadStore.getState().unread]).toEqual([]);
  });
});

describe('resetDaemonScopedStores — active-bases-store', () => {
  it('resets bases to {} and scopeKey to null', () => {
    resetDaemonScopedStores();
    expect(useActiveBasesStore.getState().bases).toEqual({});
    expect(useActiveBasesStore.getState().scopeKey).toBeNull();
  });
});

describe('resetDaemonScopedStores — sandbox', () => {
  it('resets processStatuses, logsOutput, captures, selectedConfigByScope, and lastStartedProcess', () => {
    resetDaemonScopedStores();
    const state = useSandboxStore.getState();
    expect(state.captures).toEqual([]);
    expect(state.processStatuses).toEqual({});
    expect(state.logsOutput).toEqual([]);
    expect(state.selectedConfigByScope).toEqual({});
    expect(state.lastStartedProcess).toBeNull();
  });
});

describe('resetDaemonScopedStores — settings', () => {
  it('clears providers, sets loading to true, and clears selectedProvider', () => {
    resetDaemonScopedStores();
    const state = useSettingsStore.getState();
    expect(state.providers).toEqual({});
    expect(state.loading).toBe(true);
    expect(state.selectedProvider).toBeNull();
  });

  it('resets general to GENERAL_DEFAULTS values', () => {
    resetDaemonScopedStores();
    expect(useSettingsStore.getState().general).toEqual(GENERAL_DEFAULTS);
  });
});

describe('resetDaemonScopedStores — session-filters', () => {
  it('resets filterProjectId to null, clears selectedTags and selectedSynthetic', () => {
    resetDaemonScopedStores();
    const state = useSessionFilters.getState();
    expect(state.filterProjectId).toBeNull();
    expect([...state.selectedTags]).toEqual([]);
    expect([...state.selectedSynthetic]).toEqual([]);
  });
});

describe('resetDaemonScopedStores — quota', () => {
  it("clears byId so a daemon switch never shows the previous daemon's quota", () => {
    expect(Object.keys(useQuotaStore.getState().byId)).toContain('claude');
    resetDaemonScopedStores();
    expect(useQuotaStore.getState().byId).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Integration — switchTo triggers the reset.
// ---------------------------------------------------------------------------

describe('resetDaemonScopedStores — integration with switchTo', () => {
  it('switchTo clears the unread store', async () => {
    const { ActiveDaemonProvider } = await import('../active-daemon-context');
    const { useActiveDaemon } = await import('../active-daemon-context');

    // Seed unread state.
    useUnreadStore.setState({ unread: new Set(['chat-x']) });
    expect([...useUnreadStore.getState().unread]).toEqual(['chat-x']);

    // Simulate switchTo by extracting it via a minimal React-free call.
    // Since switchTo is async and only accessible from the hook (inside a Provider),
    // we spy on resetDaemonScopedStores itself to confirm it is called.
    const resetMod = await import('../reset-daemon-scoped-stores');
    const resetSpy = vi.spyOn(resetMod, 'resetDaemonScopedStores');

    const REMOTE_TARGET = {
      id: 'remote-1',
      kind: 'remote' as const,
      label: 'Remote Dev',
      baseUrl: 'https://tunnel.example.com:443',
      token: 'jwt-token-123',
    };

    // Access the provider's context directly: render it and call switchTo.
    const { render, act } = await import('@testing-library/react');
    const { createElement } = await import('react');
    const { useEffect } = await import('react');

    let capturedSwitch: ((t: typeof REMOTE_TARGET) => Promise<void>) | null = null;

    function Capturer() {
      const { switchTo } = useActiveDaemon();
      useEffect(() => {
        capturedSwitch = switchTo as any;
      }, [switchTo]);
      return null;
    }

    const LOCAL: DaemonTarget = {
      id: 'local',
      kind: 'local',
      label: 'Local',
      baseUrl: 'http://127.0.0.1:31415',
      token: null,
    };
    await act(async () => {
      render(createElement(ActiveDaemonProvider, { initialTarget: LOCAL, children: createElement(Capturer) }));
    });

    await act(async () => {
      await capturedSwitch!(REMOTE_TARGET);
    });

    expect(resetSpy).toHaveBeenCalledTimes(1);
    // The unread store must be clear after the switch.
    expect([...useUnreadStore.getState().unread]).toEqual([]);

    resetSpy.mockRestore();
  });
});
