/**
 * useLspDocument — LSP lifecycle hook for EditorTab.
 *
 * Encapsulates:
 *  - lspReady state
 *  - ensure-client effect (with lspReady reset on identity change and
 *    initLspPort await before ensureClient to fix startup race)
 *  - ensure-document-open effect
 *  - extraExtensions useMemo (CM6 LSP extensions)
 */
import { useEffect, useMemo, useState } from 'react';
import { lspClientManager, getLspLanguage, initLspPort } from '@/lib/lsp';
import { createLspExtensions } from './lsp/cm-lsp-extensions';

interface UseLspDocumentParams {
  path: string;
  projectId: string | undefined;
  projectPath: string | undefined;
  chatId: string | undefined;
  loadedValue: string | null;
}

interface UseLspDocumentResult {
  lspReady: boolean;
  extraExtensions: ReturnType<typeof createLspExtensions> | undefined;
}

export function useLspDocument({
  path,
  projectId,
  projectPath,
  chatId,
  loadedValue,
}: UseLspDocumentParams): UseLspDocumentResult {
  const [lspReady, setLspReady] = useState(false);

  // Derive the LSP language from the file path. Null when not supported.
  const lspLanguage = projectId ? getLspLanguage(path) : null;

  // Ensure the LSP client is connected when a project is active and the file
  // has a supported language. Resets lspReady to false at the start of every
  // run so an identity change (new project/language) never inherits stale state.
  // Awaits initLspPort first so editor mounts are self-healing regardless of
  // App startup timing (initLspPort is idempotent).
  useEffect(() => {
    if (!projectId || !lspLanguage || !projectPath) return;

    // Reset before the async call — any render triggered mid-flight sees
    // the correct (false) value while the new client is connecting.
    setLspReady(false);

    // Already connected — mark ready immediately and skip ensureClient.
    if (lspClientManager.hasClient(projectId, lspLanguage)) {
      setLspReady(true);
      return;
    }

    let cancelled = false;
    void (async () => {
      // Self-heal: ensure the port singleton is initialised before we call
      // ensureClient. initLspPort is idempotent; subsequent calls are no-ops.
      await initLspPort();
      if (cancelled) return;
      lspClientManager
        .ensureClient(projectId, lspLanguage, projectPath, chatId)
        .then(() => {
          if (!cancelled) setLspReady(true);
        })
        .catch((err: unknown) => {
          console.warn('[useLspDocument] ensureClient failed', err);
        });
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, lspLanguage, projectPath, chatId]);

  // Open the document on the LSP server once the client is ready. Hover /
  // go-to-def return empty results until the server has seen a didOpen with
  // the file content. ensureDocumentOpen dedups per URI, so re-runs are no-ops.
  useEffect(() => {
    if (!lspReady || !projectId || !lspLanguage || loadedValue == null) return;
    lspClientManager.ensureDocumentOpen(projectId, lspLanguage, {
      filePath: path,
      languageId: lspLanguage,
      version: 1,
      text: loadedValue,
    });
  }, [lspReady, projectId, lspLanguage, path, loadedValue]);

  // Build LSP CM6 extensions when a project + supported language is present.
  const extraExtensions = useMemo(() => {
    if (!projectId || !lspLanguage) return undefined;
    return createLspExtensions(lspClientManager, {
      projectId,
      language: lspLanguage,
      filePath: path,
      lspReady,
    });
  }, [projectId, lspLanguage, path, lspReady]);

  return { lspReady, extraExtensions };
}
