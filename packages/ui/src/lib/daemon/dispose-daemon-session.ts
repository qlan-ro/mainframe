import { daemonWs } from './ws-client';
import { chatControllerRegistry } from '../../features/sessions/runtime/chat-controller-registry';
import { killAndDisposeCachedTerminals } from '../../store/terminal-cleanup';
import { clearUrlTunnelConsumers } from '../../features/url-tab/tunnel-consumers';
import { useLayoutStore } from '../../store/layout';
import { tabIdsInRun } from '../../store/run-pane';
import { resetAdapters } from '../../store/adapters';
import { invalidateSeedFetches } from '../../store/adapters-seed';

/**
 * Bounded teardown of out-of-React singletons and live OS handles.
 * Called before a daemon switch (keyed remount) to drain all active state.
 *
 * Each teardown is wrapped in its own try/catch so a failure in one step
 * never prevents the remaining steps from running — the switch must proceed.
 */
export function disposeDaemonSession(): void {
  try {
    daemonWs.disconnect();
  } catch (err) {
    console.warn('[disposeDaemonSession] daemonWs.disconnect failed', err);
  }

  try {
    chatControllerRegistry.disposeAll();
  } catch (err) {
    console.warn('[disposeDaemonSession] chatControllerRegistry.disposeAll failed', err);
  }

  try {
    const { run } = useLayoutStore.getState();
    killAndDisposeCachedTerminals(tabIdsInRun(run, 'terminal'));
  } catch (err) {
    console.warn('[disposeDaemonSession] killAndDisposeCachedTerminals failed', err);
  }

  try {
    resetAdapters();
    invalidateSeedFetches();
  } catch (err) {
    console.warn('[disposeDaemonSession] adapters reset failed', err);
  }

  try {
    // Drop the registry only — never stop a tunnel here, or the stop would go
    // to the daemon we're leaving, not the one it actually runs on.
    clearUrlTunnelConsumers();
  } catch (err) {
    console.warn('[disposeDaemonSession] clearUrlTunnelConsumers failed', err);
  }
}
