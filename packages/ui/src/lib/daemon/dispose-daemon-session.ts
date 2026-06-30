import { daemonWs } from './ws-client';
import { chatControllerRegistry } from '../../features/sessions/runtime/chat-controller-registry';
import { killAndDisposeCachedTerminals } from '../../store/terminal-cleanup';
import { useLayoutStore } from '../../store/layout';
import { terminalIdsInRun } from '../../store/run-pane';

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
    killAndDisposeCachedTerminals(terminalIdsInRun(run));
  } catch (err) {
    console.warn('[disposeDaemonSession] killAndDisposeCachedTerminals failed', err);
  }
}
