import { describe, it, expect } from 'vitest';
import { resolveTuningForChat } from '../resolve-tuning-for-chat.js';
import type { AdapterModel } from '@qlan-ro/mainframe-types';

function deps(models: AdapterModel[], chat: any) {
  return {
    db: { chats: { get: () => chat }, settings: { get: () => null } },
    adapters: { get: () => ({ listModels: async () => models }) },
  };
}

describe('resolveTuningForChat against the probed catalog', () => {
  it('keeps xhigh when the probed model supports it', async () => {
    const models: AdapterModel[] = [
      { id: 'opus[1m]', label: 'Opus', supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
    ];
    const t = await resolveTuningForChat(
      deps(models, { id: 'c1', adapterId: 'claude', model: 'opus[1m]', effort: 'xhigh' }),
      'c1',
    );
    expect(t?.effort).toBe('xhigh');
  });

  it('falls back to the isDefault probed model for an alias id', async () => {
    const models: AdapterModel[] = [{ id: 'claude-x', label: 'X', isDefault: true, supportedEfforts: ['low', 'high'] }];
    const t = await resolveTuningForChat(
      deps(models, { id: 'c2', adapterId: 'claude', model: 'default', effort: 'high' }),
      'c2',
    );
    expect(t?.effort).toBe('high');
  });
});
