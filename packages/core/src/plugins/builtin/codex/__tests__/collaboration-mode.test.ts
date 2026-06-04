import { describe, it, expect } from 'vitest';
import { buildTurnConfig } from '../turn-config.js';
import type { ResolvedTuning } from '@qlan-ro/mainframe-types';

const baseModel = 'codex-mini-latest';
const defaultTuning: ResolvedTuning = { effort: null, fast: false, ultracode: false, adaptiveThinking: false };

describe('collaboration mode derivation', () => {
  it('sets mode=plan when planMode=true', () => {
    const cfg = buildTurnConfig(defaultTuning, {}, baseModel, 'plan');
    expect(cfg.collaborationMode.mode).toBe('plan');
  });

  it('sets mode=default when planMode=false', () => {
    const cfg = buildTurnConfig(defaultTuning, {}, baseModel, 'default');
    expect(cfg.collaborationMode.mode).toBe('default');
  });

  it('threads resolved effort into collaborationMode.settings.reasoning_effort', () => {
    const tuning: ResolvedTuning = { effort: 'high', fast: false, ultracode: false, adaptiveThinking: false };
    const cfg = buildTurnConfig(tuning, {}, baseModel, 'default');
    expect(cfg.collaborationMode.settings.reasoning_effort).toBe('high');
  });

  it('uses null reasoning_effort when effort is null', () => {
    const cfg = buildTurnConfig(defaultTuning, {}, baseModel, 'default');
    expect(cfg.collaborationMode.settings.reasoning_effort).toBeNull();
  });
});
