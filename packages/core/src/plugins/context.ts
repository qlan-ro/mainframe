import type { PluginContext, PluginManifest, DaemonEvent } from '@qlan-ro/mainframe-types';
import { createPluginDatabaseContext } from './db-context.js';
import { createPluginAttachmentContext } from './attachment-context.js';
import { createPluginEventBus } from './event-bus.js';
import { createPluginConfig } from './config-context.js';
import { createPluginUIContext } from './ui-context.js';
import { readNotificationConfig } from '../notifications/notification-config.js';
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

/**
 * Return the real subsystem when its capability is declared, otherwise a guard
 * Proxy whose every method throws `capabilityGuard(capLabel)`. Centralizes the
 * gating boilerplate that each gated subsystem (db, attachments, events, ui)
 * would otherwise repeat verbatim.
 */
function gated<T extends object>(enabled: boolean, capLabel: string, build: () => T): T {
  if (enabled) return build();
  return new Proxy({} as T, {
    get:
      () =>
      (..._args: unknown[]) =>
        capabilityGuard(capLabel),
  });
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

  const dbContext = gated(has('storage'), 'storage', () => createPluginDatabaseContext(`${pluginDir}/data.db`));

  const attachmentContext = gated(has('storage'), 'storage', () =>
    createPluginAttachmentContext(`${pluginDir}/attachments`),
  );

  const eventBus = gated(has('daemon:public-events'), 'daemon:public-events', () =>
    createPluginEventBus(manifest.id, deps.daemonBus),
  );

  const uiContext = gated(has('ui:panels') || has('ui:notifications'), 'ui:panels or ui:notifications', () =>
    createPluginUIContext(manifest.id, deps.emitEvent, {
      isPluginNotifyEnabled: () => readNotificationConfig(deps.db).other.plugin,
    }),
  );

  const config = createPluginConfig(
    manifest.id,
    (key) => {
      const value = deps.db.settings.get('plugin', key);
      return value !== null ? (JSON.parse(value) as unknown) : undefined;
    },
    (key, value) => deps.db.settings.set('plugin', key, JSON.stringify(value)),
  );

  const chatService = buildChatService(manifest, deps.db, deps.emitEvent);
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
    attachments: attachmentContext,
    events: eventBus,
    ui: uiContext,
    services: { chats: chatService, projects: projectService },
    adapters: adaptersApi,
    onUnload(fn) {
      deps.onUnloadCallbacks.push(fn);
    },
  };
}
