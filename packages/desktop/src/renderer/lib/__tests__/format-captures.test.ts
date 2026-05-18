import { describe, it, expect } from 'vitest';
import {
  formatCaptures,
  SANDBOX_CAPTURE_SENTINEL,
  parseSandboxCaptureBlock,
  capturesToRows,
} from '../format-captures.js';

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

describe('capturesToRows', () => {
  it('uses the same labels as formatCaptures and maps id/image by label', () => {
    const caps = [
      { id: 'i1', type: 'element' as const, imageDataUrl: 'data:,A', selector: 'a > b' },
      { id: 's1', type: 'screenshot' as const, imageDataUrl: 'data:,B', annotation: 'note' },
      { id: 'i2', type: 'element' as const, imageDataUrl: 'data:,C' },
    ];
    const { rows, images, idByLabel } = capturesToRows(caps);
    expect(rows).toEqual([
      { label: 'element1', imageName: 'element1.png', selector: 'a > b' },
      { label: 'screenshot1', imageName: 'screenshot1.png', annotation: 'note' },
      { label: 'element2', imageName: 'element2.png' },
    ]);
    expect(images).toEqual({ 'element1.png': 'data:,A', 'screenshot1.png': 'data:,B', 'element2.png': 'data:,C' });
    expect(idByLabel).toEqual({ element1: 'i1', screenshot1: 's1', element2: 'i2' });
  });
});
