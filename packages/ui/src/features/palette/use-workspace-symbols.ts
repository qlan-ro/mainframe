import { useEffect, useRef, useState } from 'react';
import { lspClientManager, initLspPort, getLspLanguage, type LspSymbol } from '@/lib/lsp';
import { useTabsStore } from '@/store/tabs';
import { useDebounce } from '@/features/files/use-file-search';

/** The active editor tab's LSP language, else 'typescript' (v1 default). */
export function pickSymbolLanguage(): string {
  const { tabs, activeTabId } = useTabsStore.getState();
  const active = tabs.find((t) => t.id === activeTabId);
  return (active ? getLspLanguage(active.path) : null) ?? 'typescript';
}

interface Args {
  port: number;
  projectId?: string;
  projectPath?: string;
  chatId?: string;
  term: string;
  enabled: boolean;
}

export function useWorkspaceSymbols({ port, projectId, projectPath, chatId, term, enabled }: Args): {
  symbols: LspSymbol[];
  loading: boolean;
} {
  const debounced = useDebounce(term, 250);
  const [symbols, setSymbols] = useState<LspSymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !projectId || debounced.trim().length < 1) {
      reqIdRef.current++;
      setSymbols([]);
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    const language = pickSymbolLanguage();
    setLoading(true);
    void (async () => {
      try {
        await initLspPort();
        if (!lspClientManager.hasClient(projectId, language)) {
          await lspClientManager.ensureClient(projectId, language, projectPath ?? '', chatId);
        }
        const result = await lspClientManager.getWorkspaceSymbols(projectId, language, debounced.trim());
        if (reqId === reqIdRef.current) setSymbols(result);
      } catch (err) {
        console.warn('[use-workspace-symbols] query failed', err);
        if (reqId === reqIdRef.current) setSymbols([]);
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    })();
  }, [enabled, port, projectId, projectPath, chatId, debounced]);

  return { symbols, loading };
}
