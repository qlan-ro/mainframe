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
    getFallbackModels: () => models,
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
    expect(opus46?.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(opus46?.supportsFast).toBe(true);
    expect(opus46?.supportsUltracode).toBe(true);
    expect(opus46?.supportsAdaptiveThinking).toBe(true);
  });
});

describe('AdapterRegistry', () => {
  it('includes adapter models in list output', async () => {
    const registry = new AdapterRegistry();
    const mockModels: AdapterModel[] = [{ id: 'mock-fast', label: 'Mock Fast', contextWindow: 128_000 }];
    registry.register(createMockAdapter(mockModels));
    registry.seedStaticSnapshots();

    const list = await registry.list();
    const mock = list.find((item) => item.id === 'mock');

    expect(mock).toBeDefined();
    expect(mock?.models).toEqual(mockModels);
  });

  // Plugin-provided adapters (e.g. the e2e mock-cli plugin) aren't backed by a real spawnable
  // CLI binary on PATH — they report their own installed state and model catalog directly.
  // The refresh must not conclude "not installed" (and skip listModels()) just because a
  // `<adapterId> --version` spawn ENOENTs; it should fall back to the adapter's own
  // isInstalled()/getVersion() before giving up.
  it('falls back to the adapter’s own isInstalled()/listModels() when no CLI binary resolves', async () => {
    const registry = new AdapterRegistry();
    const models: AdapterModel[] = [{ id: 'plugin-model', label: 'Plugin Model' }];
    const adapter: Adapter = {
      id: 'plugin-adapter',
      name: 'Plugin Adapter',
      capabilities: { planMode: false },
      isInstalled: vi.fn().mockResolvedValue(true),
      getVersion: vi.fn().mockResolvedValue('0.1.0'),
      listModels: vi.fn().mockResolvedValue(models),
      killAll: vi.fn(),
    } as unknown as Adapter;
    registry.register(adapter);
    registry.seedStaticSnapshots();
    registry.configureRefresh({
      resolveExecutablePath: vi.fn().mockResolvedValue(undefined),
      run: vi.fn().mockResolvedValue({ ok: false, stdout: '' }), // no `plugin-adapter` binary on PATH
      emitEvent: vi.fn(),
    });
    registry.allowRefresh();

    await registry.refreshAll();

    const snapshot = registry.getSnapshots().find((item) => item.id === 'plugin-adapter');
    expect(snapshot?.installed).toBe(true);
    expect(snapshot?.models).toEqual(models);
  });
});
