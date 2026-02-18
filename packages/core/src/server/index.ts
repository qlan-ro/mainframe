import { createServer } from 'node:http';
import type { Express } from 'express';
import { createHttpServer } from './http.js';
import { WebSocketManager } from './websocket.js';
import type { DatabaseManager } from '../db/index.js';
import type { ChatManager } from '../chat/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { AttachmentStore } from '../attachment/index.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('server');

export interface ServerManager {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
}

export function createServerManager(
  db: DatabaseManager,
  chats: ChatManager,
  adapters: AdapterRegistry,
  attachmentStore?: AttachmentStore,
): ServerManager {
  const app: Express = createHttpServer(db, chats, adapters, attachmentStore);
  const httpServer = createServer(app);
  let _wsManager: WebSocketManager | null = null;

  return {
    async start(port: number): Promise<void> {
      _wsManager = new WebSocketManager(httpServer, chats);

      return new Promise((resolve) => {
        httpServer.listen(port, '127.0.0.1', () => {
          log.info({ port }, 'Mainframe daemon listening on http://127.0.0.1:%d', port);
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      _wsManager?.close();
      return new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

export { createHttpServer } from './http.js';
export { WebSocketManager } from './websocket.js';
