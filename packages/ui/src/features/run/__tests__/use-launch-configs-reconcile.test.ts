// @vitest-environment jsdom
/**
 * useLaunchConfigs — reconcile path: scope-aware tab creation.
 *
 * The reconcile path runs on every fetch: for each already-running config it
 * ensures a Run tab exists in the layout store. The production bug is that
 * `tabbed` (the "already has a tab" guard) is keyed only by config NAME, not
 * by scopeKey. So when scope A already has a 'dev' tab, fetching scope B's
 * statuses (also 'dev') finds 'dev' in `tabbed` and skips creating a tab for
 * scope B — the preview for project B never appears.
 *
 * Behaviors tested:
 *  1. Reconcile creates a tab for the running 'dev' config under the fetched
 *     scope ('proj-B:/ws/b') when no tab exists yet.
 *  2. KEY REGRESSION: a same-named 'dev' tab for a DIFFERENT scope
 *     ('proj-A:/ws/a') is already in the store. After reconciling scope B the
 *     store must contain BOTH — one for scope A, one for scope B. The old
 *     name-only tabbed guard skips this → only scope-A tab → FAILS (RED).
 *  3. Control: when an existing tab already covers the same scope ('proj-B:/ws/b')
 *     reconcile does NOT add a duplicate (still exactly one 'dev' tab for scope B).
 *
 * Mocked dependencies (minimal — real stores used for genuine state exercise):
 *  - @/lib/api/launch  — fetchLaunchConfigs / fetchLaunchStatuses
 *  - @/store/terminal-cleanup — side-effecting Tauri import chain
 *  - @/features/terminal/terminal-cache — required by terminal-cleanup
 *  - @/store/layout-persist — avoids localStorage coupling in tests
 */
import { it, expect, vi, beforeEach, describe } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';

// ── mock terminal deps (Tauri import chain) ──────────────────────────────────
vi.mock('@/features/terminal/terminal-cache', () => ({
  getCachedTerminal: vi.fn().mockReturnValue(null),
  disposeCachedTerminal: vi.fn(),
}));

vi.mock('@/store/terminal-cleanup', () => ({
  killAndDisposeCachedTerminals: vi.fn(),
}));

// ── mock layout-persist (avoids localStorage coupling) ───────────────────────
vi.mock('@/store/layout-persist', () => ({
  layoutPersistOptions: {
    name: 'mf:session-layout-test',
    storage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    partialize: (s: unknown) => s,
  },
}));

// ── mock useDaemonIsLocal ────────────────────────────────────────────────────
vi.mock('@/lib/daemon/use-daemon-is-local', () => ({
  useDaemonIsLocal: vi.fn().mockReturnValue(true),
}));

// ── mock launch API ──────────────────────────────────────────────────────────
const devConfig: LaunchConfiguration = {
  name: 'dev',
  runtimeExecutable: 'npm',
  runtimeArgs: ['run', 'dev'],
  port: null,
  url: null,
  preview: true,
};

vi.mock('@/lib/api/launch', () => ({
  fetchLaunchConfigs: vi.fn(),
  fetchLaunchStatuses: vi.fn(),
}));

import { fetchLaunchConfigs, fetchLaunchStatuses } from '@/lib/api/launch';

// ── real stores ───────────────────────────────────────────────────────────────
import { useLayoutStore } from '@/store/layout';
import { useSandboxStore } from '@/store/sandbox';
import { buildLaunchScope } from '@/lib/launch-scope';

const CLEAN_SANDBOX = {
  captures: [],
  processStatuses: {},
  logsOutput: [],
  selectedConfigByScope: {},
  lastStartedProcess: null,
};

const CLEAN_LAYOUT = {
  layout: {
    top: ['chat' as const],
    bottom: null,
    topFlex: {},
    vFlex: { top: 1, bottom: 0.4 },
  },
  run: null,
  sessions: new Map(),
  activeSessionId: null,
};

