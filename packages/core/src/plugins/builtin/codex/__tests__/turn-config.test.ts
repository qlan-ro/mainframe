import { describe, it, expect } from 'vitest';
import { buildTurnConfig } from '../turn-config.js';

describe('buildTurnConfig', () => {
  it('puts effort in collaborationMode.settings, fast as serviceTier, codex extras top-level', () => {
    const cfg = buildTurnConfig(
      { effort: 'high', fast: true, ultracode: false, adaptiveThinking: false },
      { personality: 'pragmatic', reasoningSummary: 'concise', verbosity: 'low' },
      { id: 'gpt-5.5', label: 'x', supportsFast: true, supportsPersonality: true },
      'default',
    );
    expect(cfg.collaborationMode.settings.reasoning_effort).toBe('high');
    expect(cfg.serviceTier).toBe('fast');
    expect(cfg.personality).toBe('pragmatic');
    expect(cfg.summary).toBe('concise');
    expect(cfg.verbosity).toBe('low');
  });

  it('omits serviceTier/personality when the model lacks the capability', () => {
    const cfg = buildTurnConfig(
      { effort: 'high', fast: true, ultracode: false, adaptiveThinking: false },
      { personality: 'pragmatic' }, { id: 'm', label: 'x' }, 'default',
    );
    expect(cfg.serviceTier).toBe('flex');
    expect(cfg.personality).toBeUndefined();
  });
});
