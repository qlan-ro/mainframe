/**
 * Unit tests for lib/files/file-href.ts — the file-vs-web-link classifier.
 *
 * Table-driven over the rules in the #355 plan (resolution 2). Run FIRST;
 * the implementation must make them green.
 */
import { describe, expect, it } from 'vitest';
import { parseFileHref } from '../file-href';

describe('parseFileHref — accepts file targets', () => {
  it.each([
    ['file:///a/b.ts', 'file:///a/b.ts'],
    ['/abs/path', '/abs/path'],
    ['./x', './x'],
    ['../x', '../x'],
    ['.github/pull_request_template.md', '.github/pull_request_template.md'],
    ['.changeset/x.md', '.changeset/x.md'],
    ['a/b.ts', 'a/b.ts'],
    ['README.md', 'README.md'],
  ])('%s -> path %s, no line/character', (href, expectedPath) => {
    expect(parseFileHref(href)).toEqual({ path: expectedPath, line: undefined, character: undefined });
  });

  it('decodes a percent-encoded non-file path', () => {
    expect(parseFileHref('/Application%20Support/foo')).toEqual({
      path: '/Application Support/foo',
      line: undefined,
      character: undefined,
    });
  });

  it('leaves a file:// target undecoded (toFileRef decodes it)', () => {
    expect(parseFileHref('file:///Application%20Support/foo')).toEqual({
      path: 'file:///Application%20Support/foo',
      line: undefined,
      character: undefined,
    });
  });
});

describe('parseFileHref — line/character suffix', () => {
  it('splits :line into a 0-based line, character 0', () => {
    expect(parseFileHref('/abs/a.ts:42')).toEqual({ path: '/abs/a.ts', line: 41, character: 0 });
  });

  it('splits :line:col into 0-based line and character', () => {
    expect(parseFileHref('/abs/a.ts:42:7')).toEqual({ path: '/abs/a.ts', line: 41, character: 6 });
  });

  it('clamps :0 at 0 instead of producing -1', () => {
    expect(parseFileHref('/abs/a.ts:0')).toEqual({ path: '/abs/a.ts', line: 0, character: 0 });
  });

  it('clamps a :line:0 column at 0', () => {
    expect(parseFileHref('/abs/a.ts:5:0')).toEqual({ path: '/abs/a.ts', line: 4, character: 0 });
  });

  it('splits the suffix off a file:// target too', () => {
    expect(parseFileHref('file:///a/b.ts:42:7')).toEqual({ path: 'file:///a/b.ts', line: 41, character: 6 });
  });
});

describe('parseFileHref — rejects non-file hrefs', () => {
  it.each([
    ['http://example.com'],
    ['https://example.com'],
    ['mailto:someone@example.com'],
    ['slack://channel'],
    ['#anchor'],
    ['?q=1'],
    ['example.com/page'],
    [''],
  ])('%s -> null', (href) => {
    expect(parseFileHref(href)).toBeNull();
  });
});
