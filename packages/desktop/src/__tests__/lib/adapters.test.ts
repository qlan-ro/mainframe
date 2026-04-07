import { describe, it, expect } from 'vitest';
import { getModelLabel, getModelContextWindow, getModelOptions } from '../../renderer/lib/adapters.js';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

const mockAdapters: AdapterInfo[] = [
  {
    id: 'claude',
    name: 'Claude CLI',
    description: 'Claude CLI adapter',
    installed: true,
    models: [
      { id: 'claude-opus-4-6', label: 'Opus 4.6', contextWindow: 200_000 },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', contextWindow: 200_000 },
    ],
  },
];

describe('getModelLabel', () => {
  it('resolves label from adapter-provided models', () => {
    expect(getModelLabel('claude-opus-4-6', mockAdapters)).toBe('Opus 4.6');
  });

  it('pattern-matches unknown claude model IDs', () => {
    expect(getModelLabel('claude-sonnet-99-0-20301231', mockAdapters)).toBe('Sonnet 99.0');
  });

  it('returns raw ID for non-claude unknown models', () => {
    expect(getModelLabel('gpt-4o', mockAdapters)).toBe('gpt-4o');
  });
});

describe('getModelContextWindow', () => {
  it('resolves from adapter-provided models', () => {
    expect(getModelContextWindow('claude-opus-4-6', mockAdapters)).toBe(200_000);
  });

  it('defaults to 200K for unknown models', () => {
    expect(getModelContextWindow('unknown-model', mockAdapters)).toBe(200_000);
  });
});

describe('getModelOptions', () => {
  it('returns models for a known adapter', () => {
    const options = getModelOptions('claude', mockAdapters);
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({ id: 'claude-opus-4-6', label: 'Opus 4.6' });
  });

  it('returns empty array for unknown adapter', () => {
    expect(getModelOptions('unknown', mockAdapters)).toEqual([]);
  });
});
