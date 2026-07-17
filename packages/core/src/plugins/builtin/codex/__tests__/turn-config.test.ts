import { describe, it, expect } from 'vitest';
import { buildTurnConfig } from '../turn-config.js';
import type { ResolvedTuning } from '@qlan-ro/mainframe-types';

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

  // serviceTier is 'fast' only when tuning.fast is true; it is undefined otherwise so
  // the caller omits service_tier entirely and the account default tier is used.
  // The string 'flex' is never produced — sending it caused OpenAI 400 errors on gpt-5.5.
  it('serviceTier is fast when tuning.fast is true and undefined when tuning.fast is false', () => {
    expect(
      buildTurnConfig({ effort: 'high', fast: false, ultracode: false, adaptiveThinking: false }, {}, 'm', 'default')
        .serviceTier,
    ).toBeUndefined();
    expect(
      buildTurnConfig({ effort: 'high', fast: true, ultracode: false, adaptiveThinking: false }, {}, 'm', 'default')
        .serviceTier,
    ).toBe('fast');
  });

  it('omits personality/summary when not provided', () => {
    const cfg = buildTurnConfig(
      { effort: null, fast: false, ultracode: false, adaptiveThinking: false },
      {},
      'm',
      'default',
    );
    expect(cfg.personality).toBeUndefined();
    expect(cfg.summary).toBeUndefined();
  });

  it.each([undefined, ''])('omits the model setting when no model is selected (%s)', (model) => {
    const cfg = buildTurnConfig(
      { effort: 'high', fast: false, ultracode: false, adaptiveThinking: false },
      {},
      model,
      'default',
    );

    expect(cfg.collaborationMode.settings).not.toHaveProperty('model');
  });
});

describe('collaboration mode derivation', () => {
  const baseModel = 'codex-mini-latest';
  const defaultTuning: ResolvedTuning = { effort: null, fast: false, ultracode: false, adaptiveThinking: false };

  it('sets mode=plan when planMode=true', () => {
    const cfg = buildTurnConfig(defaultTuning, {}, baseModel, 'plan');
    expect(cfg.collaborationMode.mode).toBe('plan');
  });

  it('sets mode=default when planMode=false', () => {
    const cfg = buildTurnConfig(defaultTuning, {}, baseModel, 'default');
    expect(cfg.collaborationMode.mode).toBe('default');
  });

  it('uses null reasoning_effort when effort is null', () => {
    const cfg = buildTurnConfig(defaultTuning, {}, baseModel, 'default');
    expect(cfg.collaborationMode.settings.reasoning_effort).toBeNull();
  });
});
