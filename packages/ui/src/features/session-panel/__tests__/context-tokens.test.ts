import { describe, expect, it } from 'vitest';
import { estimateTokens, formatTokenCount, formatTokens } from '../context-tokens';

describe('estimateTokens', () => {
  it('is zero for empty content', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('counts four characters as one token', () => {
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('rounds a partial token up', () => {
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a')).toBe(1);
  });

  it('scales linearly with length', () => {
    expect(estimateTokens('x'.repeat(12_800))).toBe(3200);
  });
});

describe('formatTokenCount', () => {
  it('prints counts below a thousand verbatim', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('prints thousands with one decimal', () => {
    expect(formatTokenCount(3200)).toBe('3.2k');
    expect(formatTokenCount(84_400)).toBe('84.4k');
  });

  it('drops a trailing .0', () => {
    expect(formatTokenCount(1000)).toBe('1k');
    expect(formatTokenCount(200_000)).toBe('200k');
  });

  it('rounds to the nearest tenth of a thousand', () => {
    expect(formatTokenCount(3249)).toBe('3.2k');
    expect(formatTokenCount(3250)).toBe('3.3k');
  });
});

describe('formatTokens', () => {
  it('marks the count as an estimate with a tilde', () => {
    expect(formatTokens(3200)).toBe('~3.2k');
    expect(formatTokens(512)).toBe('~512');
  });
});
