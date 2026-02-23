import type { PluginContext, PluginManifest, DaemonEvent } from '@mainframe/types';
import { createPluginDatabaseContext } from './db-context.js';
import { createPluginEventBus } from './event-bus.js';
import { createPluginConfig } from './config-context.js';
import { createPluginUIContext } from './ui-context.js';
import { buildChatService } from './services/chat-service.js';
import { buildProjectService } from './services/project-service.js';
import type { EventEmitter } from 'node:events';
import type { Router } from 'express';
import type { Logger } from 'pino';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';

function capabilityGuard(capability: string): never {
  throw new Error(`Plugin capability '${capability}' is required but not declared in manifest`);
}

export interface PluginContextDeps {
  manifest: PluginManifest;
  pluginDir: string;
  router: Router;
  logger: Logger;
  daemonBus: EventEmitter;
  db: DatabaseManager;
  adapters: AdapterRegistry;
  emitEvent: (event: DaemonEvent) => void;
  onUnloadCallbacks: (() => void)[];
}

export function buildPluginContext(deps: PluginContextDeps): PluginContext {
  const { manifest, pluginDir } = deps;
  const has = (cap: string) => manifest.capabilities.includes(cap as never);

  const dbContext = has('storage')
    ? createPluginDatabaseContext(`${pluginDir}/data.db`)
    : new Proxy({} as ReturnType<typeof createPluginDatabaseContext>, {
        get:
          () =>
          (..._args: unknown[]) =>
            capabilityGuard('storage'),
      });

  const eventBus = has('daemon:public-events')
    ? createPluginEventBus(manifest.id, deps.daemonBus)
    : new Proxy({} as ReturnType<typeof createPluginEventBus>, {
        get:
          () =>
          (..._args: unknown[]) =>
            capabilityGuard('daemon:public-events'),
      });

  const uiContext =
    has('ui:panels') || has('ui:notifications')
      ? createPluginUIContext(manifest.id, deps.emitEvent)
      : new Proxy({} as ReturnType<typeof createPluginUIContext>, {
          get:
            () =>
            (..._args: unknown[]) =>
              capabilityGuard('ui:panels or ui:notifications'),
        });

  const config = createPluginConfig(
    manifest.id,
    (key) => {
      const value = deps.db.settings.get('plugin', key);
      return value !== null ? (JSON.parse(value) as unknown) : undefined;
    },
    (key, value) => deps.db.settings.set('plugin', key, JSON.stringify(value)),
  );

  const chatService = buildChatService(manifest, deps.db);
  const projectService = buildProjectService(deps.db);

  const adaptersApi = has('adapters')
    ? { register: (adapter: Parameters<AdapterRegistry['register']>[0]) => deps.adapters.register(adapter) }
    : undefined;

  return {
    manifest,
    logger: deps.logger,
    router: deps.router,
    config,
    db: dbContext,
    events: eventBus,
    ui: uiContext,
    services: { chats: chatService, projects: projectService },
    adapters: adaptersApi,
    onUnload(fn) {
      deps.onUnloadCallbacks.push(fn);
    },
  };
}
