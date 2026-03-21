import { MonacoLanguageClient } from 'monaco-languageclient';
import { toSocket, WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc';

interface LspClientEntry {
  client: MonacoLanguageClient;
  webSocket: WebSocket;
}

function makeKey(projectId: string, language: string): string {
  return `${projectId}:${language}`;
}

function getDaemonWsUrl(): string {
  const env = (import.meta as { env?: Record<string, string> }).env ?? {};
  const host = env['VITE_DAEMON_HOST'] ?? '127.0.0.1';
  const port = env['VITE_DAEMON_WS_PORT'] ?? '31415';
  return `ws://${host}:${port}`;
}

/**
 * Manages MonacoLanguageClient instances, one per project+language pair.
 * Connects to the daemon's LSP proxy WebSocket endpoint.
 */
export class LspClientManager {
  private readonly clients = new Map<string, LspClientEntry>();

  /** Get an existing client, or null if none exists. */
  getClient(projectId: string, language: string): MonacoLanguageClient | null {
    return this.clients.get(makeKey(projectId, language))?.client ?? null;
  }

  /** Create and start an LSP client if one doesn't already exist. */
  async ensureClient(projectId: string, language: string, projectPath: string): Promise<void> {
    const key = makeKey(projectId, language);
    if (this.clients.has(key)) return;

    const wsUrl = `${getDaemonWsUrl()}/lsp/${projectId}/${language}`;
    const webSocket = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      webSocket.onopen = () => resolve();
      webSocket.onerror = (ev) => reject(new Error(`WebSocket error connecting to ${wsUrl}: ${String(ev)}`));
    });

    const socket = toSocket(webSocket);
    const reader = new WebSocketMessageReader(socket);
    const writer = new WebSocketMessageWriter(socket);

    const client = new MonacoLanguageClient({
      name: `${language}-lsp-${projectId}`,
      clientOptions: {
        documentSelector: [{ language }],
        workspaceFolder: {
          uri: `file://${projectPath}` as any,
          name: projectPath.split('/').pop() ?? projectPath,
          index: 0,
        },
      },
      messageTransports: { reader, writer },
    });

    this.clients.set(key, { client, webSocket });

    webSocket.onclose = () => {
      console.warn(`[lsp] WebSocket closed for ${key}`);
      this.removeEntry(key);
    };
    webSocket.onerror = (ev) => {
      console.warn(`[lsp] WebSocket error for ${key}:`, ev);
      this.removeEntry(key);
    };

    try {
      await client.start();
    } catch (err) {
      console.warn(`[lsp] Failed to start client for ${key}:`, err);
      this.removeEntry(key);
      throw err;
    }
  }

  /** Tear down the client for a given project+language. */
  disposeClient(projectId: string, language: string): void {
    this.removeEntry(makeKey(projectId, language));
  }

  /** Tear down all clients. */
  disposeAll(): void {
    for (const key of [...this.clients.keys()]) {
      this.removeEntry(key);
    }
  }

  private removeEntry(key: string): void {
    const entry = this.clients.get(key);
    if (!entry) return;
    this.clients.delete(key);
    try {
      entry.client.dispose().catch((err) => {
        console.warn(`[lsp] Error disposing client ${key}:`, err);
      });
    } catch {
      // client may already be disposed
    }
    try {
      if (entry.webSocket.readyState === WebSocket.OPEN) {
        entry.webSocket.close();
      }
    } catch {
      // socket may already be closed
    }
  }
}
