/**
 * LSP client singleton for app-tauri.
 *
 * Port of packages/app-electron/src/renderer/lib/lsp/index.ts
 * Changes:
 *   - Port comes from getHost().daemon.port() (host port), not env-var build-time
 *   - auto-connect import deferred to Phase 7 (initAutoConnect export)
 *   - Singleton persisted across HMR reloads to avoid reconnection cascades
 *   - A4: WS URL built from active daemon target; rebindLspToActiveDaemon exported
 */
export { getLspLanguage, hasLspSupport } from './language-detection';
export { LspClientManager } from './lsp-client';
export type { LspProviders, LspLocation, LspRange, LspPosition, LspHover, DocumentRef, LspSymbol } from './lsp-client';
export { initAutoConnect } from './auto-connect';

import { LspClientManager } from './lsp-client';
import { getHost } from '@/lib/host';
import { getActiveDaemon } from '../daemon/active-daemon';

// Extend the window type for HMR persistence only in this module.
type LspWindow = Window & {
  __lspClientManager?: LspClientManager;
  __lspPortInitPromise?: Promise<void>;
};

const win = window as unknown as LspWindow;

/**
 * Singleton LSP client manager shared across the renderer.
 * The manager is constructed with port=0 initially; `initLspPort` must be
 * called once (by App.tsx / DaemonPortProvider) before any LSP operations.
 */
export const lspClientManager: LspClientManager = win.__lspClientManager ?? new LspClientManager(0);

win.__lspClientManager = lspClientManager;

/**
 * Resolve the daemon port and hand it to the singleton manager.
 * Called once at app startup (after the host port resolves).
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initLspPort(): Promise<void> {
  // Cache the in-flight promise (not a boolean): concurrent callers must wait
  // for the port swap to complete, or the second caller proceeds on port 0.
  win.__lspPortInitPromise ??= (async () => {
    try {
      const port = await getHost().daemon.port();
      // Reinitialize the singleton with the real port (replaces the 0-port instance).
      const realManager = new LspClientManager(port);
      // Swap the singleton in place so all existing references see the new port.
      Object.assign(lspClientManager, realManager);
      win.__lspClientManager = lspClientManager;
    } catch (err) {
      console.warn('[lsp] initLspPort failed — LSP unavailable', err);
    }
  })();
  return win.__lspPortInitPromise;
}

/**
 * Dispose all active LSP clients and reinitialize the singleton against the
 * current active daemon target. Call this when the active target changes
 * (e.g. switching from local to remote). The WS URL for new connections is
 * always read from `getActiveDaemon()` at connect time (A4 seam), so this
 * primarily flushes stale open connections.
 *
 * `initLspPort()` (the local boot path) is unaffected and continues to work.
 */
export async function rebindLspToActiveDaemon(): Promise<void> {
  try {
    lspClientManager.disposeAll();
    const t = getActiveDaemon();
    // Extract the numeric port from the target URL for HTTP calls; remote
    // targets without an explicit port get 0 (HTTP seam handled by A2).
    const parsed = new URL(t.baseUrl);
    const port = parsed.port ? parseInt(parsed.port, 10) : 0;
    const freshManager = new LspClientManager(port);
    Object.assign(lspClientManager, freshManager);
    win.__lspClientManager = lspClientManager;
    // Reset the init-promise so initLspPort can be called again if needed.
    win.__lspPortInitPromise = undefined;
  } catch (err) {
    console.warn('[lsp] rebindLspToActiveDaemon failed', err);
  }
}
