/**
 * useSandboxWsRouter — wires daemon WS launch events into the sandbox store.
 *
 * Launch events are NOT chat-scoped: they route through the global
 * `daemonWs.onEvent()` singleton (every handler sees every event), NOT through
 * the per-chat handle-daemon-event.ts handler.
 *
 * The pure `routeLaunchEvent` function is exported so it can be tested without
 * React. The hook subscribes once at the root (AppShell RuntimeBody) and tears
 * down on unmount.
 *
 * Event routing:
 *   launch.output         → appendLog(scope, name, data, stream)
 *   launch.status         → setProcessStatus(scope, name, status); clears tunnel on stop/failed
 *   launch.tunnel         → appendLog + setTunnelUrl(scope, name, url)
 *   launch.tunnel.failed  → appendLog + setTunnelError(scope, name, error)
 *   launch.port.timeout   → appendLog (log-only)
 *   launch.scopeReleased  → releaseRunScope(scopeKey) — prune Run tabs/PTYs
 *   everything else       → no-op
 */
import { useEffect } from 'react';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import type { LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { daemonWs } from '../../lib/daemon/ws-client';
import { useSandboxStore } from '../../store/sandbox';
import { buildLaunchScope } from '../../lib/launch-scope';
import { useLayoutStore } from '../../store/layout';

/** Minimal store interface required by the router (testable without Zustand). */
export interface SandboxRouterStore {
  appendLog: (scopeKey: string, name: string, data: string, stream: 'stdout' | 'stderr') => void;
  setProcessStatus: (scopeKey: string, name: string, status: LaunchProcessStatus) => void;
  releaseRunScope: (scopeKey: string) => void;
  setTunnelUrl: (scopeKey: string, name: string, url: string) => void;
  setTunnelError: (scopeKey: string, name: string, error: string) => void;
  clearTunnel: (scopeKey: string, name: string) => void;
}

/** Pure event dispatcher — dependency-injected so it is testable without React. */
export function routeLaunchEvent(event: DaemonEvent, store: SandboxRouterStore): void {
  switch (event.type) {
    case 'launch.output': {
      const scope = buildLaunchScope(event.projectId, event.effectivePath);
      store.appendLog(scope, event.name, event.data, event.stream);
      return;
    }
    case 'launch.status': {
      const scope = buildLaunchScope(event.projectId, event.effectivePath);
      store.setProcessStatus(scope, event.name, event.status);
      // Tunnel dies with the process — clear its URL/error so the next run starts clean.
      if (event.status !== 'running' && event.status !== 'starting') {
        store.clearTunnel(scope, event.name);
      }
      return;
    }
    case 'launch.tunnel': {
      const scope = buildLaunchScope(event.projectId, event.effectivePath);
      store.appendLog(scope, event.name, `[tunnel] ${event.url}`, 'stdout');
      store.setTunnelUrl(scope, event.name, event.url);
      return;
    }
    case 'launch.tunnel.failed': {
      const scope = buildLaunchScope(event.projectId, event.effectivePath);
      store.appendLog(scope, event.name, `[tunnel.failed] ${event.error}`, 'stderr');
      store.setTunnelError(scope, event.name, event.error);
      return;
    }
    case 'launch.port.timeout': {
      const scope = buildLaunchScope(event.projectId, event.effectivePath);
      store.appendLog(scope, event.name, `[port.timeout] port ${event.port}`, 'stderr');
      return;
    }
    case 'launch.scopeReleased': {
      store.releaseRunScope(buildLaunchScope(event.projectId, event.effectivePath));
      return;
    }
    default:
      return;
  }
}

/** Mount once at the app root (RuntimeBody in AppShell.tsx). */
export function useSandboxWsRouter(): void {
  useEffect(() => {
    const store: SandboxRouterStore = {
      appendLog: (...args) => useSandboxStore.getState().appendLog(...args),
      setProcessStatus: (...args) => useSandboxStore.getState().setProcessStatus(...args),
      releaseRunScope: (scopeKey) => useLayoutStore.getState().releaseRunScope(scopeKey),
      setTunnelUrl: (...args) => useSandboxStore.getState().setTunnelUrl(...args),
      setTunnelError: (...args) => useSandboxStore.getState().setTunnelError(...args),
      clearTunnel: (...args) => useSandboxStore.getState().clearTunnel(...args),
    };

    const unsubscribe = daemonWs.onEvent((event) => {
      routeLaunchEvent(event, store);
    });

    return unsubscribe;
  }, []);
}
