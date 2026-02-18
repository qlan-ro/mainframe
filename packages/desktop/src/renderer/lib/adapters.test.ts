import { describe, expect, it } from 'vitest';
import type { AdapterInfo } from '@mainframe/types';
import { getAdapterLabel, getAdapterOptions, getModelContextWindow, getModelLabel, getModelOptions } from './adapters';

describe('adapters model metadata', () => {
  const adapters: AdapterInfo[] = [
    {
      id: 'claude',
      name: 'Claude CLI',
      description: 'Claude adapter',
      installed: true,
      version: '1.0.0',
      models: [
        { id: 'claude-opus-4-6', label: 'Opus 4.6', contextWindow: 200_000 },
        { id: 'claude-opus-4-5-20251101', label: 'Opus 4.5', contextWindow: 200_000 },
      ],
    },
  ];

  it('returns adapter and model options from adapter metadata', () => {
    const adapterOptions = getAdapterOptions(adapters);
    const modelIds = new Set(getModelOptions('claude', adapters).map((model) => model.id));

    expect(modelIds.has('claude-opus-4-6')).toBe(true);
    expect(modelIds.has('claude-opus-4-5-20251101')).toBe(true);
    expect(adapterOptions).toEqual([{ id: 'claude', label: 'Claude CLI' }]);
  });

  it('resolves known model labels from adapter metadata', () => {
    expect(getModelLabel('claude-opus-4-6', adapters)).toBe('Opus 4.6');
    expect(getModelLabel('claude-opus-4-5-20251101', adapters)).toBe('Opus 4.5');
  });

  it('falls back safely for unknown values', () => {
    expect(getAdapterLabel('unknown')).toBe('unknown');
    expect(getModelLabel('custom-model', adapters)).toBe('custom-model');
    expect(getModelLabel(undefined, adapters)).toBe('');
    expect(getModelContextWindow('unknown-model', adapters)).toBe(200_000);
  });
});
