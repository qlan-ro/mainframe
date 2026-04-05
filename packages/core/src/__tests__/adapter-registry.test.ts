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
    expect(cats.hidden).toContain('Skill');
    expect(cats.progress).toEqual(new Set(['TaskCreate', 'TaskUpdate']));
    expect(cats.subagent).toEqual(new Set(['Task', 'Agent']));
  });
});

describe('ClaudeAdapter.listModels', () => {
  it('returns all 11 known Claude models', async () => {
    const adapter = new ClaudeAdapter();
    const models = await adapter.listModels();
    expect(models.length).toBe(11);
    const ids = models.map((m) => m.id);
    expect(ids).toContain('claude-opus-4-6');
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('claude-3-5-haiku-20241022');
    expect(ids).toContain('claude-3-5-sonnet-20241022');
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
