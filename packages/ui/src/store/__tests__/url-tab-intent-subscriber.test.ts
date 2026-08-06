/**
 * subscribeToUrlTabIntents — the sanctioned bridge for the `open-url-tab`
 * surface intent (#281, AC4, AC13, AC16), plus the tunnel-release contract
 * that fires from the four store-level tab-removal sites (D10, AC12).
 *
 * Real `useLayoutStore`, `useActiveBasesStore`, and the real `tunnel-consumers`
 * ownership registry; only the daemon API is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const startPortTunnel = vi.fn();
const stopPortTunnel = vi.fn<(port: number, portNum: number) => Promise<void>>();
vi.mock('@/lib/api/tunnel-ports', () => ({
  startPortTunnel: (...a: unknown[]) => startPortTunnel(...a),
  stopPortTunnel: (...a: Parameters<typeof stopPortTunnel>) => stopPortTunnel(...a),
  listPortTunnels: vi.fn(),
}));

import { emitSurfaceIntent } from '../surface-intents';
import { useActiveBasesStore } from '../active-bases-store';
import { useLayoutStore } from '../layout';
import { subscribeToUrlTabIntents } from '../url-tab-intent-subscriber';
import { clearUrlTunnelConsumers, registerUrlTunnelConsumer } from '@/features/url-tab/tunnel-consumers';
import type { RunTab } from '../run-pane';

const FRESH_LAYOUT = { top: ['chat', 'workspace'] as const, bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } };

function resetLayout(): void {
  useLayoutStore.setState({
    layout: { ...FRESH_LAYOUT, top: [...FRESH_LAYOUT.top] },
    run: null,
    sessions: new Map(),
    activeSessionId: null,
  });
}

/** Seed Run directly with the given tabs, bypassing addRunTab (used for release scenarios). */
function seedRun(tabs: RunTab[]): void {
  useLayoutStore.setState({
    layout: { ...FRESH_LAYOUT, top: [...FRESH_LAYOUT.top] },
    run: { dir: 'v', flex: [1, 1], panes: [{ id: 'pane-1', active: tabs[0]!.id, tabs }] },
    sessions: new Map(),
    activeSessionId: null,
  });
}

beforeEach(() => {
  stopPortTunnel.mockReset();
  stopPortTunnel.mockResolvedValue(undefined);
  startPortTunnel.mockReset();
  clearUrlTunnelConsumers();
  useActiveBasesStore.setState({ bases: {}, scopeKey: null });
  resetLayout();
});

describe('subscribeToUrlTabIntents — creation', () => {
  it('creates one url tab whose id is a valid webview label and whose url is normalized', () => {
    const unsub = subscribeToUrlTabIntents();
    emitSurfaceIntent({ type: 'open-url-tab', url: 'http://localhost:5173/' });

    const run = useLayoutStore.getState().run!;
    expect(run.panes[0]!.tabs).toHaveLength(1);
    const tab = run.panes[0]!.tabs[0]!;
    expect(tab.id).toMatch(/^url-[A-Za-z0-9_-]+$/);
    expect(tab.url).toBe('http://localhost:5173/');
    unsub();
  });

  it('emitting the same URL twice yields one tab, active both times', () => {
    const unsub = subscribeToUrlTabIntents();
    emitSurfaceIntent({ type: 'open-url-tab', url: 'http://localhost:5173/' });
    const firstId = useLayoutStore.getState().run!.panes[0]!.tabs[0]!.id;

    emitSurfaceIntent({ type: 'open-url-tab', url: 'http://localhost:5173/' });
    const run = useLayoutStore.getState().run!;

    expect(run.panes[0]!.tabs.map((t) => t.id)).toEqual([firstId]);
    expect(run.panes[0]!.active).toBe(firstId);
    unsub();
  });

  it('a different active scope yields a second tab for the same URL', () => {
    const unsub = subscribeToUrlTabIntents();
    useActiveBasesStore.setState({ bases: {}, scopeKey: 'scope-a' });
    emitSurfaceIntent({ type: 'open-url-tab', url: 'http://localhost:5173/' });

    useActiveBasesStore.setState({ bases: {}, scopeKey: 'scope-b' });
    emitSurfaceIntent({ type: 'open-url-tab', url: 'http://localhost:5173/' });

    expect(useLayoutStore.getState().run!.panes[0]!.tabs).toHaveLength(2);
    unsub();
  });

  it('places Run in the layout even when it was not visible before', () => {
    useLayoutStore.setState({ layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } } });
    const unsub = subscribeToUrlTabIntents();

    emitSurfaceIntent({ type: 'open-url-tab', url: 'http://localhost:5173/' });

    const { layout } = useLayoutStore.getState();
    expect(layout.top.includes('workspace') || layout.bottom === 'workspace').toBe(true);
    unsub();
  });

  it('creates no tab for an unnormalizable URL', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unsub = subscribeToUrlTabIntents();

    emitSurfaceIntent({ type: 'open-url-tab', url: 'javascript:alert(1)' });

    expect(useLayoutStore.getState().run).toBeNull();
    warn.mockRestore();
    unsub();
  });

  it('the returned unsubscribe stops further intents from creating tabs', () => {
    const unsub = subscribeToUrlTabIntents();
    unsub();

    emitSurfaceIntent({ type: 'open-url-tab', url: 'http://localhost:5173/' });

    expect(useLayoutStore.getState().run).toBeNull();
  });
});

