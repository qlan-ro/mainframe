// packages/app-tauri/src/features/palette/__tests__/use-workspace-symbols.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const ensureClient = vi.fn().mockResolvedValue(undefined);
const hasClient = vi.fn().mockReturnValue(true);
const getWorkspaceSymbols = vi.fn();
vi.mock('@/lib/lsp', () => ({
  lspClientManager: {
    ensureClient: (...a: unknown[]) => ensureClient(...a),
    hasClient: (...a: unknown[]) => hasClient(...a),
    getWorkspaceSymbols: (...a: unknown[]) => getWorkspaceSymbols(...a),
  },
  initLspPort: () => Promise.resolve(),
  getLspLanguage: (p: string) => (p.endsWith('.ts') ? 'typescript' : null),
}));
vi.mock('@/store/tabs', () => ({
  useTabsStore: { getState: () => ({ tabs: [], activeTabId: null }) },
}));

const { useWorkspaceSymbols } = await import('../use-workspace-symbols');

describe('useWorkspaceSymbols', () => {
  beforeEach(() => {
    ensureClient.mockClear();
    getWorkspaceSymbols.mockClear();
  });

  it('returns [] and does not query when disabled', async () => {
    const { result } = renderHook(() =>
      useWorkspaceSymbols({ port: 1, projectId: 'p', projectPath: '/p', chatId: undefined, term: 'Foo', enabled: false }),
    );
    expect(result.current.symbols).toEqual([]);
    expect(getWorkspaceSymbols).not.toHaveBeenCalled();
  });

  it('queries workspace symbols when enabled with a term', async () => {
    getWorkspaceSymbols.mockResolvedValue([{ name: 'Foo', kind: 5, path: 'src/Foo.ts', line: 2 }]);
    const { result } = renderHook(() =>
      useWorkspaceSymbols({ port: 1, projectId: 'p', projectPath: '/p', chatId: undefined, term: 'Foo', enabled: true }),
    );
    await waitFor(() => expect(result.current.symbols).toHaveLength(1));
    expect(getWorkspaceSymbols).toHaveBeenCalledWith('p', 'typescript', 'Foo');
    expect(result.current.symbols[0]).toEqual({ name: 'Foo', kind: 5, path: 'src/Foo.ts', line: 2 });
  });
});
