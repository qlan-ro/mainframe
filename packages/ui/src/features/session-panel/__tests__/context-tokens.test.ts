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

  it('prints thousands with one decimal, capital K — matching modelDisplayLabel', () => {
    expect(formatTokenCount(3200)).toBe('3.2K');
    expect(formatTokenCount(84_400)).toBe('84.4K');
  });

  it('drops a trailing .0', () => {
    expect(formatTokenCount(1000)).toBe('1K');
    expect(formatTokenCount(200_000)).toBe('200K');
  });

  it('rounds to the nearest tenth of a thousand', () => {
    expect(formatTokenCount(3249)).toBe('3.2K');
    expect(formatTokenCount(3250)).toBe('3.3K');
  });

  it('switches to millions at 1,000,000, with the same one-decimal, drop-.0 rule', () => {
    expect(formatTokenCount(1_000_000)).toBe('1M');
    expect(formatTokenCount(1_500_000)).toBe('1.5M');
  });

  it('stays in thousands one token below a million', () => {
    expect(formatTokenCount(999_999)).toBe('1000K');
  });
});

describe('formatTokens', () => {
  it('marks the count as an estimate with a tilde', () => {
    expect(formatTokens(3200)).toBe('~3.2K');
    expect(formatTokens(512)).toBe('~512');
  });
});
