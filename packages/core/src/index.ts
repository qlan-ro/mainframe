#!/usr/bin/env node
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ensureAuthSecret, getConfig, getDataDir } from './config.js';
import { DatabaseManager } from './db/index.js';
import { AdapterRegistry } from './adapters/index.js';
import { ChatManager } from './chat/index.js';
import { AttachmentStore } from './attachment/index.js';
import { createServerManager } from './server/index.js';
import { PluginManager } from './plugins/manager.js';
import { LaunchRegistry } from './launch/index.js';
import { TunnelManager } from './tunnel/index.js';
import claudeManifest from './plugins/builtin/claude/manifest.json' with { type: 'json' };
import { activate as activateClaude } from './plugins/builtin/claude/index.js';
import claudeSdkManifest from './plugins/builtin/claude-sdk/manifest.json' with { type: 'json' };
import { activate as activateClaudeSdk } from './plugins/builtin/claude-sdk/index.js';
import todosManifest from './plugins/builtin/todos/manifest.json' with { type: 'json' };
import { activate as activateTodos } from './plugins/builtin/todos/index.js';
import { logger } from './logger.js';
import type { DaemonEvent, PluginManifest } from '@qlan-ro/mainframe-types';
import { backfillWorktreeRelationships } from './workspace/worktree.js';

function enrichPath(): void {
  try {
    const shell = process.env['SHELL'] || '/bin/zsh';
    const result = execFileSync(shell, ['-lic', 'echo "$PATH"'], {
      encoding: 'utf-8',
      timeout: 5_000,
    }).trim();
    if (result) {
      process.env['PATH'] = result;
      logger.debug({ shell, pathLength: result.split(':').length }, 'enrichPath: resolved from login shell');
      return;
    }
  } catch (err) {
    logger.warn({ err }, 'enrichPath: login shell failed, using fallback');
  }
  const current = process.env['PATH'] ?? '/usr/bin:/bin:/usr/sbin:/sbin';
  const extra = [`${homedir()}/.local/bin`, '/usr/local/bin', '/opt/homebrew/bin'];
  const seen = new Set(current.split(':'));
  const additions = extra.filter((p) => !seen.has(p));
  if (additions.length) process.env['PATH'] = `${additions.join(':')}:${current}`;
  logger.debug(
    { additions, totalPaths: (process.env['PATH'] ?? '').split(':').length },
    'enrichPath: fallback applied',
  );
}

async function main(): Promise<void> {
  enrichPath();
  const config = getConfig();
  const authSecret = ensureAuthSecret();
  process.env['AUTH_TOKEN_SECRET'] = authSecret;
  logger.info('Auth secret loaded');

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
  const tunnelManager = new TunnelManager();
  const launchRegistry = new LaunchRegistry((event) => broadcastEvent(event), tunnelManager);

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
  await pluginManager.loadBuiltin(claudeSdkManifest as PluginManifest, activateClaudeSdk);

  const todosPluginDir = join(getDataDir(), 'plugins', 'todos');
  mkdirSync(todosPluginDir, { recursive: true });
  await pluginManager.loadBuiltin(todosManifest as PluginManifest, activateTodos, { pluginDir: todosPluginDir });

  // Load user-installed plugins from ~/.mainframe/plugins/
  await pluginManager.loadAll();

  let daemonTunnelUrl: string | null = null;

  const server = createServerManager(
    db,
    chats,
    adapters,
    attachmentStore,
    pluginManager,
    launchRegistry,
    () => daemonTunnelUrl,
    tunnelManager,
    config.port,
  );

  await server.start(config.port);
  broadcastEvent = (event) => server.broadcastEvent(event);

  // Non-blocking: backfill worktree parent relationships for existing projects.
  // Failure here must not prevent the daemon from serving requests.
  backfillWorktreeRelationships(db.projects).catch((err) => {
    logger.warn({ err }, 'Worktree relationship backfill failed');
  });

  if (config.tunnel === true) {
    try {
      const tunnelOpts = config.tunnelToken ? { token: config.tunnelToken, url: config.tunnelUrl } : undefined;
      daemonTunnelUrl = await tunnelManager.start(config.port, 'daemon', tunnelOpts);
      logger.info({ tunnelUrl: daemonTunnelUrl }, 'Daemon tunnel started');
      logger.warn('Daemon is publicly accessible via tunnel — do not share this URL in untrusted environments');
    } catch (err) {
      logger.error({ err }, 'Failed to start daemon tunnel — continuing without tunnel');
    }
  } else if (config.tunnelUrl) {
    daemonTunnelUrl = config.tunnelUrl;
    logger.info({ tunnelUrl: daemonTunnelUrl }, 'Using configured tunnel URL (no auto-start)');
  }

  logger.info('Daemon ready');

  const shutdown = async () => {
    logger.info('Shutting down...');
    await pluginManager.unloadAll();
    adapters.killAll();
    await launchRegistry.stopAll();
    tunnelManager.stopAll();
    await server.stop();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    adapters.killAll();
    launchRegistry.stopAll().finally(() => process.exit(1));
    // Hard deadline: exit even if stopAll hangs
    setTimeout(() => process.exit(1), 5_000).unref();
  });
}

const subcommand = process.argv[2];

if (subcommand === 'pair') {
  import('./cli/pair.js').then(({ runPair }) => runPair());
} else if (subcommand === 'status') {
  import('./cli/status.js').then(({ runStatus }) => runStatus());
} else {
  main().catch((error) => {
    logger.fatal({ err: error }, 'Fatal error');
    process.exit(1);
  });
}