beforeEach(() => {
  useSandboxStore.setState(CLEAN_SANDBOX);
  useLayoutStore.setState(CLEAN_LAYOUT);
  vi.mocked(fetchLaunchConfigs).mockResolvedValue([devConfig]);
  vi.mocked(fetchLaunchStatuses).mockResolvedValue({
    statuses: { dev: 'running' },
    tunnelUrls: {},
    effectivePath: '/ws/b',
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

/** All launch tabs (preview/console) across all run panes. */
function allRunTabs() {
  const run = useLayoutStore.getState().run;
  if (!run) return [];
  return run.panes.flatMap((p) => p.tabs).filter((t) => t.kind === 'preview' || t.kind === 'console');
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('useLaunchConfigs — reconcile creates a tab for the running config', () => {
  it('adds a tab with config "dev" and scopeKey "proj-B:/ws/b" when no tab exists yet', async () => {
    const { useLaunchConfigs } = await import('../use-launch-configs');

    await act(async () => {
      renderHook(() => useLaunchConfigs(31415, 'proj-B', 'chat-1'));
      // Flush all promises so the useEffect's Promise.all resolves.
      await Promise.resolve();
    });

    // Wait for the zustand store to reflect the reconcile result.
    await waitFor(() => {
      expect(allRunTabs().length).toBeGreaterThan(0);
    });

    const tabs = allRunTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.config).toBe('dev');
    expect(tabs[0]!.scopeKey).toBe('proj-B:/ws/b');
  });
});

describe('useLaunchConfigs — scope-aware reconcile regression', () => {
  it('adds a scope-B tab even when a same-named scope-A tab already exists (key regression)', async () => {
    // Seed the store with an EXISTING 'dev' tab for scope A BEFORE rendering.
    useLayoutStore.setState({
      ...CLEAN_LAYOUT,
      layout: { top: ['chat', 'run'] as ['chat', 'run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
      run: {
        dir: 'v',
        flex: [1, 1],
        panes: [
          {
            id: 'pane-seed',
            tabs: [
              {
                id: 'dev-A',
                kind: 'preview' as const,
                title: 'dev',
                config: 'dev',
                scopeKey: 'proj-A:/ws/a',
              },
            ],
            active: 'dev-A',
          },
        ],
      },
    });

    const { useLaunchConfigs } = await import('../use-launch-configs');

    await act(async () => {
      renderHook(() => useLaunchConfigs(31415, 'proj-B', 'chat-1'));
      await Promise.resolve();
    });

    // After reconcile, BOTH tabs must be present — scope-A was seeded,
    // scope-B must have been added. The old name-only tabbed guard skips
    // adding scope-B because 'dev' is already in `tabbed` → FAILS (RED).
    await waitFor(() => {
      const devTabs = allRunTabs().filter((t) => t.config === 'dev');
      expect(devTabs).toHaveLength(2);
    });

    const devTabs = allRunTabs().filter((t) => t.config === 'dev');
    const scopeATab = devTabs.find((t) => t.scopeKey === 'proj-A:/ws/a');
    const scopeBTab = devTabs.find((t) => t.scopeKey === 'proj-B:/ws/b');
    expect(scopeATab).toBeDefined();
    expect(scopeBTab).toBeDefined();
  });

  it('does NOT add a duplicate when the existing tab is already for the current scope', async () => {
    // Seed with a 'dev' tab that is ALREADY for scope B — reconcile must be a no-op.
    useLayoutStore.setState({
      ...CLEAN_LAYOUT,
      layout: { top: ['chat', 'run'] as ['chat', 'run'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
      run: {
        dir: 'v',
        flex: [1, 1],
        panes: [
          {
            id: 'pane-seed',
            tabs: [
              {
                id: 'dev-B-existing',
                kind: 'preview' as const,
                title: 'dev',
                config: 'dev',
                scopeKey: 'proj-B:/ws/b',
              },
            ],
            active: 'dev-B-existing',
          },
        ],
      },
    });

    const { useLaunchConfigs } = await import('../use-launch-configs');

    await act(async () => {
      renderHook(() => useLaunchConfigs(31415, 'proj-B', 'chat-1'));
      await Promise.resolve();
    });

    // Give any async reconcile enough time to settle.
    await waitFor(() => {
      // Confirm the fetch resolved (sandbox store should have the status).
      expect(useSandboxStore.getState().processStatuses['proj-B:/ws/b']?.['dev']).toBe('running');
    });

    // Still exactly one 'dev' tab for scope B — no duplicate appended.
    const devTabs = allRunTabs().filter((t) => t.config === 'dev' && t.scopeKey === 'proj-B:/ws/b');
    expect(devTabs).toHaveLength(1);
  });
});

describe('useLaunchConfigs — stale REST fetch does not clobber a fresher WS update', () => {
  it('keeps the WS-driven status when a slow REST fetch resolves after it with a stale value', async () => {
    // Regression: `run-surface.spec.ts`'s "Stop reverts the toolbar" — opening
    // the toolbar's launch popover triggers `refetch()` (a fresh GET
    // /launch/status). If a Stop click's WS `launch.status:'stopped'` event
    // lands while that REST request is still in flight, the request's `.then`
    // had no guard against being superseded: it would unconditionally
    // reapply its own (now-stale) 'running' snapshot over the correct
    // WS-driven 'stopped' value.
    let resolveStatuses!: (value: {
      statuses: Record<string, string>;
      tunnelUrls: Record<string, string>;
      effectivePath: string;
    }) => void;
    vi.mocked(fetchLaunchStatuses).mockReturnValue(
      new Promise((resolve) => {
        resolveStatuses = resolve;
      }),
    );

    const { useLaunchConfigs } = await import('../use-launch-configs');
    const scope = buildLaunchScope('proj-B', '/ws/b');

    act(() => {
      renderHook(() => useLaunchConfigs(31415, 'proj-B', 'chat-1'));
    });

    // A WS `launch.status` event lands while the REST fetch is still in
    // flight (mirrors what use-sandbox-ws-router.ts does on a live event).
    act(() => {
      useSandboxStore.getState().setProcessStatus(scope, 'dev', 'stopped');
    });

    // The REST fetch resolves with a STALE snapshot ('running') captured
    // before the stop happened.
    await act(async () => {
      resolveStatuses({ statuses: { dev: 'running' }, tunnelUrls: {}, effectivePath: '/ws/b' });
      await Promise.resolve();
    });

    expect(useSandboxStore.getState().processStatuses[scope]?.['dev']).toBe('stopped');
  });

  it('does not reconcile a run tab from a stale "running" snapshot once WS reports stopped', async () => {
    let resolveStatuses!: (value: {
      statuses: Record<string, string>;
      tunnelUrls: Record<string, string>;
      effectivePath: string;
    }) => void;
    vi.mocked(fetchLaunchStatuses).mockReturnValue(
      new Promise((resolve) => {
        resolveStatuses = resolve;
      }),
    );

    const { useLaunchConfigs } = await import('../use-launch-configs');
    const scope = buildLaunchScope('proj-B', '/ws/b');

    act(() => {
      renderHook(() => useLaunchConfigs(31415, 'proj-B', 'chat-1'));
    });

    act(() => {
      useSandboxStore.getState().setProcessStatus(scope, 'dev', 'stopped');
    });

    await act(async () => {
      resolveStatuses({ statuses: { dev: 'running' }, tunnelUrls: {}, effectivePath: '/ws/b' });
      await Promise.resolve();
    });

    expect(allRunTabs().filter((t) => t.config === 'dev')).toHaveLength(0);
  });
});

describe('useLaunchConfigs — tunnel URL seed', () => {
  it('seeds tunnelUrls from the status fetch into the sandbox store', async () => {
    vi.mocked(fetchLaunchStatuses).mockResolvedValue({
      statuses: { dev: 'running' },
      tunnelUrls: { dev: 'https://dev.trycloudflare.com' },
      effectivePath: '/ws/b',
    });

    const { useLaunchConfigs } = await import('../use-launch-configs');

    await act(async () => {
      renderHook(() => useLaunchConfigs(31415, 'proj-B', 'chat-1'));
      await Promise.resolve();
    });

    await waitFor(() => {
      const scope = buildLaunchScope('proj-B', '/ws/b');
      expect(useSandboxStore.getState().tunnelUrls[scope]?.['dev']).toBe('https://dev.trycloudflare.com');
    });
  });
});

describe('useLaunchConfigs — output buffer replay seed (echo-once fast-subprocess race)', () => {
  it('seeds buffered output into logsOutput when no live entries exist yet for that scope+name', async () => {
    // The daemon's `/launch/status` now returns recent stdout/stderr per
    // config (LaunchManager.getOutputBuffer) — a durable replay source for a
    // fast subprocess whose entire lifecycle (spawn → stdout → exit) may have
    // already finished by the time a console pane's live WS delivery is
    // observed. This seed only applies when nothing has appeared yet, so it
    // never duplicates output the live WS event already delivered.
    vi.mocked(fetchLaunchStatuses).mockResolvedValue({
      statuses: { dev: 'stopped' },
      tunnelUrls: {},
      effectivePath: '/ws/b',
      outputBuffer: { dev: [{ stream: 'stdout', data: 'hello-from-launch\n' }] },
    });

    const { useLaunchConfigs } = await import('../use-launch-configs');
    const scope = buildLaunchScope('proj-B', '/ws/b');

    await act(async () => {
      renderHook(() => useLaunchConfigs(31415, 'proj-B', 'chat-1'));
      await Promise.resolve();
    });

    await waitFor(() => {
      const entries = useSandboxStore.getState().logsOutput.filter((l) => l.scopeKey === scope && l.name === 'dev');
      expect(entries).toHaveLength(1);
    });
    const entries = useSandboxStore.getState().logsOutput.filter((l) => l.scopeKey === scope && l.name === 'dev');
    expect(entries[0]!.data).toBe('hello-from-launch\n');
    expect(entries[0]!.stream).toBe('stdout');
  });

  it('does not duplicate output already present in logsOutput for that scope+name', async () => {
    const scope = buildLaunchScope('proj-B', '/ws/b');
    useSandboxStore.setState({
      ...CLEAN_SANDBOX,
      logsOutput: [{ seq: 1, scopeKey: scope, name: 'dev', data: 'hello-from-launch\n', stream: 'stdout' as const }],
    });
    vi.mocked(fetchLaunchStatuses).mockResolvedValue({
      statuses: { dev: 'stopped' },
      tunnelUrls: {},
      effectivePath: '/ws/b',
      outputBuffer: { dev: [{ stream: 'stdout', data: 'hello-from-launch\n' }] },
    });

    const { useLaunchConfigs } = await import('../use-launch-configs');

    await act(async () => {
      renderHook(() => useLaunchConfigs(31415, 'proj-B', 'chat-1'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(useSandboxStore.getState().processStatuses[scope]?.['dev']).toBe('stopped');
    });
    const entries = useSandboxStore.getState().logsOutput.filter((l) => l.scopeKey === scope && l.name === 'dev');
    expect(entries).toHaveLength(1);
  });
});
