import { formatLineComment, formatReview } from '../format-line-comment';

describe('formatLineComment', () => {
  it('single line', () => {
    expect(formatLineComment({ startLine: 5, endLine: 5, lineContent: 'const x = 1;', comment: 'why 1?' })).toBe(
      'At line 5:\n```\nconst x = 1;\n```\nwhy 1?',
    );
  });

  it('multi-line range', () => {
    expect(formatLineComment({ startLine: 5, endLine: 7, lineContent: 'a\nb\nc', comment: 'note' })).toBe(
      'At lines 5-7:\n```\na\nb\nc\n```\nnote',
    );
  });

  it('grows the fence past backtick runs in content', () => {
    expect(formatLineComment({ startLine: 1, endLine: 1, lineContent: 'x = `a` + ```b```', comment: 'c' })).toBe(
      'At line 1:\n````\nx = `a` + ```b```\n````\nc',
    );
  });

  it('empty content omits the fence', () => {
    expect(formatLineComment({ startLine: 2, endLine: 2, lineContent: '', comment: 'c' })).toBe('At line 2:\nc');
  });
});

describe('formatReview', () => {
  it('joins with --- and prefixes File:', () => {
    const out = formatReview('src/a.ts', [
      { startLine: 1, endLine: 1, lineContent: 'x', comment: 'one' },
      { startLine: 4, endLine: 5, lineContent: 'y\nz', comment: 'two' },
    ]);
    expect(out).toBe('File: `src/a.ts`\n\nAt line 1:\n```\nx\n```\none\n\n---\n\nAt lines 4-5:\n```\ny\nz\n```\ntwo');
  });
});
