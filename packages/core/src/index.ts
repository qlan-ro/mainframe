#!/usr/bin/env node
import { join } from 'node:path';
import { getConfig, getDataDir } from './config.js';
import { DatabaseManager } from './db/index.js';
import { AdapterRegistry, ClaudeAdapter } from './adapters/index.js';
import { ChatManager } from './chat/index.js';
import { AttachmentStore } from './attachment/index.js';
import { createServerManager } from './server/index.js';
import { logger } from './logger.js';

async function main(): Promise<void> {
  const config = getConfig();

  logger.info('Mainframe Core Daemon');
  logger.info({ dataDir: getDataDir() }, 'Data directory');
  logger.info({ port: config.port }, 'Starting daemon');

  const db = new DatabaseManager();
  const adapters = new AdapterRegistry();
  const attachmentStore = new AttachmentStore(join(getDataDir(), 'attachments'));
  const chats = new ChatManager(db, adapters, attachmentStore);
  const server = createServerManager(db, chats, adapters, attachmentStore);

  await server.start(config.port);

  logger.info('Daemon ready');

  const killAdapters = () => {
    const claude = adapters.get('claude') as ClaudeAdapter | undefined;
    claude?.killAll();
  };

  const shutdown = async () => {
    logger.info('Shutting down...');
    killAdapters();
    await server.stop();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    killAdapters();
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Fatal error');
  process.exit(1);
});
