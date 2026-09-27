import { describe, expect, it } from 'vitest';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { resolveModel, selectedModel, withCliModel } from '../cli-model';
import { modelRows } from '@/features/chat/composer/config-toolbar/model-menu-rows';

const catalog = {
  id: 'claude',
  models: [
    { id: 'default', label: 'Use CLI setting', isDefault: true },
    {
      id: 'opus[1m]',
      label: 'Opus 5.5',
      resolvedModel: 'claude-opus-5-5[1m]',
      description: 'Opus with 1M context',
      contextWindow: 1_000_000,
      supportedEfforts: ['high'],
    },
  ],
} as AdapterInfo;

describe('saved model aliases', () => {
  it('labels a saved bare alias while retaining the separately selectable 1M variant', () => {
    expect(selectedModel(catalog, 'opus')).toMatchObject({
      id: 'opus',
      label: 'Opus 5.5',
      supportedEfforts: ['high'],
      contextWindow: undefined,
      description: undefined,
    });
    expect(modelRows(catalog, 'opus').map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'opus', label: 'Opus 5.5' },
      { id: 'default', label: 'Use CLI setting' },
      { id: 'opus[1m]', label: 'Opus 5.5 · 1M' },
    ]);
  });
});

it('prefers an exact variant and keeps both declared context choices', () => {
  const variants = {
    ...catalog,
    models: [
      catalog.models[1]!,
      {
        id: 'opus',
        label: 'Opus 5.5',
        resolvedModel: 'claude-opus-5-5',
        contextWindow: 250_000,
        supportedEfforts: ['medium'],
      },
    ],
  } as AdapterInfo;
  expect(selectedModel(variants, 'opus')).toMatchObject({
    id: 'opus',
    label: 'Opus 5.5 · 250K',
    contextWindow: 250_000,
    supportedEfforts: ['medium'],
  });
  expect(modelRows(variants, 'opus').map(({ id, label }) => ({ id, label }))).toEqual([
    { id: 'opus[1m]', label: 'Opus 5.5 · 1M' },
    { id: 'opus', label: 'Opus 5.5 · 250K' },
  ]);
});

it('reuses an exact resolved-model row without rewriting a pinned selection', () => {
  const pinned = 'claude-opus-5-5[1m]';
  expect(selectedModel(catalog, pinned)).toMatchObject({
    id: pinned,
    label: 'Opus 5.5 · 1M',
    contextWindow: 1_000_000,
  });
  expect(modelRows(catalog, pinned).map(({ id }) => id)).toEqual(['default', pinned]);
});

it('resolves Codex metadata without replacing its saved concrete ID', () => {
  const codex = {
    id: 'codex',
    models: [{ id: 'gpt-6', label: 'GPT 6', resolvedModel: 'gpt-6-2026-09-01', contextWindow: 400_000 }],
  } as AdapterInfo;
  expect(selectedModel(codex, 'gpt-6-2026-09-01')).toMatchObject({ id: 'gpt-6-2026-09-01', label: 'GPT 6 · 400K' });
  expect(modelRows(codex, 'gpt-6-2026-09-01')).toHaveLength(1);
});

it('does not guess an unknown model from its family name', () => {
  expect(resolveModel(catalog, 'claude-opus-custom')).toEqual({
    id: 'claude-opus-custom',
    label: 'claude-opus-custom',
  });
});

it('does not choose arbitrarily between ambiguous normalized matches', () => {
  const ambiguous = { ...catalog, models: [catalog.models[1]!, { ...catalog.models[1]!, id: 'other-alias' }] };
  expect(resolveModel(ambiguous, 'claude-opus-5-5')).toEqual({ id: 'claude-opus-5-5', label: 'claude-opus-5-5' });
});

it('shows an explicit 1M choice without borrowing the base context limit', () => {
  const base = {
    id: 'claude',
    models: [{ id: 'opus', label: 'Opus 5.5 · 250K', contextWindow: 250_000 }],
  } as AdapterInfo;
  expect(resolveModel(base, 'opus[1m]')).toMatchObject({
    id: 'opus[1m]',
    label: 'Opus 5.5 · 1M',
    contextWindow: undefined,
  });
});

it.each(['opus', 'opus[1m]'])('merges equivalent native-1M variants while preserving %s', (savedId) => {
  const native = {
    ...catalog,
    models: [...catalog.models, { ...catalog.models[1]!, id: 'opus', resolvedModel: 'claude-opus-5-5' }],
  };
  expect(modelRows(native, savedId).map(({ id, label }) => ({ id, label }))).toEqual([
    { id: 'default', label: 'Use CLI setting' },
    { id: savedId, label: 'Opus 5.5 · 1M' },
  ]);
});

it('keeps reported context metadata authoritative over an explicit suffix', () => {
  const reported = { ...catalog, models: [{ ...catalog.models[1]!, contextWindow: 900_000 }] };
  expect(resolveModel(reported, 'opus[1m]').label).toBe('Opus 5.5 · 900K');
});

it('keeps unrelated aliases and routed endpoints separate', () => {
  const shared = { label: 'Opus 5.5', resolvedModel: 'claude-opus-5-5', contextWindow: 1_000_000 };
  const routed = {
    ...catalog,
    models: [
      { ...shared, id: 'opus' },
      { ...shared, id: 'advisor' },
      { ...shared, id: 'cliproxy/opus', group: 'CLIProxy' },
    ],
  };
  expect(modelRows(routed, 'opus').map((model) => model.id)).toEqual(['opus', 'advisor', 'cliproxy/opus']);
});

it('formats an inherited context window once', () => {
  const inherited = withCliModel(catalog, 'claude-opus-5-5[1m]');
  expect(selectedModel(inherited, 'default')?.label).toBe('Use CLI setting · Opus 5.5 · 1M');
  expect(modelRows(inherited, 'default')[0]?.label).toBe('Use CLI setting · Opus 5.5 · 1M');
});

it('does not resolve a native selection from an endpoint-specific alias', () => {
  const endpoint = {
    ...catalog,
    models: [
      {
        id: 'cliproxy/opus',
        label: 'Endpoint Opus',
        resolvedModel: 'claude-opus-5-5',
        contextWindow: 1_000_000,
        group: 'CLIProxy',
      },
    ],
  };
  expect(resolveModel(endpoint, 'claude-opus-5-5')).toEqual({ id: 'claude-opus-5-5', label: 'claude-opus-5-5' });
});
