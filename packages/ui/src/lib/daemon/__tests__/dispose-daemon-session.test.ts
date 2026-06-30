import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ws-client', () => ({ daemonWs: { disconnect: vi.fn(), connect: vi.fn(), setPort: vi.fn() } }));
vi.mock('../../../features/sessions/runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { disposeAll: vi.fn() },
}));
vi.mock('../../../store/terminal-cleanup', () => ({ killAndDisposeCachedTerminals: vi.fn() }));
vi.mock('../../../store/layout', () => ({ useLayoutStore: { getState: vi.fn(() => ({ run: null })) } }));
vi.mock('../../../store/run-pane', () => ({ terminalIdsInRun: vi.fn(() => []) }));

import { daemonWs } from '../ws-client';
import { chatControllerRegistry } from '../../../features/sessions/runtime/chat-controller-registry';
import { killAndDisposeCachedTerminals } from '../../../store/terminal-cleanup';
import { disposeDaemonSession } from '../dispose-daemon-session';

describe('disposeDaemonSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
