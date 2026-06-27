/**
 * parseReviewComment — behavior tests.
 *
 * Strategy: pure function; fixed inputs, hardcoded expectations.
 * No logic is recomputed from the implementation — every expected value is
 * stated directly.
 *
 * Behaviors covered:
 *  P1  — single comment with a fenced code block.
 *  P2  — two comments separated by \n\n---\n\n.
 *  P3  — "At lines N-M:" sets end on the returned item.
 *  P4  — no fence: code is '' and body is preserved.
 *  P5  — multiline comment body keeps its newlines.
 *  P6  — grown fence (4 backticks) quoting content that itself contains ```.
 *  P7  — multiline code inside the fence is preserved with newlines.
 *  P8a — plain text returns null.
 *  P8b — header present but comment part is not "At line …": null.
 *  P8c — fence present but NO comment body after it: null.
 *  P8d — "Diff of `x`" embedded mid-string (not at start): null.
 *  P9  — one valid part + one invalid part: null (strict, one bad poisons all).
 */
import { describe, it, expect } from 'vitest';
import { parseReviewComment } from '../parse-review-comment';

// ---------------------------------------------------------------------------
// P1 — single comment with fence
// ---------------------------------------------------------------------------

describe('parseReviewComment — single comment with fenced code block', () => {
  it('returns the file, start line, code, and body', () => {
    const text = 'Diff of `app/globals.css`\n\nAt line 43:\n```\n--mf-app-bg: #f4f4f2;\n```\ntoo bright';
    expect(parseReviewComment(text)).toEqual({
      file: 'app/globals.css',
      comments: [{ start: 43, code: '--mf-app-bg: #f4f4f2;', body: 'too bright' }],
    });
  });

  it('does NOT include an end key when only a single line is referenced', () => {
    const text = 'Diff of `app/globals.css`\n\nAt line 43:\n```\n--mf-app-bg: #f4f4f2;\n```\ntoo bright';
    const result = parseReviewComment(text);
    expect(result?.comments[0]).not.toHaveProperty('end');
  });
});

// ---------------------------------------------------------------------------
// P2 — two comments joined by \n\n---\n\n
// ---------------------------------------------------------------------------

describe('parseReviewComment — two comments separated by the divider', () => {
  it('returns an array of length 2', () => {
    const text =
      'Diff of `app/globals.css`\n\n' +
      'At line 43:\n```\n--mf-app-bg: #f4f4f2;\n```\ntoo bright' +
      '\n\n---\n\n' +
      'At lines 51-53:\n```\n.panel {\n  width: 200px;\n}\n```\nwrong width';
    const result = parseReviewComment(text);
    expect(result?.comments).toHaveLength(2);
  });

  it('first comment has start 43', () => {
    const text =
      'Diff of `app/globals.css`\n\n' +
      'At line 43:\n```\n--mf-app-bg: #f4f4f2;\n```\ntoo bright' +
      '\n\n---\n\n' +
      'At lines 51-53:\n```\n.panel {\n  width: 200px;\n}\n```\nwrong width';
    expect(parseReviewComment(text)?.comments[0]?.start).toBe(43);
  });

  it('second comment has start 51 and end 53', () => {
    const text =
      'Diff of `app/globals.css`\n\n' +
      'At line 43:\n```\n--mf-app-bg: #f4f4f2;\n```\ntoo bright' +
      '\n\n---\n\n' +
      'At lines 51-53:\n```\n.panel {\n  width: 200px;\n}\n```\nwrong width';
    const second = parseReviewComment(text)?.comments[1];
    expect(second?.start).toBe(51);
    expect(second?.end).toBe(53);
  });
});

// ---------------------------------------------------------------------------
// P3 — "At lines N-M:" sets end
// ---------------------------------------------------------------------------

describe('parseReviewComment — range "At lines N-M:" sets end', () => {
  it('sets end to 53 for "At lines 51-53:"', () => {
    const text = 'Diff of `a.ts`\n\nAt lines 51-53:\n```\nsome code\n```\na note';
    expect(parseReviewComment(text)?.comments[0]?.end).toBe(53);
  });

  it('sets start to 51 for "At lines 51-53:"', () => {
    const text = 'Diff of `a.ts`\n\nAt lines 51-53:\n```\nsome code\n```\na note';
    expect(parseReviewComment(text)?.comments[0]?.start).toBe(51);
  });
});

// ---------------------------------------------------------------------------
// P4 — no fence: code is '', body preserved
// ---------------------------------------------------------------------------

describe('parseReviewComment — no fence block', () => {
  it('sets code to empty string when there is no fenced block', () => {
    const text = 'Diff of `a.ts`\n\nAt line 7:\njust a note';
    expect(parseReviewComment(text)?.comments[0]?.code).toBe('');
  });

  it('sets body to the comment line verbatim when there is no fence', () => {
    const text = 'Diff of `a.ts`\n\nAt line 7:\njust a note';
    expect(parseReviewComment(text)?.comments[0]?.body).toBe('just a note');
  });
});

// ---------------------------------------------------------------------------
// P5 — multiline comment body keeps newlines
// ---------------------------------------------------------------------------

