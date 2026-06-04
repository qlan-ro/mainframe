import { describe, it, expect } from 'vitest';
import { mapCodexModel } from '../adapter.js';

describe('mapCodexModel', () => {
  it('maps efforts, default, fast tier, personality, isDefault', () => {
    const m = mapCodexModel({
      id: 'gpt-5.5', displayName: 'GPT-5.5', description: 'Frontier',
      hidden: false, isDefault: false, supportsPersonality: true,
      additionalSpeedTiers: ['fast'], defaultReasoningEffort: 'medium',
      supportedReasoningEfforts: [
        { reasoningEffort: 'low', description: '' }, { reasoningEffort: 'medium', description: '' },
        { reasoningEffort: 'high', description: '' }, { reasoningEffort: 'xhigh', description: '' },
      ],
    });
    expect(m.supportedEfforts).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(m.defaultEffort).toBe('medium');
    expect(m.supportsFast).toBe(true);
    expect(m.supportsPersonality).toBe(true);
  });
});
