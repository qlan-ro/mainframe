import { createServer } from 'node:http';
import type { Express } from 'express';
import { createHttpServer } from './http.js';
import { WebSocketManager } from './websocket.js';
import type { DatabaseManager } from '../db/index.js';
import type { ChatManager } from '../chat/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';
import type { PluginManager } from '../plugins/manager.js';
import type { LaunchRegistry } from '../launch/index.js';
import type { TunnelManager } from '../tunnel/tunnel-manager.js';
import type { DaemonEvent } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../logger.js';
import { LspRegistry, LspManager, LspConnectionHandler } from '../lsp/index.js';
import { FileWatcherService } from '../files/file-watcher.js';

const log = createChildLogger('server');

export interface ServerManager {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  broadcastEvent(event: DaemonEvent): void;
}

export function createServerManager(
  db: DatabaseManager,
  chats: ChatManager,
  adapters: AdapterRegistry,
  attachmentStore?: AttachmentStore,
  pluginManager?: PluginManager,
  launchRegistry?: LaunchRegistry,
  getTunnelUrl?: () => string | null,
  tunnelManager?: TunnelManager,
  port?: number,
): ServerManager {
  const lspRegistry = new LspRegistry();
  const lspManager = new LspManager(lspRegistry);
  const lspHandler = new LspConnectionHandler(lspManager, db);

  const { app, pushService } = createHttpServer(
    db,
    chats,
    adapters,
    attachmentStore,
    pluginManager,
    launchRegistry,
    getTunnelUrl,
    tunnelManager,
    port,
    lspManager,
  );
  chats.setPushService(pushService);
  const httpServer = createServer(app);
  let _wsManager: WebSocketManager | null = null;
  let _fileWatcher: FileWatcherService | null = null;

  return {
    async start(port: number): Promise<void> {
      _fileWatcher = new FileWatcherService((event) => _wsManager?.broadcastEvent(event));
      _wsManager = new WebSocketManager(httpServer, chats, lspHandler, _fileWatcher);

      return new Promise((resolve) => {
        httpServer.listen(port, '127.0.0.1', () => {
          log.info({ port }, 'Mainframe daemon listening on http://127.0.0.1:%d', port);
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      await lspManager.shutdownAll();
      _fileWatcher?.stopAll();
      _wsManager?.close();
      return new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },

    broadcastEvent(event: DaemonEvent): void {
      _wsManager?.broadcastEvent(event);
    },
  };
}

export { createHttpServer } from './http.js';
export { WebSocketManager } from './websocket.js';