describe('parseReviewComment — multiline comment body', () => {
  it('preserves an internal newline in the body text', () => {
    const text = 'Diff of `a.ts`\n\nAt line 7:\n```\ncode\n```\nfirst line\nsecond line';
    expect(parseReviewComment(text)?.comments[0]?.body).toBe('first line\nsecond line');
  });
});

// ---------------------------------------------------------------------------
// P6 — grown fence (4 backticks) quoting content with ``` inside
// ---------------------------------------------------------------------------

describe('parseReviewComment — grown fence (4 backticks)', () => {
  it('extracts code that itself contains triple backticks', () => {
    const text = 'Diff of `b.md`\n\nAt line 2:\n````\ncode with ``` inside\n````\nfix it';
    expect(parseReviewComment(text)?.comments[0]?.code).toBe('code with ``` inside');
  });

  it('sets body to the text after the grown fence', () => {
    const text = 'Diff of `b.md`\n\nAt line 2:\n````\ncode with ``` inside\n````\nfix it';
    expect(parseReviewComment(text)?.comments[0]?.body).toBe('fix it');
  });
});

// ---------------------------------------------------------------------------
// P7 — multiline code inside fence preserved with newlines
// ---------------------------------------------------------------------------

describe('parseReviewComment — multiline code inside fence', () => {
  it('preserves newlines inside the fenced code block', () => {
    const text = 'Diff of `a.ts`\n\nAt lines 10-11:\n```\nline one\nline two\n```\nfix it';
    expect(parseReviewComment(text)?.comments[0]?.code).toBe('line one\nline two');
  });
});

// ---------------------------------------------------------------------------
// P8 — strict fallbacks → null
// ---------------------------------------------------------------------------

describe('parseReviewComment — strict fallbacks return null', () => {
  it('P8a — plain text with no "Diff of" header returns null', () => {
    expect(parseReviewComment('hello')).toBeNull();
  });

  it('P8b — header present but part does not start with "At line": null', () => {
    expect(parseReviewComment('Diff of `x.ts`\n\nnot a comment part')).toBeNull();
  });

  it('P8c — fence present but no body after closing fence returns null', () => {
    expect(parseReviewComment('Diff of `x.ts`\n\nAt line 5:\n```\ncode\n```')).toBeNull();
  });

  it('P8d — "Diff of `x`" embedded mid-string (not at start) returns null', () => {
    expect(parseReviewComment('Some prefix\nDiff of `x.ts`\n\nAt line 5:\n```\ncode\n```\nbody')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P9 — one valid part + one invalid part poisons the whole parse
// ---------------------------------------------------------------------------

describe('parseReviewComment — mixed valid+invalid parts', () => {
  it('returns null when a second "At line …" part is malformed (fence but no body)', () => {
    // The divider must be followed by an "At line" header to count as a part
    // boundary; this second part starts with one but has no body after its
    // fence, so the strict parse poisons the whole message.
    const text =
      'Diff of `x.ts`\n\n' +
      'At line 5:\n```\ncode\n```\nvalid body' +
      '\n\n---\n\n' +
      'At line 9:\n```\nmore code\n```';
    expect(parseReviewComment(text)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P11 — a "---" divider inside a comment body must NOT over-split the review
// (only a divider followed by an "At line N" header is a part boundary)
// ---------------------------------------------------------------------------

describe('parseReviewComment — divider inside a comment body', () => {
  it('keeps an in-body horizontal rule in the first comment instead of splitting', () => {
    const text =
      'File: `a.ts`\n\n' +
      'At line 1:\n```\nx\n```\nbefore\n\n---\n\nafter' +
      '\n\n---\n\n' +
      'At line 5:\n```\ny\n```\nsecond';
    const out = parseReviewComment(text);
    expect(out?.comments).toHaveLength(2);
    expect(out?.comments[0]).toEqual({ start: 1, code: 'x', body: 'before\n\n---\n\nafter' });
    expect(out?.comments[1]).toEqual({ start: 5, code: 'y', body: 'second' });
  });

  it('keeps a trailing in-body --- in a single-comment review', () => {
    const out = parseReviewComment('File: `a.ts`\n\nAt line 1:\n```\nx\n```\nnote\n\n---\n\nmore');
    expect(out).toEqual({ file: 'a.ts', comments: [{ start: 1, code: 'x', body: 'note\n\n---\n\nmore' }] });
  });
});

// ---------------------------------------------------------------------------
// P10 — File: header (editor producer)
// ---------------------------------------------------------------------------

describe('parseReviewComment — File: header (editor producer)', () => {
  it('parses a File: header (single comment)', () => {
    const out = parseReviewComment('File: `src/a.ts`\n\nAt line 5:\n```\nconst x = 1;\n```\nwhy?');
    expect(out).toEqual({ file: 'src/a.ts', comments: [{ start: 5, code: 'const x = 1;', body: 'why?' }] });
  });

  it('parses a File: header (multi-comment, joined by ---)', () => {
    const out = parseReviewComment(
      'File: `a.ts`\n\nAt line 1:\n```\nx\n```\none\n\n---\n\nAt lines 4-5:\n```\ny\nz\n```\ntwo',
    );
    expect(out?.comments).toHaveLength(2);
    expect(out?.comments[1]).toEqual({ start: 4, end: 5, code: 'y\nz', body: 'two' });
  });
});
