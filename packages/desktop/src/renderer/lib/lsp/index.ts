export { getLspLanguage, hasLspSupport } from './language-detection.js';
export { LspClientManager } from './lsp-client.js';

import { LspClientManager } from './lsp-client.js';

// Persist the singleton across HMR reloads to avoid reconnection cascades.
const win = window as unknown as { __lspClientManager?: LspClientManager; __lspAutoConnect?: boolean };

/** Singleton LSP client manager shared across the renderer. */
export const lspClientManager: LspClientManager = win.__lspClientManager ?? new LspClientManager();
win.__lspClientManager = lspClientManager;

// Auto-connect LSP clients when files are opened (once, not on every HMR).
if (!win.__lspAutoConnect) {
  win.__lspAutoConnect = true;
  import('./auto-connect.js').catch(() => {});
}
