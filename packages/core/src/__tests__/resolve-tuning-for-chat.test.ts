import { describe, it, expect } from 'vitest';
import { resolveTuningForChat } from '../chat/resolve-tuning-for-chat.js';
import type { AdapterModel } from '@qlan-ro/mainframe-types';

function deps(chat: unknown, model: AdapterModel | null, provider: Record<string, string> = {}) {
  return {
    db: {
      chats: { get: () => chat },
      settings: { get: (_ns: string, key: string) => provider[key.split('.')[1]!] ?? null },
    },
    adapters: { get: () => ({ listModels: async () => (model ? [model] : []) }) },
  } as never;
}

describe('resolveTuningForChat', () => {
  it('resolves + clamps + coerces from chat/provider/model', async () => {
    const model: AdapterModel = { id: 'opus', label: 'Opus', supportedEfforts: ['low', 'xhigh'], supportsUltracode: true };
    const r = await resolveTuningForChat(
      deps({ adapterId: 'claude', model: 'opus', effort: 'low', ultracode: true }, model),
      'c1',
    );
    expect(r).toMatchObject({ ultracode: true, effort: 'xhigh' }); // ultracode coercion applied here, once
  });

  it('returns null effort when the model has no effort control', async () => {
    const model: AdapterModel = { id: 'haiku', label: 'Haiku' };
    const r = await resolveTuningForChat(deps({ adapterId: 'claude', model: 'haiku', effort: 'high' }, model), 'c2');
    expect(r?.effort).toBeNull();
  });

  it('returns null when the chat is missing', async () => {
    expect(await resolveTuningForChat(deps(undefined, null), 'missing')).toBeNull();
  });
});
