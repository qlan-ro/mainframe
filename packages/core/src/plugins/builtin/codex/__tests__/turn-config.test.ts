import { describe, it, expect } from 'vitest';
import { buildTurnConfig } from '../turn-config.js';

describe('buildTurnConfig', () => {
  it('puts effort in collaborationMode.settings, fast as serviceTier, codex extras top-level', () => {
    const cfg = buildTurnConfig(
      { effort: 'high', fast: true, ultracode: false, adaptiveThinking: false },
      { personality: 'pragmatic', reasoningSummary: 'concise' },
      'gpt-5.5',
      'default',
    );
    expect(cfg.collaborationMode.settings.model).toBe('gpt-5.5');
    expect(cfg.collaborationMode.settings.reasoning_effort).toBe('high');
    expect(cfg.serviceTier).toBe('fast');
    expect(cfg.personality).toBe('pragmatic');
    expect(cfg.summary).toBe('concise');
  });

  // Trusts already-resolved inputs — it does NOT re-gate on model caps (the resolver
  // already clamped tuning.fast; the settings UI already gated personality). The
  // session only knows the model id, so re-checking caps here would be inert.
  it('serviceTier follows resolved tuning.fast, not a model-cap re-check', () => {
    expect(buildTurnConfig({ effort: 'high', fast: false, ultracode: false, adaptiveThinking: false }, {}, 'm', 'default').serviceTier).toBe('flex');
    expect(buildTurnConfig({ effort: 'high', fast: true, ultracode: false, adaptiveThinking: false }, {}, 'm', 'default').serviceTier).toBe('fast');
  });

  it('omits personality/summary when not provided', () => {
    const cfg = buildTurnConfig({ effort: null, fast: false, ultracode: false, adaptiveThinking: false }, {}, 'm', 'default');
    expect(cfg.personality).toBeUndefined();
    expect(cfg.summary).toBeUndefined();
  });
});
