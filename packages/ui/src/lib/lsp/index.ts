/**
 * LSP client singleton for app-tauri.
 *
 * Port of packages/desktop/src/renderer/lib/lsp/index.ts
 * Changes:
 *   - Port comes from getHost().daemon.port() (host port), not env-var build-time
 *   - auto-connect import deferred to Phase 7 (initAutoConnect export)
 *   - Singleton persisted across HMR reloads to avoid reconnection cascades
 */
export { getLspLanguage, hasLspSupport } from './language-detection';
export { LspClientManager } from './lsp-client';
export type { LspProviders, LspLocation, LspRange, LspPosition, LspHover, DocumentRef, LspSymbol } from './lsp-client';
export { initAutoConnect } from './auto-connect';

import { LspClientManager } from './lsp-client';
import { getHost } from '@/lib/host';

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
