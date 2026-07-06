import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

vi.mock('../ws-client', () => ({ daemonWs: { disconnect: vi.fn(), connect: vi.fn(), setPort: vi.fn() } }));
vi.mock('../../../features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { disposeAll: vi.fn() },
}));
vi.mock('../../../store/terminal-cleanup', () => ({ killAndDisposeCachedTerminals: vi.fn() }));
vi.mock('../../../store/layout', () => ({ useLayoutStore: { getState: vi.fn(() => ({ run: null })) } }));
vi.mock('../../../store/run-pane', () => ({ terminalIdsInRun: vi.fn(() => []) }));

// adapters/adapters-seed are exercised for real (not mocked) so the store-state
// and generation-guard assertions below pin actual behavior. Only their network
// dependency (getAdapters) is stubbed, mirroring store/__tests__/seed-generation.test.ts.
let adapterResolvers: Array<(v: AdapterInfo[]) => void> = [];
vi.mock('@/lib/api/adapters', () => ({
  getAdapters: vi.fn(() => new Promise<AdapterInfo[]>((r) => adapterResolvers.push(r))),
}));

import { daemonWs } from '../ws-client';
import { chatControllerRegistry } from '../../../features/sessions/runtime/chat-controller-registry';
import { killAndDisposeCachedTerminals } from '../../../store/terminal-cleanup';
import { disposeDaemonSession } from '../dispose-daemon-session';
import { useAdaptersStore, resetAdapters, seedAdapters } from '../../../store/adapters';
import { seedAdaptersFor } from '../../../store/adapters-seed';

const adapterInfo = (id: string): AdapterInfo => ({
  id,
  name: id,
  description: '',
  installed: true,
  models: [],
  modelsRevision: 1,
  catalogSource: 'fallback',
  capabilities: { planMode: true },
});

describe('disposeDaemonSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAdapters();
    adapterResolvers = [];
  });

  it('calls daemonWs.disconnect, chatControllerRegistry.disposeAll, and killAndDisposeCachedTerminals exactly once', () => {
    disposeDaemonSession();

    expect(daemonWs.disconnect).toHaveBeenCalledTimes(1);
    expect(chatControllerRegistry.disposeAll).toHaveBeenCalledTimes(1);
    expect(killAndDisposeCachedTerminals).toHaveBeenCalledTimes(1);
  });

  it('calls the three teardowns in order: daemonWs → chatControllerRegistry → killAndDisposeCachedTerminals', () => {
    const order: string[] = [];
    vi.mocked(daemonWs.disconnect).mockImplementation(() => {
      order.push('disconnect');
    });
    vi.mocked(chatControllerRegistry.disposeAll).mockImplementation(() => {
      order.push('disposeAll');
    });
    vi.mocked(killAndDisposeCachedTerminals).mockImplementation(() => {
      order.push('killAndDisposeCachedTerminals');
    });

    disposeDaemonSession();

    expect(order).toEqual(['disconnect', 'disposeAll', 'killAndDisposeCachedTerminals']);
  });

  it('does not throw when daemonWs.disconnect throws', () => {
    vi.mocked(daemonWs.disconnect).mockImplementation(() => {
      throw new Error('ws gone');
    });

    expect(() => disposeDaemonSession()).not.toThrow();
  });

  it('does not throw when chatControllerRegistry.disposeAll throws', () => {
    vi.mocked(chatControllerRegistry.disposeAll).mockImplementation(() => {
      throw new Error('registry gone');
    });

    expect(() => disposeDaemonSession()).not.toThrow();
  });

  it('does not throw when killAndDisposeCachedTerminals throws', () => {
    vi.mocked(killAndDisposeCachedTerminals).mockImplementation(() => {
      throw new Error('pty gone');
    });

    expect(() => disposeDaemonSession()).not.toThrow();
  });

  it('still calls subsequent teardowns when an earlier one throws', () => {
    vi.mocked(daemonWs.disconnect).mockImplementation(() => {
      throw new Error('ws gone');
    });

    disposeDaemonSession();

    expect(chatControllerRegistry.disposeAll).toHaveBeenCalledTimes(1);
    expect(killAndDisposeCachedTerminals).toHaveBeenCalledTimes(1);
  });

  it('hard-clears the adapters store on daemon switch', () => {
    seedAdapters([adapterInfo('claude')]);
    expect(Object.keys(useAdaptersStore.getState().byId)).toEqual(['claude']);

    disposeDaemonSession();

    expect(useAdaptersStore.getState().byId).toEqual({});
  });

  it('invalidates an in-flight seed fetch so its stale result never lands in the store', async () => {
    seedAdaptersFor(31415); // starts a seed fetch against the old daemon (gen N, in flight)

    disposeDaemonSession(); // daemon switch — must bump the seed generation

    // The pre-switch fetch resolves late, after the switch already happened.
    adapterResolvers[0]!([adapterInfo('claude')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(useAdaptersStore.getState().byId).toEqual({});
  });
});
