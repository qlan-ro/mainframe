/**
 * editor-review-roundtrip — integration test proving the editor producer
 * (formatReview) and the chat parser (parseReviewComment) agree end-to-end.
 *
 * Strategy: call formatReview with concrete inputs, pass the result directly
 * to parseReviewComment, and assert deep-equal against hardcoded expected
 * ReviewComment shapes. No logic is recomputed from either module — every
 * expected value is stated directly.
 *
 * Behaviors covered:
 *  RT1 — single comment, single line, with content.
 *  RT2 — two comments: first single-line, second a multi-line range.
 */
import { describe, it, expect } from 'vitest';
import { formatReview } from '@/lib/editor/format-line-comment';
import { parseReviewComment } from '../parse-review-comment';

// ---------------------------------------------------------------------------
// RT1 — single comment round-trip
// ---------------------------------------------------------------------------

describe('editor review round-trip — single comment', () => {
  it('parseReviewComment(formatReview(...)) deep-equals the expected ReviewComment', () => {
    const text = formatReview('src/a.ts', [
      { startLine: 10, endLine: 10, lineContent: 'const x = 1;', comment: 'rename to userId' },
    ]);

    expect(parseReviewComment(text)).toEqual({
      file: 'src/a.ts',
      comments: [
        {
          start: 10,
          code: 'const x = 1;',
          body: 'rename to userId',
        },
      ],
    });
  });

  it('does NOT include an end key for a single-line comment', () => {
    const text = formatReview('src/a.ts', [
      { startLine: 10, endLine: 10, lineContent: 'const x = 1;', comment: 'rename to userId' },
    ]);
    const result = parseReviewComment(text);
    expect(result?.comments[0]).not.toHaveProperty('end');
  });
});

// ---------------------------------------------------------------------------
// RT2 — two comments round-trip
// ---------------------------------------------------------------------------

describe('editor review round-trip — two comments', () => {
  it('parseReviewComment(formatReview(...)) deep-equals the expected ReviewComment with 2 items', () => {
    const text = formatReview('src/a.ts', [
      { startLine: 5, endLine: 5, lineContent: 'return null;', comment: 'should throw instead' },
      { startLine: 20, endLine: 22, lineContent: 'if (a) {\n  b();\n}', comment: 'extract helper' },
    ]);

    expect(parseReviewComment(text)).toEqual({
      file: 'src/a.ts',
      comments: [
        {
          start: 5,
          code: 'return null;',
          body: 'should throw instead',
        },
        {
          start: 20,
          end: 22,
          code: 'if (a) {\n  b();\n}',
          body: 'extract helper',
        },
      ],
    });
  });

  it('returns exactly 2 comments', () => {
    const text = formatReview('src/a.ts', [
      { startLine: 5, endLine: 5, lineContent: 'return null;', comment: 'should throw instead' },
      { startLine: 20, endLine: 22, lineContent: 'if (a) {\n  b();\n}', comment: 'extract helper' },
    ]);
    expect(parseReviewComment(text)?.comments).toHaveLength(2);
  });
});
