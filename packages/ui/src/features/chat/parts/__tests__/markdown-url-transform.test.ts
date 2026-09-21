/**
 * Unit tests for the `urlTransform` widening (#355): a `file:` href must
 * survive the sanitiser when it reaches an `href` property, but the
 * relaxation is scoped to `key === 'href'` — an `img src="file://…"` must
 * still be stripped, since react-markdown runs the same transform over every
 * URL-valued property.
 */
import { describe, expect, it } from 'vitest';
import { urlTransform } from '../markdown-url-transform';

describe('urlTransform — file: hrefs', () => {
  it('leaves a file:// href untouched', () => {
    expect(urlTransform('file:///a/b.ts', 'href')).toBe('file:///a/b.ts');
  });

  it('still strips a file:// value on a non-href key (e.g. img src)', () => {
    expect(urlTransform('file:///a/b.ts', 'src')).toBe('');
  });
});

describe('urlTransform — unaffected paths', () => {
  it('passes an http(s) href through unchanged', () => {
    expect(urlTransform('https://example.com', 'href')).toBe('https://example.com');
  });

  it('keeps the existing app-protocol allowance regardless of key', () => {
    expect(urlTransform('slack://channel/123', 'href')).toBe('slack://channel/123');
    expect(urlTransform('slack://channel/123', 'src')).toBe('slack://channel/123');
  });

  it('still strips an unrelated unsafe scheme', () => {
    expect(urlTransform('javascript:alert(1)', 'href')).toBe('');
  });
});
