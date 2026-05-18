import { describe, it, expect } from 'vitest';
import { formatCaptures, SANDBOX_CAPTURE_SENTINEL, parseSandboxCaptureBlock } from '../format-captures.js';

const img = 'data:image/png;base64,QUJD'; // base64 "ABC" -> 3 bytes

describe('formatCaptures', () => {
  it('returns empty for no captures', () => {
    expect(formatCaptures([])).toEqual({ markdown: '', attachments: [] });
  });

  it('formats element + screenshot into sentinel markdown list + named attachments', () => {
    const { markdown, attachments } = formatCaptures([
      { id: 'a', type: 'element', imageDataUrl: img, selector: 'div.card > h2' },
      { id: 'b', type: 'screenshot', imageDataUrl: img, annotation: 'the header' },
    ]);
    expect(markdown.startsWith(SANDBOX_CAPTURE_SENTINEL + '\n')).toBe(true);
    expect(markdown).toContain('> **Preview captures**');
    expect(markdown).toContain('> - `element1` — selector `div.card > h2`');
    expect(markdown).toContain('> - `screenshot1` — "the header"');
    expect(attachments).toEqual([
      { name: 'element1.png', mediaType: 'image/png', sizeBytes: 3, kind: 'image', data: 'QUJD' },
      { name: 'screenshot1.png', mediaType: 'image/png', sizeBytes: 3, kind: 'image', data: 'QUJD' },
    ]);
  });
});

describe('parseSandboxCaptureBlock', () => {
  it('parses rows from a sentinel block, ignores trailing user text', () => {
    const { markdown } = formatCaptures([
      { id: 'a', type: 'element', imageDataUrl: img, selector: 'div.card > h2', annotation: 'note' },
      { id: 'b', type: 'screenshot', imageDataUrl: img },
    ]);
    const res = parseSandboxCaptureBlock(markdown + '\nplease fix this');
    expect(res).not.toBeNull();
    expect(res!.rows).toEqual([
      { label: 'element1', imageName: 'element1.png', selector: 'div.card > h2', annotation: 'note' },
      { label: 'screenshot1', imageName: 'screenshot1.png' },
    ]);
    expect(res!.rest).toBe('please fix this');
  });

  it('returns null when no sentinel present', () => {
    expect(parseSandboxCaptureBlock('just a normal message')).toBeNull();
  });
});
