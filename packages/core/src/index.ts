#!/usr/bin/env node
import './cli/early-flags.js'; // MUST be first — answers `--version` before the logger/daemon graph loads
import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ensureAuthSecret, getConfig, getDataDir } from './config.js';
import { DatabaseManager } from './db/index.js';
import { BackgroundTaskTracker } from './background-tasks/tracker.js';
import { reconcileBackgroundTasks } from './background-tasks/reconcile.js';
import { startLivenessScheduler } from './background-tasks/liveness.js';
import { AdapterRegistry } from './adapters/index.js';
import { backfillAdapterExecutables, defaultRun, resolveAdapterExecutable } from './adapters/resolve-executable.js';
import { ChatManager } from './chat/index.js';
import { AttachmentStore } from './attachment/index.js';
import { createServerManager } from './server/index.js';
import { PluginManager } from './plugins/manager.js';
import { LaunchRegistry } from './launch/index.js';
import { TunnelManager, resolveCloudflaredPath } from './tunnel/index.js';
import { FileChildRegistry, sweepStrayChildren } from './process/index.js';
import claudeManifest from './plugins/builtin/claude/manifest.json' with { type: 'json' };
import { activate as activateClaude } from './plugins/builtin/claude/index.js';
import codexManifest from './plugins/builtin/codex/manifest.json' with { type: 'json' };
import { activate as activateCodex } from './plugins/builtin/codex/index.js';
import todosManifest from './plugins/builtin/todos/manifest.json' with { type: 'json' };
import { activate as activateTodos } from './plugins/builtin/todos/index.js';
import { logger } from './logger.js';
import { wrapClaudeForRecording } from './testing/record-wrapper.js';
import type { DaemonEvent, PluginManifest } from '@qlan-ro/mainframe-types';
import { backfillWorktreeRelationships } from './workspace/worktree.js';
import { WorkflowService } from './workflows/index.js';
import { makeChatManagerPort } from './workflows/agent-port.js';
import { AutomationService } from './automations/service.js';
import { makeAutomationChatPort } from './automations/agent-port.js';

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
  const backgroundTasks = new BackgroundTaskTracker();
  const adapters = new AdapterRegistry();
  const attachmentStore = new AttachmentStore(join(getDataDir(), 'attachments'));

  // Late-bound broadcast: set after server starts. Events emitted before
  // server.start() (plugin loading) are safely dropped — no WS clients yet.
  let broadcastEvent: (event: DaemonEvent) => void = () => {};
  const chats = new ChatManager(db, adapters, backgroundTasks, attachmentStore, (event) => broadcastEvent(event));
  // No in-memory CLI sessions survive a restart, so reset any persisted
  // processState:'working' (orphaned by the previous shutdown/crash) to 'idle' —
  // otherwise those chats look "running" and new messages queue forever.
  chats.recoverStaleWorkingState();
  // One pidfile registry, shared by the tunnel and launch managers (a `kind`
  // field distinguishes their records), so a single startup sweep can reap every
  // child a crashed daemon leaked.
  const childRegistry = new FileChildRegistry(join(getDataDir(), 'managed-children.json'));
  const cloudflaredPath = (await resolveCloudflaredPath()) ?? undefined;
  const tunnelManager = new TunnelManager((event) => broadcastEvent(event), {
    registry: childRegistry,
    cloudflaredPath,
  });
  const launchRegistry = new LaunchRegistry((event) => broadcastEvent(event), tunnelManager, childRegistry);

  // Forward tracker emissions through the late-bound broadcastEvent closure.
  // The closure captures broadcastEvent by reference, so by the time tracker
  // events fire from live CLI sessions, the var will point to server.broadcastEvent.
  backgroundTasks.on('background_task.started', (chatId, task) => {
    broadcastEvent({ type: 'background_task.started', chatId, task });
  });
  backgroundTasks.on('background_task.updated', (chatId, task) => {
    broadcastEvent({ type: 'background_task.updated', chatId, task });
  });
  backgroundTasks.on('background_task.ended', (chatId, task) => {
    broadcastEvent({ type: 'background_task.ended', chatId, task });
  });

  chats.setStopLaunchProcesses(async (projectId, projectPath) => {
    const manager = launchRegistry.get(projectId, projectPath);
    if (manager) await manager.stopAll();
  });

  const workflows = new WorkflowService({
    dataDir: getDataDir(),
    logger,
    emitEvent: (event) => broadcastEvent(event),
    agentPort: makeChatManagerPort(chats, () => db.projects.list()[0]?.id ?? null),
    listProjects: () => db.projects.list().map((p) => ({ id: p.id, path: p.path })),
  });

  const automations = new AutomationService({
    dataDir: getDataDir(),
    logger,
    emitEvent: (event) => broadcastEvent(event),
    agentPort: makeAutomationChatPort(chats, () => db.projects.list()[0]?.id ?? null),
    listProjects: () => db.projects.list().map((p) => ({ id: p.id, path: p.path })),
  });

  // PluginManager owns its own Express Router; no circular dep on the Express app
  const daemonBus = new EventEmitter();
  const emitEvent = (event: DaemonEvent) => broadcastEvent(event);

  const pluginManager = new PluginManager({
    pluginsDirs: [join(getDataDir(), 'plugins')],
    daemonBus,
    db,
    adapters,
    emitEvent,
  });

  // Load builtin plugins first (always trusted, no consent dialog)
  await pluginManager.loadBuiltin(claudeManifest as PluginManifest, (ctx) => activateClaude(ctx, backgroundTasks));
  await pluginManager.loadBuiltin(codexManifest as PluginManifest, activateCodex);

  const todosPluginDir = join(getDataDir(), 'plugins', 'todos');
  mkdirSync(todosPluginDir, { recursive: true });
  await pluginManager.loadBuiltin(todosManifest as PluginManifest, activateTodos, { pluginDir: todosPluginDir });

  // Load user-installed plugins from ~/.mainframe/plugins/
  await pluginManager.loadAll();

  if (process.env['E2E_MODE'] === 'record') {
    wrapClaudeForRecording(adapters);
  }

  // Static, spawn-free seed so GET /api/adapters serves instantly and never blocks on a CLI.
  // MUST stay static — CodexAdapter.listModels() spawns a 30s-timeout app-server (see codex/adapter.ts).
  adapters.seedStaticSnapshots();

  // Configure the refresh BEFORE server.start() so no request can trigger an unconfigured probe.
  // emitEvent late-binds through the broadcastEvent closure (set after server.start()).
  adapters.configureRefresh({
    resolveExecutablePath: async (adapterId) => {
      const resolved = await resolveAdapterExecutable(adapterId, { settings: db.settings, run: defaultRun });
      return resolved.valid ? resolved.path : undefined;
    },
    run: defaultRun,
    emitEvent: (event) => broadcastEvent(event),
  });

  let daemonTunnelUrl: string | null = null;

  const server = createServerManager({
    db,
    chats,
    adapters,
    attachmentStore,
    pluginManager,
    launchRegistry,
    getTunnelUrl: () => daemonTunnelUrl,
    tunnelManager,
    port: config.port,
    backgroundTasks,
    workflows,
  });

  const livenessScheduler = startLivenessScheduler({ tracker: backgroundTasks });

  await server.start(config.port);

  // Reap tunnel AND launch children a previous daemon crash/kill orphaned,
  // pruning their records. This MUST run after the port bind: the bind is the
  // daemon's only single-instance guard, so a duplicate launch against the same
  // data dir fails with EADDRINUSE above instead of sweeping the live daemon's
  // children. It still precedes every tunnel spawn (daemon tunnel below; preview
  // and launch children are user-triggered).
  await sweepStrayChildren(childRegistry).catch((err) => logger.warn({ err }, 'Stray child process sweep failed'));

  // Bind the real WS broadcast AND feed daemon events to the workflow engine.
  // All event sources (chats, launchRegistry, tunnelManager, backgroundTasks,
  // pluginManager) use the broadcastEvent closure by reference, so every event
  // is forwarded here after server.start().
  broadcastEvent = (event) => {
    server.broadcastEvent(event);
    workflows.onDaemonEvent(event);
    automations.onDaemonEvent(event);
  };

  await workflows.start().catch((err) => {
    logger.error({ err }, 'WorkflowService failed to start — continuing without workflows');
  });

  await automations.start().catch((err) => {
    logger.error({ err }, 'AutomationService failed to start — continuing without automations');
  });

  reconcileBackgroundTasks({ tracker: backgroundTasks, db }).catch((err) => {
    logger.warn({ err }, 'Background task reconciliation failed');
  });

  // Non-blocking: backfill worktree parent relationships for existing projects.
  // Failure here must not prevent the daemon from serving requests.
  backfillWorktreeRelationships(db.projects).catch((err) => {
    logger.warn({ err }, 'Worktree relationship backfill failed');
  });

  // Resolve + persist absolute CLI paths BEFORE any live refresh so the probe/enrichment
  // spawn the real executable (not a bare name that ENOENTs under a packaged-app PATH).
  await backfillAdapterExecutables(
    adapters.getAll().map((a) => a.id),
    { settings: db.settings, run: defaultRun },
  ).catch((err) => {
    logger.warn({ err }, 'Adapter executable backfill failed');
  });

  // Only now may the refresh run. allowRefresh() is the gate that makes a pre-backfill
  // probe impossible; refreshAll() enriches installed/version/models per adapter and emits.
  adapters.allowRefresh();
  adapters.refreshAll().catch((err) => {
    logger.warn({ err }, 'Adapter catalog refresh failed');
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
    workflows.stop();
    automations.stop();
    chats.dispose();
    await pluginManager.unloadAll();
    adapters.killAll();
    await launchRegistry.stopAll();
    tunnelManager.stopAll();
    livenessScheduler.stop();
    await server.stop();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    adapters.killAll();
    // Kill tracked cloudflared children too, or they orphan and re-parent to PID 1.
    tunnelManager.stopAll();
    launchRegistry.stopAll().finally(() => process.exit(1));
    // Hard deadline: exit even if stopAll hangs
    setTimeout(() => process.exit(1), 5_000).unref();
  });
}

const subcommand = process.argv[2];

// `--version`/`version` is handled earlier by ./cli/early-flags.js.
if (subcommand === 'pair') {
  import('./cli/pair.js').then(({ runPair }) => runPair());
} else if (subcommand === 'status') {
  import('./cli/status.js').then(({ runStatus }) => runStatus());
} else if (subcommand === 'update') {
  import('./cli/update.js').then(({ runUpdate }) =>
    runUpdate().catch((error) => {
      console.error(`  Update failed: ${(error as Error).message}`);
      process.exit(1);
    }),
  );
} else {
  main().catch((error) => {
    logger.fatal({ err: error }, 'Fatal error');
    // Give the async pino transport a beat to flush — exiting immediately can
    // drop the fatal line, leaving a silent death in the log (how the stale-
    // daemon EADDRINUSE crash went unnoticed).
    setTimeout(() => process.exit(1), 200);
  });
}
