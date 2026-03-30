import { readdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Router } from 'express';
import type { EventEmitter } from 'node:events';
import type { PluginContext, PluginManifest, PluginModule, DaemonEvent } from '@qlan-ro/mainframe-types';
import { normalizeManifestUI } from '@qlan-ro/mainframe-types';
import { validateManifest } from './security/manifest-validator.js';
import { buildPluginContext } from './context.js';
import type { DatabaseManager } from '../db/index.js';
import type { AdapterRegistry } from '../adapters/index.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('plugin:manager');

interface LoadedPlugin {
  id: string;
  ctx: PluginContext;
  unloadCallbacks: (() => void)[];
}

export interface PluginManagerDeps {
  pluginsDirs: string[];
  daemonBus: EventEmitter;
  db: DatabaseManager;
  adapters: AdapterRegistry;
  emitEvent: (event: DaemonEvent) => void;
}

type PanelRegisteredEvent = Extract<DaemonEvent, { type: 'plugin.panel.registered' }>;
type ActionRegisteredEvent = Extract<DaemonEvent, { type: 'plugin.action.registered' }>;

export class PluginManager {
  /** Parent router mounted at /api/plugins by the HTTP server. */
  readonly router: Router;

  private loaded = new Map<string, LoadedPlugin>();
  private panelEvents = new Map<string, PanelRegisteredEvent[]>();
  private actionEvents = new Map<string, ActionRegisteredEvent[]>();
  // In CJS bundles (esbuild daemon), import.meta.url becomes undefined — cast to handle both.
  // Absolute plugin paths don't rely on the base URL for resolution.
  private _require = createRequire((import.meta.url as string | undefined) ?? `file://${process.cwd()}/index.js`);

  constructor(private deps: PluginManagerDeps) {
    this.router = Router();
    this.setupListingRoutes();
  }

  private setupListingRoutes(): void {
    this.router.get('/', (_req, res) => {
      const plugins = this.getAll().map((p) => {
        const panels = this.panelEvents.get(p.id) ?? [];
        const actions = this.actionEvents.get(p.id) ?? [];
        return {
          id: p.id,
          name: p.ctx.manifest.name,
          version: p.ctx.manifest.version,
          capabilities: p.ctx.manifest.capabilities,
          panels: panels.map((e) => ({
            panelId: e.panelId,
            zone: e.zone,
            label: e.label,
            icon: e.icon,
          })),
          // Legacy single-panel field for backwards compat with older desktop builds
          panel: panels[0] ? { zone: panels[0].zone, label: panels[0].label, icon: panels[0].icon } : undefined,
          actions: actions.map((a) => ({
            id: a.actionId,
            pluginId: a.pluginId,
            label: a.label,
            shortcut: a.shortcut,
            icon: a.icon,
          })),
        };
      });
      res.json({ plugins });
    });

    this.router.get('/:id', (req, res) => {
      const plugin = this.getPlugin(req.params['id'] ?? '');
      if (!plugin) {
        res.status(404).json({ error: 'Plugin not found' });
        return;
      }
      res.json({
        id: plugin.id,
        name: plugin.ctx.manifest.name,
        version: plugin.ctx.manifest.version,
        description: plugin.ctx.manifest.description,
        capabilities: plugin.ctx.manifest.capabilities,
      });
    });
  }

  private trackingEmitEvent(pluginId: string, emit: (event: DaemonEvent) => void): (event: DaemonEvent) => void {
    return (event: DaemonEvent) => {
      if (event.type === 'plugin.panel.registered') {
        const existing = this.panelEvents.get(pluginId) ?? [];
        // Replace if same panelId already tracked, otherwise append
        const filtered = existing.filter((e) => e.panelId !== event.panelId);
        filtered.push(event as PanelRegisteredEvent);
        this.panelEvents.set(pluginId, filtered);
      } else if (event.type === 'plugin.panel.unregistered') {
        if (event.panelId) {
          const existing = this.panelEvents.get(pluginId);
          if (existing) {
            const filtered = existing.filter((e) => e.panelId !== event.panelId);
            if (filtered.length > 0) {
              this.panelEvents.set(pluginId, filtered);
            } else {
              this.panelEvents.delete(pluginId);
            }
          }
        } else {
          this.panelEvents.delete(pluginId);
        }
      } else if (event.type === 'plugin.action.registered') {
        const existing = this.actionEvents.get(pluginId) ?? [];
        existing.push(event as ActionRegisteredEvent);
        this.actionEvents.set(pluginId, existing);
      } else if (event.type === 'plugin.action.unregistered') {
        const existing = this.actionEvents.get(pluginId);
        if (existing) {
          const filtered = existing.filter((e) => e.actionId !== event.actionId);
          if (filtered.length > 0) {
            this.actionEvents.set(pluginId, filtered);
          } else {
            this.actionEvents.delete(pluginId);
          }
        }
      }
      emit(event);
    };
  }

