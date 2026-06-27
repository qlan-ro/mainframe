/**
 * routeLaunchEvent — behavior tests for the pure sandbox WS event router.
 *
 * Tests the pure `routeLaunchEvent` function with injected store deps (vi.fn()),
 * so no React or real Zustand is needed.
 *
 * Behaviors covered:
 *  - launch.output → appendLog with the built scope key
 *  - launch.status → setProcessStatus with the built scope key
 *  - launch.tunnel → appendLog (log-only, no navigation)
 *  - launch.tunnel.failed → appendLog (log-only)
 *  - launch.port.timeout → appendLog (log-only)
 *  - Non-launch events → no-op (neither store method called)
 */
import { it, expect, vi, describe } from 'vitest';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import type { SandboxRouterStore } from '../use-sandbox-ws-router';
import { routeLaunchEvent } from '../use-sandbox-ws-router';

function makeStore(): SandboxRouterStore {
  return {
    appendLog: vi.fn<(scopeKey: string, name: string, data: string, stream: 'stdout' | 'stderr') => void>(),
    setProcessStatus: vi.fn<(scopeKey: string, name: string, status: LaunchProcessStatus) => void>(),
    releaseRunScope: vi.fn<(scopeKey: string) => void>(),
  };
}

// ---------------------------------------------------------------------------
// launch.output
// ---------------------------------------------------------------------------

describe('launch.output', () => {
  it('routes to appendLog with a built scope key', () => {
    const store = makeStore();
    const event: DaemonEvent = {
      type: 'launch.output',
      projectId: 'p',
      effectivePath: '/r',
      name: 'dev',
      data: 'hi',
      stream: 'stdout',
    };
    routeLaunchEvent(event, store);
    expect(store.appendLog).toHaveBeenCalledOnce();
    expect(store.appendLog).toHaveBeenCalledWith('p:/r', 'dev', 'hi', 'stdout');
    expect(store.setProcessStatus).not.toHaveBeenCalled();
  });

  it('passes stderr stream through unchanged', () => {
    const store = makeStore();
    routeLaunchEvent(
      { type: 'launch.output', projectId: 'p', effectivePath: '/r', name: 'api', data: 'err', stream: 'stderr' },
      store,
    );
    expect(store.appendLog).toHaveBeenCalledWith('p:/r', 'api', 'err', 'stderr');
  });
});

// ---------------------------------------------------------------------------
// launch.status
// ---------------------------------------------------------------------------

describe('launch.status', () => {
  it('routes to setProcessStatus with the built scope key', () => {
    const store = makeStore();
    const event: DaemonEvent = {
      type: 'launch.status',
      projectId: 'p',
      effectivePath: '/r',
      name: 'dev',
      status: 'running',
    };
    routeLaunchEvent(event, store);
    expect(store.setProcessStatus).toHaveBeenCalledOnce();
    expect(store.setProcessStatus).toHaveBeenCalledWith('p:/r', 'dev', 'running');
    expect(store.appendLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// launch.tunnel / launch.tunnel.failed / launch.port.timeout — log-only
// ---------------------------------------------------------------------------

describe('launch.tunnel', () => {
  it('appends a log entry and does not call setProcessStatus', () => {
    const store = makeStore();
    routeLaunchEvent(
      { type: 'launch.tunnel', projectId: 'p', effectivePath: '/r', name: 'dev', url: 'https://xyz.tunnel.io' },
      store,
    );
    expect(store.appendLog).toHaveBeenCalledOnce();
    expect(store.setProcessStatus).not.toHaveBeenCalled();
  });
});

describe('launch.tunnel.failed', () => {
  it('appends a log entry', () => {
    const store = makeStore();
    routeLaunchEvent(
      { type: 'launch.tunnel.failed', projectId: 'p', effectivePath: '/r', name: 'dev', error: 'timeout' },
      store,
    );
    expect(store.appendLog).toHaveBeenCalledOnce();
    expect(store.setProcessStatus).not.toHaveBeenCalled();
  });
});

describe('launch.port.timeout', () => {
  it('appends a log entry', () => {
    const store = makeStore();
    routeLaunchEvent(
      { type: 'launch.port.timeout', projectId: 'p', effectivePath: '/r', name: 'dev', port: 3000 },
      store,
    );
    expect(store.appendLog).toHaveBeenCalledOnce();
    expect(store.setProcessStatus).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// launch.scopeReleased
// ---------------------------------------------------------------------------

describe('launch.scopeReleased', () => {
  it('routes to releaseRunScope with the built scope key', () => {
    const store = makeStore();
    routeLaunchEvent({ type: 'launch.scopeReleased', projectId: 'p', effectivePath: '/r' }, store);
    expect(store.releaseRunScope).toHaveBeenCalledWith('p:/r');
    expect(store.appendLog).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Non-launch events → no-op
// ---------------------------------------------------------------------------

describe('non-launch events', () => {
  it('ignores message.added without calling either store method', () => {
    const store = makeStore();
    routeLaunchEvent({ type: 'message.added' } as never, store);
    expect(store.appendLog).not.toHaveBeenCalled();
    expect(store.setProcessStatus).not.toHaveBeenCalled();
  });

  it('ignores chat.updated without calling either store method', () => {
    const store = makeStore();
    routeLaunchEvent({ type: 'chat.updated' } as never, store);
    expect(store.appendLog).not.toHaveBeenCalled();
    expect(store.setProcessStatus).not.toHaveBeenCalled();
  });
});
