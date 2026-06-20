import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LspClientManager } from '../lsp-client';

/**
 * We exercise getWorkspaceSymbols by injecting a ready client entry directly
 * into the manager's private map and stubbing the WS send. This isolates the
 * request shape + SymbolInformation→LspSymbol mapping without a live socket.
 */
function makeReadyManager(sendImpl: (msg: any) => void) {
  const mgr = new LspClientManager(0);
  const entry = {
    ws: { send: (s: string) => sendImpl(JSON.parse(s)), readyState: 1, close: vi.fn() },
    resolvedBase: '/abs/project',
    chatId: undefined,
    requestId: 1,
    pending: new Map(),
    ready: true,
    openedUris: new Set<string>(),
  };
  // @ts-expect-error private access for test injection
  mgr.clients.set('proj:typescript', entry);
  return { mgr, entry };
}

describe('LspClientManager.getWorkspaceSymbols', () => {
  let sent: any;
  beforeEach(() => {
    sent = undefined;
  });

  it('returns [] when no ready client exists', async () => {
    const mgr = new LspClientManager(0);
    await expect(mgr.getWorkspaceSymbols('proj', 'typescript', 'Foo')).resolves.toEqual([]);
  });

  it('sends workspace/symbol and maps SymbolInformation to LspSymbol', async () => {
    const { mgr, entry } = makeReadyManager((msg) => {
      sent = msg;
      // Resolve the pending request with a SymbolInformation[] result.
      const handler = entry.pending.get(msg.id);
      handler.resolve([
        {
          name: 'useLayoutStore',
          kind: 12,
          location: {
            uri: 'file:///abs/project/src/store/layout.ts',
            range: { start: { line: 41, character: 6 }, end: { line: 41, character: 20 } },
          },
        },
      ]);
    });

    const result = await mgr.getWorkspaceSymbols('proj', 'typescript', 'useLayout');

    expect(sent.method).toBe('workspace/symbol');
    expect(sent.params).toEqual({ query: 'useLayout' });
    expect(result).toEqual([
      { name: 'useLayoutStore', kind: 12, path: 'src/store/layout.ts', line: 41 },
    ]);
  });
});