describe('URL tab tunnel release — the four store-level removal sites', () => {
  it('closeRunTab stops a tunnel this tab exclusively started', () => {
    seedRun([{ id: 'url-a', kind: 'url', title: 'a', url: 'http://localhost:5173/a' }]);
    registerUrlTunnelConsumer('url-a', { port: 5173, started: true, daemonHttpPort: 31415 });

    useLayoutStore.getState().closeRunTab('pane-1', 'url-a');

    expect(stopPortTunnel).toHaveBeenCalledTimes(1);
    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
  });

  it('closeRunTab does not stop a port still held by another tab', () => {
    seedRun([
      { id: 'url-a', kind: 'url', title: 'a', url: 'http://localhost:5173/a' },
      { id: 'url-b', kind: 'url', title: 'b', url: 'http://localhost:5173/b' },
    ]);
    registerUrlTunnelConsumer('url-a', { port: 5173, started: true, daemonHttpPort: 31415 });
    registerUrlTunnelConsumer('url-b', { port: 5173, started: false, daemonHttpPort: 31415 });

    useLayoutStore.getState().closeRunTab('pane-1', 'url-a');

    expect(stopPortTunnel).not.toHaveBeenCalled();
  });

  it('closeRunTab does not stop a tunnel this tab only adopted', () => {
    seedRun([{ id: 'url-a', kind: 'url', title: 'a', url: 'http://localhost:5173/a' }]);
    registerUrlTunnelConsumer('url-a', { port: 5173, started: false, daemonHttpPort: 31415 });

    useLayoutStore.getState().closeRunTab('pane-1', 'url-a');

    expect(stopPortTunnel).not.toHaveBeenCalled();
  });

  it('releaseRunScope stops an exclusively-started tunnel held by that scope', () => {
    seedRun([{ id: 'url-a', kind: 'url', title: 'a', url: 'http://localhost:5173/a', scopeKey: 'scope-a' }]);
    registerUrlTunnelConsumer('url-a', { port: 5173, started: true, daemonHttpPort: 31415 });

    useLayoutStore.getState().releaseRunScope('scope-a');

    expect(stopPortTunnel).toHaveBeenCalledTimes(1);
    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
  });

  it('closePane stops an exclusively-started tunnel held by that pane', () => {
    seedRun([{ id: 'url-a', kind: 'url', title: 'a', url: 'http://localhost:5173/a' }]);
    registerUrlTunnelConsumer('url-a', { port: 5173, started: true, daemonHttpPort: 31415 });

    useLayoutStore.getState().closePane('pane-1');

    expect(stopPortTunnel).toHaveBeenCalledTimes(1);
    expect(stopPortTunnel).toHaveBeenCalledWith(31415, 5173);
  });

  // Hiding the workspace is not closing it: the panes (and their tunnels) survive
  // so re-showing the surface returns the user's tabs. Only real closes release.
  it("toggleSurface('workspace') hides the surface without stopping the tunnel", () => {
    seedRun([{ id: 'url-a', kind: 'url', title: 'a', url: 'http://localhost:5173/a' }]);
    registerUrlTunnelConsumer('url-a', { port: 5173, started: true, daemonHttpPort: 31415 });

    useLayoutStore.getState().toggleSurface('workspace');

    expect(stopPortTunnel).not.toHaveBeenCalled();
    expect(useLayoutStore.getState().run?.panes[0]!.tabs.map((t) => t.id)).toEqual(['url-a']);
  });
});
