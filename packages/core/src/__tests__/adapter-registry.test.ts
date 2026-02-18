import { describe, expect, it, vi } from 'vitest';
import type { Adapter, AdapterModel } from '@mainframe/types';
import { AdapterRegistry } from '../adapters/index.js';

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
