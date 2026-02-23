/**
 * End-to-end integration test for the plugin system.
 * Tests the full lifecycle: discovery → activation → route serving → cleanup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { pino } from 'pino';
import express from 'express';
import request from 'supertest';
import { PluginManager } from '../../plugins/manager.js';

vi.mock('../../logger.js', () => ({
  createChildLogger: () => pino({ level: 'silent' }),
  logger: pino({ level: 'silent' }),
}));

function makeDeps(pluginsDirs: string[], emitEvent = vi.fn()) {
  return {
    pluginsDirs,
    daemonBus: new EventEmitter(),
    db: {
      chats: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      projects: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      settings: { get: vi.fn().mockReturnValue(null), set: vi.fn() },
    } as unknown as Parameters<typeof PluginManager>[0]['db'],
    adapters: { register: vi.fn() } as never,
    emitEvent,
  } as Parameters<typeof PluginManager>[0];
}

function makePluginDir(pluginsDir: string, id: string, capabilities: string[], indexJs: string) {
  const pluginDir = path.join(pluginsDir, id);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    path.join(pluginDir, 'manifest.json'),
    JSON.stringify({ id, name: id, version: '1.0.0', capabilities }),
  );
  writeFileSync(path.join(pluginDir, 'index.js'), indexJs);
  return pluginDir;
}

describe('Plugin System — integration', () => {
  let pluginsDir: string;

  beforeEach(() => {
    pluginsDir = mkdtempSync(path.join(tmpdir(), 'plugin-integration-'));
  });

  it('mounts listing routes on the manager router', async () => {
    makePluginDir(pluginsDir, 'list-test', [], `module.exports = { activate() {} };`);

    const manager = new PluginManager(makeDeps([pluginsDir]));
    await manager.loadAll();

    const app = express();
    app.use('/api/plugins', manager.router);

    const res = await request(app).get('/api/plugins');
    expect(res.status).toBe(200);
    expect(res.body.plugins).toHaveLength(1);
    expect(res.body.plugins[0].id).toBe('list-test');
  });

  it('mounts plugin-specific sub-routes under /:id', async () => {
    const indexJs = `
      module.exports = {
        activate(ctx) {
          ctx.router.get('/status', (_req, res) => res.json({ ok: true }));
        }
      };
    `;
    makePluginDir(pluginsDir, 'route-plugin', [], indexJs);

    const manager = new PluginManager(makeDeps([pluginsDir]));
    await manager.loadAll();

    const app = express();
    app.use('/api/plugins', manager.router);

    const res = await request(app).get('/api/plugins/route-plugin/status');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('provides isolated DB storage when storage capability is declared', async () => {
    const indexJs = `
      module.exports = {
        activate(ctx) {
          ctx.db.runMigration('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
          ctx.db.prepare('INSERT OR REPLACE INTO kv VALUES (?, ?)').run('hello', 'world');
        }
      };
    `;
    makePluginDir(pluginsDir, 'storage-plugin', ['storage'], indexJs);

    const manager = new PluginManager(makeDeps([pluginsDir]));
    await manager.loadAll();

    // Plugin should have loaded successfully
    expect(manager.getPlugin('storage-plugin')).toBeDefined();
  });

  it('blocks DB access without storage capability', async () => {
    let caughtError: string | undefined;
    const indexJs = `
      module.exports = {
        activate(ctx) {
          try {
            ctx.db.prepare('SELECT 1');
          } catch (e) {
            ctx.config.set('error', e.message);
          }
        }
      };
    `;
    makePluginDir(pluginsDir, 'no-storage-plugin', [], indexJs);

    const mockDb = {
      chats: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      projects: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      settings: {
        get: vi.fn().mockReturnValue(null),
        // db.settings.set(category, key, value) — capture value (3rd arg)
        set: (_cat: string, _key: string, value: string) => {
          caughtError = value;
        },
      },
    };
    const deps = {
      pluginsDirs: [pluginsDir],
      daemonBus: new EventEmitter(),
      db: mockDb as never,
      adapters: { register: vi.fn() } as never,
      emitEvent: vi.fn(),
    };

    const manager = new PluginManager(deps);
    await manager.loadAll();

    // error message is JSON-stringified, so we check for substring
    expect(caughtError).toMatch(/storage/);
  });

  it('emits plugin.panel.registered event when ui:panels plugin calls addPanel', async () => {
    const emitEvent = vi.fn();
    const indexJs = `
      module.exports = {
        activate(ctx) {
          ctx.ui.addPanel({
            zone: 'sidebar-left',
            label: 'My Panel',
          });
        }
      };
    `;
    makePluginDir(pluginsDir, 'ui-plugin', ['ui:panels'], indexJs);

    const manager = new PluginManager(makeDeps([pluginsDir], emitEvent));
    await manager.loadAll();

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'plugin.panel.registered',
        pluginId: 'ui-plugin',
        zone: 'sidebar-left',
        label: 'My Panel',
      }),
    );
  });

  it('calls all onUnload callbacks when unloadAll is called', async () => {
    const cleanupLog: string[] = [];
    const indexJs = `
      module.exports = {
        activate(ctx) {
          ctx.onUnload(() => { ctx.config.set('step1', 'done'); });
          ctx.onUnload(() => { ctx.config.set('step2', 'done'); });
        }
      };
    `;
    makePluginDir(pluginsDir, 'cleanup-plugin', [], indexJs);

    const mockDb = {
      chats: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      projects: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      settings: {
        get: vi.fn().mockReturnValue(null),
        // db.settings.set(category, key, value) — capture value (3rd arg)
        set: (_cat: string, _key: string, value: string) => {
          cleanupLog.push(value);
        },
      },
    };
    const deps = {
      pluginsDirs: [pluginsDir],
      daemonBus: new EventEmitter(),
      db: mockDb as never,
      adapters: { register: vi.fn() } as never,
      emitEvent: vi.fn(),
    };

    const manager = new PluginManager(deps);
    await manager.loadAll();
    expect(manager.getPlugin('cleanup-plugin')).toBeDefined();

    await manager.unloadAll();
    expect(manager.getAll()).toHaveLength(0);
    // JSON.stringify('done') = '"done"' — context.ts stringifies config values
    expect(cleanupLog).toContain('"done"');
  });

  it('loadBuiltin bypasses file system and registers directly', async () => {
    const emitEvent = vi.fn();
    const manager = new PluginManager(makeDeps([], emitEvent));

    const builtinManifest = {
      id: 'test-builtin',
      name: 'Test Builtin',
      version: '1.0.0',
      capabilities: [] as never[],
    };
    let activated = false;
    await manager.loadBuiltin(builtinManifest, (_ctx) => {
      activated = true;
    });

    expect(activated).toBe(true);
    expect(manager.getPlugin('test-builtin')).toBeDefined();
  });

  it('GET /api/plugins/:id returns 404 for unknown plugin', async () => {
    const manager = new PluginManager(makeDeps([]));
    await manager.loadAll();

    const app = express();
    app.use('/api/plugins', manager.router);

    const res = await request(app).get('/api/plugins/does-not-exist');
    expect(res.status).toBe(404);
  });
});
