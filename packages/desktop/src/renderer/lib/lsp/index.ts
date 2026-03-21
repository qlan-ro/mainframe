export { getLspLanguage, hasLspSupport } from './language-detection.js';
export { LspClientManager } from './lsp-client.js';

import { LspClientManager } from './lsp-client.js';

/** Singleton LSP client manager shared across the renderer. */
export const lspClientManager = new LspClientManager();
