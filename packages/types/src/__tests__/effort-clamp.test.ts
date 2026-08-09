import { describe, it, expect } from 'vitest';
import { clampEffortToSupported, type EffortLevel } from '../adapter.js';

const ALL_LEVELS: EffortLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const CLAUDE_LIKE: EffortLevel[] = ['low', 'medium', 'high', 'max'];
const CODEX_LIKE: EffortLevel[] = ['medium', 'high', 'xhigh'];

describe('clampEffortToSupported — seven-level regression (pins current behaviour)', () => {
  it.each(ALL_LEVELS)('%s against the full supported set, no defaultEffort → itself', (level) => {
    expect(clampEffortToSupported(level, ALL_LEVELS)).toBe(level);
  });

  it.each<[EffortLevel, EffortLevel]>([
    ['none', 'low'],
    ['minimal', 'low'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'high'],
    ['max', 'max'],
  ])('%s against a Claude-like set (no xhigh), no defaultEffort → %s', (level, expected) => {
    expect(clampEffortToSupported(level, CLAUDE_LIKE)).toBe(expected);
  });

  it.each(ALL_LEVELS)('%s against a single-element set [medium] → medium', (level) => {
    expect(clampEffortToSupported(level, ['medium'])).toBe('medium');
  });

  it.each<[EffortLevel, EffortLevel]>([
    ['none', 'high'],
    ['minimal', 'high'],
    ['low', 'low'],
    ['medium', 'medium'],
    ['high', 'high'],
    ['xhigh', 'high'],
    ['max', 'max'],
  ])('%s against a Claude-like set with defaultEffort:high → %s', (level, expected) => {
    expect(clampEffortToSupported(level, CLAUDE_LIKE, 'high')).toBe(expected);
  });
});

describe('clampEffortToSupported — supported: [] guard (pin, green today)', () => {
  it('a pre-existing level against an empty set → null', () => {
    expect(clampEffortToSupported('high', [])).toBeNull();
  });

  it('ultra against an empty set → null', () => {
    expect(clampEffortToSupported('ultra', [])).toBeNull();
  });
});

describe('clampEffortToSupported — ultra', () => {
  it('requested against a set that includes it → itself (pin, green today)', () => {
    expect(clampEffortToSupported('ultra', ['high', 'ultra'])).toBe('ultra');
  });

  it('requested against a Claude-like set with no defaultEffort → max (red: outranks max)', () => {
    expect(clampEffortToSupported('ultra', CLAUDE_LIKE)).toBe('max');
  });

  it('requested against a Codex-like set with no defaultEffort → xhigh (red: outranks xhigh)', () => {
    expect(clampEffortToSupported('ultra', CODEX_LIKE)).toBe('xhigh');
  });

  it('requested against ["low","high"] with defaultEffort:high → high (pin, green today: default wins over ranking)', () => {
    expect(clampEffortToSupported('ultra', ['low', 'high'], 'high')).toBe('high');
  });
});
