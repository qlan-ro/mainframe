import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { stat } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import type { LspManager, LspServerHandle } from './lsp-manager.js';
import type { DatabaseManager } from '../db/index.js';
import { bridgeWsToProcess, encodeJsonRpc } from './lsp-proxy.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('lsp-connection');

/** Parse /lsp/:projectId/:language from a URL path. Returns null if not an LSP path. */
export function parseLspUpgradePath(url: string): { projectId: string; language: string } | null {
  const pathname = url.split('?')[0] ?? '';
  const match = pathname.match(/^\/lsp\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { projectId: match[1]!, language: match[2]! };
}

export class LspConnectionHandler {
  private wss = new WebSocketServer({ noServer: true });

  constructor(
    private manager: LspManager,
    private db: DatabaseManager,
  ) {}

  async handleUpgrade(
    projectId: string,
    language: string,
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    // Validate project exists
    const project = this.db.projects.get(projectId);
    if (!project) {
      log.warn({ projectId, language }, 'LSP upgrade rejected: unknown project');
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Validate project path exists on disk (async — no sync I/O in server code)
    try {
      await stat(project.path);
    } catch (err) {
      log.warn({ err, projectId, path: project.path }, 'LSP upgrade rejected: project path not found');
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // Check if language server config exists
    const config = this.manager.registry.getConfig(language);
    if (!config) {
      log.warn({ language }, 'LSP upgrade rejected: unsupported language');
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // If there's an existing client, close it to allow the new connection.
    // Stale connections from renderer restarts / HMR can linger as OPEN.
    const existingHandle = this.manager.getHandle(projectId, language);
    if (existingHandle?.client && existingHandle.client.readyState === WebSocket.OPEN) {
      log.info({ projectId, language }, 'Closing stale LSP client for new connection');
      existingHandle.cleanup?.();
      existingHandle.client.close(1001, 'Replaced by new client');
      existingHandle.client = null;
      existingHandle.cleanup = null;
    }

    // Spawn or get existing LSP server
    let handle: LspServerHandle;
    try {
      handle = await this.manager.getOrSpawn(projectId, language, project.path);
    } catch (err) {
      log.error({ err, projectId, language }, 'Failed to spawn LSP server');
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    // Complete the WebSocket upgrade
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.onConnection(ws, handle, projectId, language);
    });
  }

  private onConnection(ws: WebSocket, handle: LspServerHandle, projectId: string, language: string): void {
    log.info({ projectId, language, reattach: !!handle.initializeResult }, 'LSP WebSocket client connected');

    this.manager.cancelIdleTimer(handle);
    handle.client = ws;

    const proc = handle.process;
    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      log.error({ projectId, language }, 'LSP process missing stdio streams');
      ws.close(1011, 'LSP process error');
      return;
    }

    // If the server is already initialized (reconnecting client), intercept the
    // initialize request and respond with the cached result. This avoids sending
    // initialize twice which violates the LSP protocol and confuses tsserver.
    if (handle.initializeResult) {
      const cachedResult = handle.initializeResult;
      const onFirstMessage = (data: string | Buffer) => {
        try {
          const msg = JSON.parse(typeof data === 'string' ? data : data.toString('utf-8'));
          if (msg.method === 'initialize' && msg.id != null) {
            log.info({ projectId, language }, 'Replaying cached initialize result for reconnecting client');
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: cachedResult }));
            return;
          }
          if (msg.method === 'initialized') {
            // Skip — server already received it. Start bridge for real messages.
            ws.removeListener('message', onFirstMessage);
            this.startBridge(ws, handle, projectId, language);
            return;
          }
        } catch {
          /* ignore parse errors */
        }
        // Unexpected message before init handshake — start bridge and forward it.
        ws.removeListener('message', onFirstMessage);
        this.startBridge(ws, handle, projectId, language);
        const json = typeof data === 'string' ? data : data.toString('utf-8');
        proc.stdin!.write(encodeJsonRpc(json));
      };
      ws.on('message', onFirstMessage);

      ws.on('close', () => {
        log.info({ projectId, language }, 'LSP WebSocket client disconnected');
        ws.removeListener('message', onFirstMessage);
        handle.client = null;
        handle.cleanup = null;
        const key = `${projectId}:${language}`;
        this.manager.startIdleTimer(key, handle);
      });

      ws.on('error', (err) => {
        log.error({ err, projectId, language }, 'LSP WebSocket error');
      });
      return;
    }

    // First connection — bridge directly and capture the initialize result.
    this.startBridgeWithInitCapture(ws, handle, projectId, language);
  }

  private startBridge(ws: WebSocket, handle: LspServerHandle, projectId: string, language: string): void {
    const proc = handle.process;
    const cleanup = bridgeWsToProcess(ws, proc.stdin!, proc.stdout!, proc.stderr!);
    handle.cleanup = cleanup;

    ws.on('close', () => {
      log.info({ projectId, language }, 'LSP WebSocket client disconnected');
      cleanup();
      handle.client = null;
      handle.cleanup = null;
      const key = `${projectId}:${language}`;
      this.manager.startIdleTimer(key, handle);
    });

    ws.on('error', (err) => {
      log.error({ err, projectId, language }, 'LSP WebSocket error');
    });
  }

  private startBridgeWithInitCapture(
    ws: WebSocket,
    handle: LspServerHandle,
    projectId: string,
    language: string,
  ): void {
    const proc = handle.process;

    // Wrap ws.send to capture the initialize response before it reaches the client.
    // Intercept outgoing messages to capture the initialize response.
    const origSend = ws.send.bind(ws) as typeof ws.send;
    let captured = false;
    (ws as any).send = (data: any, ...args: any[]) => {
      if (!captured && typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg.result?.capabilities) {
            handle.initializeResult = msg.result;
            captured = true;
            log.info({ projectId, language }, 'Cached LSP initialize result');
            (ws as any).send = origSend;
          }
        } catch {
          /* ignore */
        }
      }
      return origSend(data, ...args);
    };

    const cleanup = bridgeWsToProcess(ws, proc.stdin!, proc.stdout!, proc.stderr!);
    handle.cleanup = cleanup;

    ws.on('close', () => {
      log.info({ projectId, language }, 'LSP WebSocket client disconnected');
      cleanup();
      (ws as any).send = origSend;
      handle.client = null;
      handle.cleanup = null;
      const key = `${projectId}:${language}`;
      this.manager.startIdleTimer(key, handle);
    });

    ws.on('error', (err) => {
      log.error({ err, projectId, language }, 'LSP WebSocket error');
    });
  }
}
