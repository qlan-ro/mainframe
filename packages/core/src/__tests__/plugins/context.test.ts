import { describe, it, expect, vi } from 'vitest';
import { buildPluginContext, type PluginContextDeps } from '../../plugins/context.js';
import { EventEmitter } from 'node:events';
import { Router } from 'express';
import { pino } from 'pino';
import type { PluginManifest } from '@mainframe/types';

const baseManifest: PluginManifest = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  capabilities: [],
};

function makeDeps(overrides?: Partial<PluginContextDeps>): PluginContextDeps {
  return {
    manifest: baseManifest,
    pluginDir: '/tmp/test-plugin',
    router: Router(),
    logger: pino({ level: 'silent' }),
    daemonBus: new EventEmitter(),
    db: {
      chats: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      projects: { list: vi.fn().mockReturnValue([]), get: vi.fn().mockReturnValue(null) },
      settings: { get: vi.fn().mockReturnValue(null), set: vi.fn() },
    } as unknown as PluginContextDeps['db'],
    adapters: {
      register: vi.fn(),
    } as unknown as PluginContextDeps['adapters'],
    emitEvent: vi.fn(),
    onUnloadCallbacks: [],
    ...overrides,
  };
}

describe('buildPluginContext capability gating', () => {
  it('throws on db access when storage not declared', () => {
    const ctx = buildPluginContext(makeDeps({ manifest: { ...baseManifest, capabilities: [] } }));
    expect(() => ctx.db.prepare('SELECT 1')).toThrow(/storage/);
  });

  it('provides db when storage capability is declared', () => {
    // storage works — but requires actual file system, so just check no capability error
    // (actual DB operations tested in db-context.test.ts)
    const ctx = buildPluginContext(makeDeps({ manifest: { ...baseManifest, capabilities: ['storage'] } }));
    // db should be the real context — not the guard proxy
    expect(typeof ctx.db.prepare).toBe('function');
    expect(typeof ctx.db.runMigration).toBe('function');
  });

  it('provides adapters api when adapters capability is declared', () => {
    const deps = makeDeps({
      manifest: {
        ...baseManifest,
        capabilities: ['adapters'],
        adapter: { binaryName: 'test', displayName: 'Test' },
      },
    });
    const ctx = buildPluginContext(deps);
    expect(ctx.adapters).toBeDefined();
  });

  it('adapters is undefined when adapters capability not declared', () => {
    const ctx = buildPluginContext(makeDeps({ manifest: { ...baseManifest, capabilities: [] } }));
    expect(ctx.adapters).toBeUndefined();
  });

  it('throws on events access when daemon:public-events not declared', () => {
    const ctx = buildPluginContext(makeDeps({ manifest: { ...baseManifest, capabilities: [] } }));
    expect(() => ctx.events.on('test', () => {})).toThrow(/daemon:public-events/);
  });

  it('provides events when daemon:public-events is declared', () => {
    const ctx = buildPluginContext(makeDeps({ manifest: { ...baseManifest, capabilities: ['daemon:public-events'] } }));
    expect(typeof ctx.events.on).toBe('function');
  });

  it('onUnload registers callbacks', () => {
    const callbacks: (() => void)[] = [];
    const ctx = buildPluginContext(makeDeps({ onUnloadCallbacks: callbacks }));
    const fn = vi.fn();
    ctx.onUnload(fn);
    expect(callbacks).toContain(fn);
  });

  it('throws on attachments access when storage not declared', () => {
    const ctx = buildPluginContext(makeDeps({ manifest: { ...baseManifest, capabilities: [] } }));
    expect(() => ctx.attachments.list('id')).toThrow(/storage/);
  });

  it('provides attachments when storage capability is declared', () => {
    const ctx = buildPluginContext(makeDeps({ manifest: { ...baseManifest, capabilities: ['storage'] } }));
    expect(typeof ctx.attachments.save).toBe('function');
    expect(typeof ctx.attachments.list).toBe('function');
  });

  it('always exposes router and config', () => {
    const ctx = buildPluginContext(makeDeps());
    expect(ctx.router).toBeDefined();
    expect(ctx.config).toBeDefined();
    expect(typeof ctx.config.get).toBe('function');
    expect(typeof ctx.config.set).toBe('function');
  });
});
