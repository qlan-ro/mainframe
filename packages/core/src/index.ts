#!/usr/bin/env node
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { getConfig, getDataDir } from './config.js';
import { DatabaseManager } from './db/index.js';
import { AdapterRegistry } from './adapters/index.js';
import { ChatManager } from './chat/index.js';
import { AttachmentStore } from './attachment/index.js';
import { createServerManager } from './server/index.js';
import { PluginManager } from './plugins/manager.js';
import { LaunchRegistry } from './launch/index.js';
import claudeManifest from './plugins/builtin/claude/manifest.json' with { type: 'json' };
import { activate as activateClaude } from './plugins/builtin/claude/index.js';
import todosManifest from './plugins/builtin/todos/manifest.json' with { type: 'json' };
import { activate as activateTodos } from './plugins/builtin/todos/index.js';
import { logger } from './logger.js';
import type { DaemonEvent, PluginManifest } from '@mainframe/types';

async function main(): Promise<void> {
  const config = getConfig();

  logger.info('Mainframe Core Daemon');
  logger.info({ dataDir: getDataDir() }, 'Data directory');
  logger.info({ port: config.port }, 'Starting daemon');

  const db = new DatabaseManager();
  const adapters = new AdapterRegistry();
  const attachmentStore = new AttachmentStore(join(getDataDir(), 'attachments'));

  // Late-bound broadcast: set after server starts. Events emitted before
  // server.start() (plugin loading) are safely dropped — no WS clients yet.
  let broadcastEvent: (event: DaemonEvent) => void = () => {};
  const chats = new ChatManager(db, adapters, attachmentStore, (event) => broadcastEvent(event));
  const launchRegistry = new LaunchRegistry((event) => broadcastEvent(event));

  // PluginManager owns its own Express Router; no circular dep on the Express app
  const daemonBus = new EventEmitter();
  const emitEvent = (event: DaemonEvent) => broadcastEvent(event);

  const pluginManager = new PluginManager({
    pluginsDirs: [join(homedir(), '.mainframe', 'plugins')],
    daemonBus,
    db,
    adapters,
    emitEvent,
  });

  // Load builtin plugins first (always trusted, no consent dialog)
  await pluginManager.loadBuiltin(claudeManifest as PluginManifest, activateClaude);

  const todosPluginDir = join(getDataDir(), 'plugins', 'todos');
  mkdirSync(todosPluginDir, { recursive: true });
  await pluginManager.loadBuiltin(todosManifest as PluginManifest, activateTodos, { pluginDir: todosPluginDir });

  // Load user-installed plugins from ~/.mainframe/plugins/
  await pluginManager.loadAll();

  const server = createServerManager(db, chats, adapters, attachmentStore, pluginManager, launchRegistry);

  await server.start(config.port);
  broadcastEvent = (event) => server.broadcastEvent(event);

  logger.info('Daemon ready');

  const shutdown = async () => {
    logger.info('Shutting down...');
    await pluginManager.unloadAll();
    adapters.killAll();
    launchRegistry.stopAll();
    await server.stop();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    adapters.killAll();
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Fatal error');
  process.exit(1);
});
