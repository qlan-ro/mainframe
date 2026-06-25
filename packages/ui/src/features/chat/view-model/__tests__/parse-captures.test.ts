import { describe, it, expect } from 'vitest';
import { SANDBOX_CAPTURE_SENTINEL, parseSandboxCaptureBlock } from '../parse-captures';

// ---------------------------------------------------------------------------
// Helpers — build sentinel-prefixed strings using the exported constant so the
// \0 byte is always correct and tests never drift from the real sentinel value.
// ---------------------------------------------------------------------------

function block(...lines: string[]): string {
  return SANDBOX_CAPTURE_SENTINEL + '\n' + lines.join('\n');
}

const HEADER = '> **Preview captures**';
const ROW_ELEMENT = '> - `element1` — selector `nav.sidebar > .rail-icon`';
const ROW_SCREENSHOT = '> - `screenshot1`';

// ---------------------------------------------------------------------------

describe('parseSandboxCaptureBlock — null when no sentinel', () => {
  it('returns null for plain text with no sentinel', () => {
    expect(parseSandboxCaptureBlock('hello world')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSandboxCaptureBlock('')).toBeNull();
  });

  it('returns null when sentinel appears mid-string, not at the start', () => {
    expect(parseSandboxCaptureBlock('see ' + SANDBOX_CAPTURE_SENTINEL + ' here')).toBeNull();
  });
});

describe('parseSandboxCaptureBlock — single row with selector', () => {
  it('parses one element row with selector, rest is empty', () => {
    const input = block(HEADER, ROW_ELEMENT);
    const result = parseSandboxCaptureBlock(input);
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([
      { label: 'element1', imageName: 'element1.png', selector: 'nav.sidebar > .rail-icon' },
    ]);
    expect(result!.rest).toBe('');
  });
});

describe('parseSandboxCaptureBlock — multiple rows and trailing user text', () => {
  it('parses two rows and captures trailing text as rest', () => {
    const input = block(HEADER, ROW_ELEMENT, ROW_SCREENSHOT, '', 'fix the spacing');
    const result = parseSandboxCaptureBlock(input);
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([
      { label: 'element1', imageName: 'element1.png', selector: 'nav.sidebar > .rail-icon' },
      { label: 'screenshot1', imageName: 'screenshot1.png' },
    ]);
    expect(result!.rest).toBe('fix the spacing');
  });
});

describe('parseSandboxCaptureBlock — annotation-only row', () => {
  it('parses a row with annotation but no selector', () => {
    const input = block(HEADER, '> - `element1` — "make it bigger"');
    const result = parseSandboxCaptureBlock(input);
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([{ label: 'element1', imageName: 'element1.png', annotation: 'make it bigger' }]);
    expect(result!.rest).toBe('');
  });
});

describe('parseSandboxCaptureBlock — row with both selector and annotation', () => {
  it('sets both selector and annotation when both are present', () => {
    const input = block(HEADER, '> - `element1` — selector `div.card > h2` — "note here"');
    const result = parseSandboxCaptureBlock(input);
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([
      {
        label: 'element1',
        imageName: 'element1.png',
        selector: 'div.card > h2',
        annotation: 'note here',
      },
    ]);
    expect(result!.rest).toBe('');
  });
});

describe('parseSandboxCaptureBlock — malformed row stops parsing immediately', () => {
  it('returns zero rows and the malformed line as rest', () => {
    const input = block(HEADER, 'just some text, no row marker');
    const result = parseSandboxCaptureBlock(input);
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([]);
    expect(result!.rest).toBe('just some text, no row marker');
  });
});

describe('parseSandboxCaptureBlock — valid rows followed by malformed line and more text', () => {
  it('parses exactly the valid leading rows, rest contains malformed line and continuation', () => {
    const input = block(HEADER, ROW_ELEMENT, ROW_SCREENSHOT, 'not a valid row', 'more text below');
    const result = parseSandboxCaptureBlock(input);
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([
      { label: 'element1', imageName: 'element1.png', selector: 'nav.sidebar > .rail-icon' },
      { label: 'screenshot1', imageName: 'screenshot1.png' },
    ]);
    expect(result!.rest).toBe('not a valid row\nmore text below');
  });
});
