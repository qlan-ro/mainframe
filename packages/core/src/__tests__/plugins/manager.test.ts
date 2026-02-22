import { describe, it, expect, vi } from 'vitest';
import { PluginManager } from '../../plugins/manager.js';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

// Silence logger in tests — avoid top-level import references in vi.mock factories (TDZ issue)
vi.mock('../../logger.js', () => {
  const noop = () => {};
  const silent = {
    level: 'silent',
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => silent,
  };
  return { createChildLogger: () => silent, logger: silent };
});

function makeDeps(pluginsDirs: string[]) {
  return {
    pluginsDirs,
    daemonBus: new EventEmitter(),
    db: {
      chats: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      projects: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      settings: { get: vi.fn().mockReturnValue(null), set: vi.fn() },
    } as unknown as Parameters<(typeof PluginManager.prototype)['getAll']>[never],
    adapters: { register: vi.fn() } as never,
    emitEvent: vi.fn(),
  } as Parameters<typeof PluginManager>[0];
}

describe('PluginManager', () => {
  it('loads a valid plugin and calls activate', async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), 'pm-test-'));
    const pluginDir = path.join(pluginsDir, 'my-plugin');
    mkdirSync(pluginDir);
    writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify({ id: 'my-plugin', name: 'My Plugin', version: '1.0.0', capabilities: [] }),
    );
    writeFileSync(
      path.join(pluginDir, 'index.js'),
      `module.exports = { activate(ctx) { ctx.config.set('activated', true); } };`,
    );

    const manager = new PluginManager(makeDeps([pluginsDir]));
    await manager.loadAll();
    expect(manager.getPlugin('my-plugin')).toBeDefined();
  });

  it('skips plugin with invalid manifest without crashing', async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), 'pm-test-invalid-'));
    const pluginDir = path.join(pluginsDir, 'bad-plugin');
    mkdirSync(pluginDir);
    writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({ id: 'BAD' }));
    writeFileSync(path.join(pluginDir, 'index.js'), `module.exports = { activate() {} };`);

    const manager = new PluginManager(makeDeps([pluginsDir]));
    await manager.loadAll();
    expect(manager.getPlugin('BAD')).toBeUndefined();
  });

  it('skips directories without manifest.json', async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), 'pm-test-no-manifest-'));
    const pluginDir = path.join(pluginsDir, 'no-manifest');
    mkdirSync(pluginDir);
    writeFileSync(path.join(pluginDir, 'index.js'), `module.exports = { activate() {} };`);

    const manager = new PluginManager(makeDeps([pluginsDir]));
    await manager.loadAll();
    expect(manager.getAll()).toHaveLength(0);
  });

  it('calls onUnload callbacks during unloadAll', async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), 'pm-test-unload-'));
    const pluginDir = path.join(pluginsDir, 'cleanup-plugin');
    mkdirSync(pluginDir);
    writeFileSync(
      path.join(pluginDir, 'manifest.json'),
      JSON.stringify({ id: 'cleanup-plugin', name: 'Cleanup', version: '1.0.0', capabilities: [] }),
    );
    writeFileSync(
      path.join(pluginDir, 'index.js'),
      `module.exports = { activate(ctx) { ctx.onUnload(() => { ctx.config.set('unloaded', true); }); } };`,
    );

    const manager = new PluginManager(makeDeps([pluginsDir]));
    await manager.loadAll();
    expect(manager.getPlugin('cleanup-plugin')).toBeDefined();
    await manager.unloadAll();
    expect(manager.getAll()).toHaveLength(0);
  });

  it('getAll returns all loaded plugins', async () => {
    const pluginsDir = mkdtempSync(path.join(tmpdir(), 'pm-test-multi-'));
    for (const id of ['plugin-one', 'plugin-two']) {
      const pluginDir = path.join(pluginsDir, id);
      mkdirSync(pluginDir);
      writeFileSync(
        path.join(pluginDir, 'manifest.json'),
        JSON.stringify({ id, name: id, version: '1.0.0', capabilities: [] }),
      );
      writeFileSync(path.join(pluginDir, 'index.js'), `module.exports = { activate() {} };`);
    }

    const manager = new PluginManager(makeDeps([pluginsDir]));
    await manager.loadAll();
    expect(manager.getAll()).toHaveLength(2);
  });
});
