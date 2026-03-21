import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { stat } from 'node:fs/promises';
import { WebSocketServer, WebSocket } from 'ws';
import type { LspManager, LspServerHandle } from './lsp-manager.js';
import type { DatabaseManager } from '../db/index.js';
import { bridgeWsToProcess } from './lsp-proxy.js';
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

    // Single-client check
    const existingHandle = this.manager.getHandle(projectId, language);
    if (existingHandle?.client && existingHandle.client.readyState === WebSocket.OPEN) {
      log.warn({ projectId, language }, 'LSP upgrade rejected: client already connected');
      socket.write('HTTP/1.1 409 Conflict\r\n\r\n');
      socket.destroy();
      return;
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
    log.info({ projectId, language }, 'LSP WebSocket client connected');

    this.manager.cancelIdleTimer(handle);
    handle.client = ws;

    const proc = handle.process;
    if (!proc.stdin || !proc.stdout || !proc.stderr) {
      log.error({ projectId, language }, 'LSP process missing stdio streams');
      ws.close(1011, 'LSP process error');
      return;
    }

    const cleanup = bridgeWsToProcess(ws, proc.stdin, proc.stdout, proc.stderr);
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
}
