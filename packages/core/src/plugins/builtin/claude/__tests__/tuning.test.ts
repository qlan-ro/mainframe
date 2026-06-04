import { describe, it, expect } from 'vitest';
import { tuningToFlagSettings } from '../tuning.js';

describe('tuningToFlagSettings', () => {
  it('maps a resolved tuning to flag settings keys', () => {
    expect(tuningToFlagSettings({ effort: 'xhigh', fast: true, ultracode: false, adaptiveThinking: true }))
      .toEqual({ effortLevel: 'xhigh', fastMode: true, ultracode: false, alwaysThinkingEnabled: true });
  });
  it('omits effortLevel when the model has no effort control (effort === null)', () => {
    expect(tuningToFlagSettings({ effort: null, fast: true, ultracode: false, adaptiveThinking: false }))
      .toEqual({ fastMode: true, ultracode: false, alwaysThinkingEnabled: false });
  });
});
