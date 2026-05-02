import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff } from '../../messages/parse-unified-diff.js';

describe('parseUnifiedDiff', () => {
  it('returns [] for empty string', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  it('returns [] for whitespace-only input', () => {
    expect(parseUnifiedDiff('   \n\t\n  ')).toEqual([]);
  });

  it('parses a simple replace with context into 1 hunk', () => {
    const diff = '@@ -1,3 +1,3 @@\n line one\n-line two\n+line two modified\n line three';
    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
    });
    expect(result[0]!.lines).toEqual([' line one', '-line two', '+line two modified', ' line three']);
  });

  it('parses an add-only diff (no removed lines)', () => {
    const diff = '@@ -1,2 +1,3 @@\n line one\n line two\n+added line';
    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3 });
    expect(result[0]!.lines).toContain('+added line');
  });

  it('parses a delete-only diff (no added lines)', () => {
    const diff = '@@ -1,3 +1,2 @@\n line one\n-deleted line\n line three';
    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 2 });
    expect(result[0]!.lines).toContain('-deleted line');
  });

  it('parses a multi-hunk diff into 2 hunks with correct starts', () => {
    const diff = [
      '@@ -1,3 +1,3 @@',
      ' context',
      '-old line',
      '+new line',
      '@@ -10,3 +10,4 @@',
      ' other context',
      '+extra line',
      ' end',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3 });
    expect(result[1]).toMatchObject({ oldStart: 10, oldLines: 3, newStart: 10, newLines: 4 });
  });

  it('preserves \\ No newline at end of file lines as-is', () => {
    const diff = '@@ -1,1 +1,1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file';
    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0]!.lines).toContain('\\ No newline at end of file');
  });

  it('handles a headerless diff by returning a single hunk with defaults', () => {
    const diff = '+foo\n-bar';
    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ oldStart: 1, newStart: 1 });
    expect(result[0]!.lines).toContain('+foo');
    expect(result[0]!.lines).toContain('-bar');
  });

  it('parses a real-world fixture correctly', () => {
    const diff = [
      '@@ -10,7 +10,8 @@ function foo() {',
      '   const a = 1;',
      '   const b = 2;',
      '-  return a + b;',
      '+  return a + b + 1;',
      '+  // tweaked the math',
      ' }',
      ' ',
      ' export { foo };',
    ].join('\n');
    const result = parseUnifiedDiff(diff);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      oldStart: 10,
      newStart: 10,
      oldLines: 7,
      newLines: 8,
    });
    expect(result[0]!.lines).toHaveLength(8);
    expect(result[0]!.lines[0]).toBe('   const a = 1;');
    expect(result[0]!.lines[2]).toBe('-  return a + b;');
    expect(result[0]!.lines[3]).toBe('+  return a + b + 1;');
    expect(result[0]!.lines[4]).toBe('+  // tweaked the math');
  });
});
