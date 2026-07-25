// @vitest-environment jsdom
/**
 * use-setup-advisor-store.reset.test.ts
 *
 * Split from use-setup-advisor-store.test.ts: resetDaemonScopedStores() drags in
 * the same heavy-mock chain as reset-daemon-scoped-stores.test.ts (ws-client,
 * daemon-scoped-storage, active-daemon, lsp) via its other registered stores,
 * which the plain store-behavior suite has no reason to carry.
 */
import { describe, it, expect, vi } from 'vitest';

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

vi.mock('@/lib/api/setup-advisor', () => ({
  getAutomationRecommendations: vi.fn(),
}));

import { useSetupAdvisorStore } from '../use-setup-advisor-store';
import { resetDaemonScopedStores } from '@/features/daemon/reset-daemon-scoped-stores';

describe('resetDaemonScopedStores — setup-advisor', () => {
  it('resets report, reportProjectId, error, and copiedByProject to their initial values', () => {
    useSetupAdvisorStore.setState({
      report: {
        fingerprint: {
          languages: ['typescript'],
          frameworks: [],
          databases: [],
          externalApis: [],
          testing: [],
          tooling: [],
          gitHost: null,
          hasClaudeConfig: false,
          hasEnvFiles: false,
          hasLockFiles: false,
          dirs: [],
          fileCount: 1,
          signals: ['TypeScript'],
        },
        recommendations: [],
      },
      reportProjectId: 'proj-a',
      loading: false,
      error: 'stale error',
      copiedByProject: { 'proj-a': new Set(['mcp-supabase']) },
    });

    resetDaemonScopedStores();

    const state = useSetupAdvisorStore.getState();
    expect(state.report).toBeNull();
    expect(state.reportProjectId).toBeNull();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.copiedByProject).toEqual({});
  });
});
