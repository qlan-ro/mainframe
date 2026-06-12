/**
 * Auto-connects the LSP client when a file is opened in the editor surface.
 *
 * Phase 1 stub: the editor surface store (`store/editor.ts`) and project/session
 * stores that drive the subscription don't exist yet — they land in Phase 7.
 * This module exports `initAutoConnect` so Phase 7 can wire it; `index.ts`
 * calls it once on startup (guarded by the HMR flag) but it is a no-op until
 * the stores exist.
 *
 * Port of packages/desktop/src/renderer/lib/lsp/auto-connect.ts
 * Changes: desktop store imports removed; store wiring deferred to Phase 7.
 */
import { lspClientManager } from './index';
import { getLspLanguage } from './language-detection';

export type OpenFileEvent = {
  filePath: string;
  projectId: string;
  projectPath: string;
  chatId?: string;
};

/**
 * Subscribe to file-open events and ensure the appropriate LSP client is
 * connected and the document is pre-loaded.
 *
 * Phase 7 calls this with a `subscribe` function backed by `store/editor.ts`.
 * Returns an unsubscribe function.
 */
export function initAutoConnect(subscribe: (handler: (event: OpenFileEvent) => void) => () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const handler = (event: OpenFileEvent) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const lspLanguage = getLspLanguage(event.filePath);
      if (!lspLanguage) return;

      lspClientManager
        .ensureClient(event.projectId, lspLanguage, event.projectPath, event.chatId)
        .then(() => {
          lspClientManager.preloadDocument(event.projectId, lspLanguage, event.filePath);
        })
        .catch((err: unknown) => console.warn('[lsp] auto-connect ensureClient failed', err));
    }, 500);
  };

  return subscribe(handler);
}
