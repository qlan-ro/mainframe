import { describe, it, expect } from 'vitest';
import { formatLineComment } from '../format-line-comment';

describe('formatLineComment', () => {
  it('formats a single-line comment with a fence', () => {
    const out = formatLineComment({
      startLine: 42,
      endLine: 42,
      lineContent: 'const foo = bar();',
      comment: 'why bar?',
    });
    expect(out).toBe('At line 42:\n```\nconst foo = bar();\n```\nwhy bar?');
  });

  it('formats a multi-line range', () => {
    const out = formatLineComment({ startLine: 10, endLine: 12, lineContent: 'a\nb\nc', comment: 'check' });
    expect(out).toBe('At lines 10-12:\n```\na\nb\nc\n```\ncheck');
  });

  it('widens the fence when content contains a triple backtick', () => {
    const out = formatLineComment({ startLine: 1, endLine: 1, lineContent: '```js', comment: 'x' });
    expect(out).toBe('At line 1:\n````\n```js\n````\nx');
  });
});