  /** Returns panel registration events for all currently loaded plugins that called addPanel(). */
  getRegisteredPanelEvents(): PanelRegisteredEvent[] {
    return [...this.panelEvents.values()].flat();
  }

  getRegisteredActionEvents(): ActionRegisteredEvent[] {
    return [...this.actionEvents.values()].flat();
  }

  /**
   * Load a builtin plugin directly from TypeScript (bypasses file-system manifest reading).
   * Builtins are always trusted and skip the consent flow.
   */
  async loadBuiltin(
    manifest: PluginManifest,
    activate: (ctx: PluginContext) => void | Promise<void>,
    options?: { pluginDir?: string },
  ): Promise<void> {
    if (this.loaded.has(manifest.id)) return;

    const unloadCallbacks: (() => void)[] = [];
    const pluginRouter = Router();
    this.router.use(`/${manifest.id}`, pluginRouter);

    const ctx = buildPluginContext({
      manifest,
      pluginDir: options?.pluginDir ?? '',
      router: pluginRouter,
      logger: createChildLogger(`plugin:${manifest.id}`),
      daemonBus: this.deps.daemonBus,
      db: this.deps.db,
      adapters: this.deps.adapters,
      emitEvent: this.trackingEmitEvent(manifest.id, this.deps.emitEvent),
      onUnloadCallbacks: unloadCallbacks,
    });

    await activate(ctx);
    this.loaded.set(manifest.id, { id: manifest.id, ctx, unloadCallbacks });
    log.info({ id: manifest.id, name: manifest.name }, 'Builtin plugin loaded');
  }

  async loadAll(): Promise<void> {
    for (const dir of this.deps.pluginsDirs) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        await this.loadPlugin(path.join(dir, entry.name)).catch((err) => {
          log.warn({ err, name: entry.name }, 'Plugin load failed — skipping');
        });
      }
    }
  }

  private async loadPlugin(pluginDir: string): Promise<void> {
    const manifestPath = path.join(pluginDir, 'manifest.json');
    if (!existsSync(manifestPath)) return;

    const rawManifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
    const validation = validateManifest(rawManifest);
    if (!validation.success) {
      log.warn({ pluginDir, error: validation.error }, 'Invalid plugin manifest — skipping');
      return;
    }
    const { manifest } = validation;

    if (this.loaded.has(manifest.id)) {
      log.warn({ id: manifest.id }, 'Duplicate plugin id — skipping');
      return;
    }

    const unloadCallbacks: (() => void)[] = [];
    // Each plugin gets its own sub-router under the manager's parent router
    const pluginRouter = Router();
    this.router.use(`/${manifest.id}`, pluginRouter);

    const ctx = buildPluginContext({
      manifest,
      pluginDir,
      router: pluginRouter,
      logger: createChildLogger(`plugin:${manifest.id}`),
      daemonBus: this.deps.daemonBus,
      db: this.deps.db,
      adapters: this.deps.adapters,
      emitEvent: this.trackingEmitEvent(manifest.id, this.deps.emitEvent),
      onUnloadCallbacks: unloadCallbacks,
    });

    const entryPath = path.join(pluginDir, 'index.js');
    if (!existsSync(entryPath)) {
      log.warn({ id: manifest.id }, 'Plugin has no index.js — skipping activation');
      return;
    }

    const mod = this._require(entryPath) as PluginModule;
    await mod.activate(ctx);

    this.loaded.set(manifest.id, { id: manifest.id, ctx, unloadCallbacks });
    log.info({ id: manifest.id, name: manifest.name }, 'Plugin loaded');
  }

  async unloadAll(): Promise<void> {
    for (const plugin of this.loaded.values()) {
      for (const fn of plugin.unloadCallbacks) {
        try {
          fn();
        } catch (err) {
          log.warn({ err, id: plugin.id }, 'onUnload error');
        }
      }
    }
    this.loaded.clear();
    this.panelEvents.clear();
    this.actionEvents.clear();
  }

  getPlugin(id: string): LoadedPlugin | undefined {
    return this.loaded.get(id);
  }

  getAll(): LoadedPlugin[] {
    return [...this.loaded.values()];
  }
}
