import { describe, expect, it, vi } from 'vitest';
import type { Adapter, AdapterModel } from '@qlan-ro/mainframe-types';
import { AdapterRegistry } from '../adapters/index.js';
import { ClaudeAdapter } from '../plugins/builtin/claude/adapter.js';

function createMockAdapter(models: AdapterModel[]): Adapter {
  return {
    id: 'mock',
    name: 'Mock Adapter',
    isInstalled: vi.fn().mockResolvedValue(true),
    getVersion: vi.fn().mockResolvedValue('1.0.0'),
    listModels: vi.fn().mockResolvedValue(models),
    spawn: vi.fn(),
    kill: vi.fn(),
    sendMessage: vi.fn(),
    respondToPermission: vi.fn(),
  } as unknown as Adapter;
}

describe('ClaudeAdapter.getToolCategories', () => {
  it('returns Claude-specific tool categories', () => {
    const adapter = new ClaudeAdapter();
    const cats = adapter.getToolCategories();
    expect(cats.explore).toEqual(new Set(['Read', 'Glob', 'Grep', 'LS']));
    expect(cats.hidden).toContain('TaskList');
    expect(cats.hidden).toContain('TaskCreate');
    expect(cats.hidden).toContain('TaskUpdate');
    expect(cats.hidden).not.toContain('Skill');
    expect(cats.progress).toEqual(new Set(['TaskCreate', 'TaskUpdate']));
    expect(cats.subagent).toEqual(new Set(['Task', 'Agent']));
  });
});

describe('ClaudeAdapter.listModels', () => {
  it('returns the hardcoded Claude model catalog', async () => {
    const adapter = new ClaudeAdapter();
    const models = await adapter.listModels();
    expect(models.length).toBe(14);
    const ids = models.map((m) => m.id);
    expect(ids).toContain('default');
    expect(ids).toContain('claude-opus-4-6');
    expect(ids).toContain('opus[1m]');
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('sonnet[1m]');
    expect(ids).toContain('claude-3-5-haiku-20241022');
    expect(ids).toContain('claude-3-5-sonnet-20241022');
  });

  it('marks a single entry as the fallback default', async () => {
    const adapter = new ClaudeAdapter();
    const models = await adapter.listModels();
    const defaults = models.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe('default');
    expect(defaults[0]?.description).toBeTruthy();
  });

  it('includes capability flags on supported models', async () => {
    const adapter = new ClaudeAdapter();
    const models = await adapter.listModels();
    const opus46 = models.find((m) => m.id === 'claude-opus-4-6');
    expect(opus46?.supportsEffort).toBe(true);
    expect(opus46?.supportsFastMode).toBe(true);
    expect(opus46?.supportsAutoMode).toBe(true);
  });
});

describe('AdapterRegistry', () => {
  it('includes adapter models in list output', async () => {
    const registry = new AdapterRegistry();
    const mockModels: AdapterModel[] = [{ id: 'mock-fast', label: 'Mock Fast', contextWindow: 128_000 }];
    registry.register(createMockAdapter(mockModels));

    const list = await registry.list();
    const mock = list.find((item) => item.id === 'mock');

    expect(mock).toBeDefined();
    expect(mock?.models).toEqual(mockModels);
  });
});

describe('AdapterRegistry.probeAllModels', () => {
  it('calls probeModels on adapters that support it and emits event', async () => {
    const probedModels: AdapterModel[] = [{ id: 'probed-model', label: 'Probed' }];
    const adapter = createMockAdapter([{ id: 'fallback', label: 'Fallback' }]);
    (adapter as any).probeModels = vi.fn().mockResolvedValue(probedModels);

    const registry = new AdapterRegistry();
    registry.register(adapter);

    const events: any[] = [];
    await registry.probeAllModels((event) => events.push(event));

    expect((adapter as any).probeModels).toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'adapter.models.updated',
      adapterId: 'mock',
      models: probedModels,
    });
  });

  it('skips adapters without probeModels', async () => {
    const adapter = createMockAdapter([]);
    const registry = new AdapterRegistry();
    registry.register(adapter);

    const events: any[] = [];
    await registry.probeAllModels((event) => events.push(event));

    expect(events).toHaveLength(0);
  });

  it('handles probe failure gracefully', async () => {
    const adapter = createMockAdapter([]);
    (adapter as any).probeModels = vi.fn().mockResolvedValue(null);

    const registry = new AdapterRegistry();
    registry.register(adapter);

    const events: any[] = [];
    await registry.probeAllModels((event) => events.push(event));

    expect(events).toHaveLength(0);
  });
});
