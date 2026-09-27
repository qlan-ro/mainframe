import { describe, expect, it } from 'vitest';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';
import { withCliModel } from '../cli-model';
import { resolveDraftDefaults } from '@/features/sessions/new-thread/resolve-draft-defaults';

const catalog = {
  id: 'claude',
  models: [
    { id: 'default', label: 'Default - Opus 5', resolvedModel: 'claude-opus-5', isDefault: true },
    { id: 'claude-opus-5', label: 'Opus 5' },
    { id: 'fable', label: 'Fable 5.1', resolvedModel: 'claude-fable-5-1', supportedEfforts: ['high'] },
  ],
} as AdapterInfo;

describe('CLI configured model', () => {
  it('uses Fable capabilities and label without pinning the inherited preference', () => {
    const adapter = withCliModel(catalog, 'claude-fable-5-1');
    expect(adapter.models[0]).toMatchObject({
      id: 'default',
      label: 'Use CLI setting · Fable 5.1',
      resolvedModel: 'claude-fable-5-1',
      supportedEfforts: ['high'],
    });
    expect(resolveDraftDefaults('project', adapter, undefined, 'claude-fable-5-1')).toMatchObject({
      model: 'default',
      effort: 'high',
    });
    expect(resolveDraftDefaults('project', adapter, { defaultModel: 'claude-opus-5' }).model).toBe('claude-opus-5');
  });

  it('does not substitute the recommended model when resolution is unavailable', () => {
    expect(withCliModel(catalog, null).models[0]).toMatchObject({ label: 'Use CLI setting', resolvedModel: undefined });
  });

  it('shows an unknown configured ID honestly and preserves explicit model choices', () => {
    const adapter = withCliModel(catalog, 'private-model');
    expect(adapter.models[0]?.label).toBe('Use CLI setting · private-model');
    expect(adapter.models.slice(1).map((model) => model.id)).toEqual(['claude-opus-5', 'fable']);
  });
});
