import { describe, it, expect } from 'vitest';
import { resolveTuning } from '../chat/resolve-tuning.js';
import type { AdapterModel } from '@qlan-ro/mainframe-types';

const opus: AdapterModel = {
  id: 'opus', label: 'Opus',
  supportedEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  supportsFast: true, supportsUltracode: true, supportsAdaptiveThinking: true,
};
const sonnet: AdapterModel = {
  id: 'sonnet', label: 'Sonnet',
  supportedEfforts: ['low', 'medium', 'high', 'max'], // no xhigh
  supportsFast: true,
};
const haiku: AdapterModel = { id: 'haiku', label: 'Haiku' }; // no effort, no caps

describe('resolveTuning', () => {
  it('uses chat override over provider default over model default', () => {
    const r = resolveTuning({ effort: 'high' }, { defaultEffort: 'low' }, opus);
    expect(r.effort).toBe('high');
  });

  it('falls back provider → model default when chat is null/absent', () => {
    expect(resolveTuning({ effort: null }, { defaultEffort: 'low' }, opus).effort).toBe('low');
    expect(resolveTuning({}, {}, { ...opus, defaultEffort: 'medium' }).effort).toBe('medium');
  });

  it('clamps unsupported effort to a supported level, never out of range', () => {
    // xhigh requested on Sonnet (no xhigh) → highest supported <= xhigh = 'high'
    expect(resolveTuning({ effort: 'xhigh' }, {}, sonnet).effort).toBe('high');
  });

  it('returns effort=null when the model has no effort control', () => {
    expect(resolveTuning({ effort: 'high' }, {}, haiku).effort).toBeNull();
  });

  it('forces booleans false when the model lacks the capability', () => {
    const r = resolveTuning({ fast: true, ultracode: true, adaptiveThinking: true }, {}, sonnet);
    expect(r).toMatchObject({ fast: true, ultracode: false, adaptiveThinking: false });
  });

  it('decodes provider-default booleans (string "true"/"false")', () => {
    expect(resolveTuning({}, { defaultFast: 'true' }, opus).fast).toBe(true);
    expect(resolveTuning({ fast: false }, { defaultFast: 'true' }, opus).fast).toBe(false);
  });

  it('coerces effort to xhigh when ultracode resolves true', () => {
    const r = resolveTuning({ effort: 'low', ultracode: true }, {}, opus);
    expect(r.ultracode).toBe(true);
    expect(r.effort).toBe('xhigh');
  });
});
