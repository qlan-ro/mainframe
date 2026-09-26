/**
 * Behavior tests for result helpers:
 *   - isErrorResult  — shared pill-card error detection
 *   - extractResultContent — shared pill-card content extraction
 *   - resolveResultText — centralized 3-way result ladder
 *
 * Each test provides a concrete fixed input and asserts the exact return shape.
 * No logic from the implementation is re-derived here.
 */
import { describe, it, expect } from 'vitest';
import { resolveResultText, isErrorResult, extractResultContent, resultImages } from '../result';

// ---------------------------------------------------------------------------
// isErrorResult
// ---------------------------------------------------------------------------

describe('isErrorResult', () => {
  it('returns true when isError prop is true, regardless of result shape', () => {
    expect(isErrorResult('some text', true)).toBe(true);
  });

  it('returns true when result object has isError: true', () => {
    expect(isErrorResult({ isError: true }, undefined)).toBe(true);
  });

  it('returns true when both isError prop and result.isError are true', () => {
    expect(isErrorResult({ isError: true }, true)).toBe(true);
  });

  it('returns false when isError prop is false and result has no isError flag', () => {
    expect(isErrorResult({ content: 'ok' }, false)).toBe(false);
  });

  it('returns false when result object has isError: false', () => {
    expect(isErrorResult({ isError: false }, undefined)).toBe(false);
  });

  it('returns false for a plain string result with no isError prop', () => {
    expect(isErrorResult('plain result', undefined)).toBe(false);
  });

  it('returns false for undefined result with no isError prop', () => {
    expect(isErrorResult(undefined, undefined)).toBe(false);
  });

  it('returns false for null result with no isError prop', () => {
    expect(isErrorResult(null, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractResultContent
// ---------------------------------------------------------------------------

describe('extractResultContent', () => {
  it('returns the string directly when result is a plain string', () => {
    expect(extractResultContent('hello')).toBe('hello');
  });

  it('returns empty string for an empty string', () => {
    expect(extractResultContent('')).toBe('');
  });

  it('returns the .content field when result is an object with a string content', () => {
    expect(extractResultContent({ content: 'tool output' })).toBe('tool output');
  });

  it('returns empty string when result is an object whose .content is not a string', () => {
    expect(extractResultContent({ content: 42 })).toBe('');
  });

  it('returns empty string when result is an object without a .content field', () => {
    expect(extractResultContent({ isError: true })).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(extractResultContent(undefined)).toBe('');
  });

  it('returns empty string for null', () => {
    expect(extractResultContent(null)).toBe('');
  });

  it('returns empty string for a number', () => {
    expect(extractResultContent(123)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Plain string
// ---------------------------------------------------------------------------

describe('resolveResultText — plain string', () => {
  it('returns the string as text with truncated=false and fullBytes=0', () => {
    expect(resolveResultText('hello world')).toEqual({ text: 'hello world', truncated: false, fullBytes: 0 });
  });

  it('strips <error> sentinel tags from a plain string', () => {
    expect(resolveResultText('<error>file not found</error>')).toEqual({
      text: 'file not found',
      truncated: false,
      fullBytes: 0,
    });
  });

  it('returns empty text for an empty string', () => {
    expect(resolveResultText('')).toEqual({ text: '', truncated: false, fullBytes: 0 });
  });
});

// ---------------------------------------------------------------------------
// TruncatedResult (has .truncated=true + .content + .fullBytes)
// ---------------------------------------------------------------------------

describe('resolveResultText — TruncatedResult', () => {
  it('returns content as text, truncated=true, and the fullBytes count', () => {
    const truncated = { content: 'first 500 chars…', truncated: true as const, fullBytes: 8192 };
    expect(resolveResultText(truncated)).toEqual({ text: 'first 500 chars…', truncated: true, fullBytes: 8192 });
  });

  it('strips <error> tags from truncated content', () => {
    const truncated = { content: '<error>truncated output</error>', truncated: true as const, fullBytes: 1024 };
    expect(resolveResultText(truncated)).toEqual({ text: 'truncated output', truncated: true, fullBytes: 1024 });
  });
});

// ---------------------------------------------------------------------------
// ToolCallResult (has .content + .structuredPatch — the structured diff shape)
// ---------------------------------------------------------------------------

describe('resolveResultText — ToolCallResult (structured)', () => {
  it('returns .content as text with truncated=false when result has structuredPatch', () => {
    const structured = { content: 'file written', structuredPatch: [], isError: false };
    expect(resolveResultText(structured)).toEqual({ text: 'file written', truncated: false, fullBytes: 0 });
  });

  it('strips <error> tags from ToolCallResult.content', () => {
    const structured = {
      content: '<tool_use_error>write failed</tool_use_error>',
      structuredPatch: [],
      isError: true,
    };
    expect(resolveResultText(structured)).toEqual({ text: 'write failed', truncated: false, fullBytes: 0 });
  });
});

// ---------------------------------------------------------------------------
// resultImages / resolveResultText — image-carrying result (todo #363)
// ---------------------------------------------------------------------------

describe('resultImages', () => {
  it('returns the images array from an object result', () => {
    const result = { content: 'tmp/p1.png', images: [{ mediaType: 'image/png', data: 'b64' }] };
    expect(resultImages(result)).toEqual([{ mediaType: 'image/png', data: 'b64' }]);
  });

  it('returns [] when the result has no images field', () => {
    expect(resultImages({ content: 'ok' })).toEqual([]);
  });

  it('returns [] for a plain string, undefined, or null', () => {
    expect(resultImages('hello')).toEqual([]);
    expect(resultImages(undefined)).toEqual([]);
    expect(resultImages(null)).toEqual([]);
  });
});

describe('resolveResultText — image-carrying result', () => {
  it('returns .content as text with no JSON and no base64 leak', () => {
    const result = { content: 'tmp/p1.png', images: [{ mediaType: 'image/png', data: 'b64-secret' }] };
    expect(resolveResultText(result)).toEqual({ text: 'tmp/p1.png', truncated: false, fullBytes: 0 });
  });

  it('strips <error> tags from an image-carrying result content', () => {
    const result = { content: '<error>read failed</error>', images: [{ mediaType: 'image/png', data: 'b64' }] };
    expect(resolveResultText(result)).toEqual({ text: 'read failed', truncated: false, fullBytes: 0 });
  });

  it('an empty images array falls through to the JSON.stringify branch, not the image branch', () => {
    const result = { files: ['a.ts'], images: [] };
    const resolved = resolveResultText(result);
    expect(resolved.text).toContain('"files"');
  });
});

// ---------------------------------------------------------------------------
// Non-string / non-object edge cases
// ---------------------------------------------------------------------------

describe('resolveResultText — other shapes', () => {
  it('JSON.stringifies a plain object that is neither ToolCallResult nor TruncatedResult', () => {
    const obj = { files: ['a.ts', 'b.ts'] };
    const result = resolveResultText(obj);
    expect(result.truncated).toBe(false);
    expect(result.fullBytes).toBe(0);
    // The text must include the field name — exact formatting is JSON.stringify(obj,null,2)
    expect(result.text).toContain('"files"');
    expect(result.text).toContain('"a.ts"');
  });

  it('returns empty text for undefined', () => {
    expect(resolveResultText(undefined)).toEqual({ text: '', truncated: false, fullBytes: 0 });
  });

  it('returns empty text for null', () => {
    expect(resolveResultText(null)).toEqual({ text: '', truncated: false, fullBytes: 0 });
  });
});
