/**
 * Behavior tests for toUploadItems.
 *
 * Each test uses a concrete fixed CompleteAttachment input and asserts the
 * exact UploadAttachmentItem output — no logic from the implementation is
 * re-derived here.
 *
 * Shapes under test:
 *   - image content part  → { type:'image', image: '<data-url>' }
 *   - non-image (document/text) content part → { type:'text', text: '<data-url>' }
 *   - malformed / missing data-URL → attachment is skipped
 *   - empty attachments array / undefined → returns []
 */
import { describe, it, expect } from 'vitest';
import { toUploadItems } from '../attachment-adapter';

// ---------------------------------------------------------------------------
// Helpers — build minimal CompleteAttachment-compatible objects
// ---------------------------------------------------------------------------

/** The function accepts AppendMessage['attachments'] which is CompleteAttachment[]. */
type TestAttachment = Parameters<typeof toUploadItems>[0];

function makeImage(name: string, mediaType: string, b64: string): NonNullable<TestAttachment>[number] {
  return {
    id: 'att-img',
    type: 'image',
    name,
    contentType: mediaType,
    status: { type: 'complete' },
    content: [{ type: 'image', image: `data:${mediaType};base64,${b64}` }],
  };
}

function makeDocument(name: string, mediaType: string, b64: string): NonNullable<TestAttachment>[number] {
  return {
    id: 'att-doc',
    type: 'document',
    name,
    contentType: mediaType,
    status: { type: 'complete' },
    // Non-image attachments are stored as text parts carrying the data-URL.
    content: [{ type: 'text', text: `data:${mediaType};base64,${b64}` }],
  };
}

// ---------------------------------------------------------------------------
// Empty / null input
// ---------------------------------------------------------------------------

describe('toUploadItems — empty / missing input', () => {
  it('returns [] for an empty array', () => {
    expect(toUploadItems([])).toEqual([]);
  });

  it('returns [] for undefined (nullish attachments field)', () => {
    expect(toUploadItems(undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Image attachment
// ---------------------------------------------------------------------------

describe('toUploadItems — image attachment', () => {
  it('maps an image part to { name, mediaType, data } stripping the data: prefix', () => {
    const att = makeImage('photo.png', 'image/png', 'aGVsbG8=');
    expect(toUploadItems([att])).toEqual([{ name: 'photo.png', mediaType: 'image/png', data: 'aGVsbG8=' }]);
  });

  it('preserves the exact base64 payload without truncation', () => {
    const longB64 = 'AAAA'.repeat(100); // 400-char payload
    const att = makeImage('big.jpg', 'image/jpeg', longB64);
    const result = toUploadItems([att]);
    expect(result[0]!.data).toBe(longB64);
  });

  it('does NOT include sizeBytes or kind in the output', () => {
    const att = makeImage('icon.gif', 'image/gif', 'R0lGODlh');
    const [item] = toUploadItems([att]);
    expect(item).not.toHaveProperty('sizeBytes');
    expect(item).not.toHaveProperty('kind');
  });
});

// ---------------------------------------------------------------------------
// Non-image (document / text-part) attachment
// ---------------------------------------------------------------------------

describe('toUploadItems — document attachment stored as text part', () => {
  it('maps a text-part data-URL to { name, mediaType, data } correctly', () => {
    const att = makeDocument('notes.pdf', 'application/pdf', 'JVBERi0=');
    expect(toUploadItems([att])).toEqual([{ name: 'notes.pdf', mediaType: 'application/pdf', data: 'JVBERi0=' }]);
  });

  it('handles a plain-text MIME type stored as a text content part', () => {
    const att = makeDocument('readme.txt', 'text/plain', 'aGVsbG8gd29ybGQ=');
    expect(toUploadItems([att])).toEqual([{ name: 'readme.txt', mediaType: 'text/plain', data: 'aGVsbG8gd29ybGQ=' }]);
  });
});

// ---------------------------------------------------------------------------
// Multiple attachments — order preserved
// ---------------------------------------------------------------------------

describe('toUploadItems — multiple attachments', () => {
  it('maps each attachment in input order', () => {
    const img = makeImage('a.png', 'image/png', 'AAAA');
    const doc = makeDocument('b.pdf', 'application/pdf', 'BBBB');
    expect(toUploadItems([img, doc])).toEqual([
      { name: 'a.png', mediaType: 'image/png', data: 'AAAA' },
      { name: 'b.pdf', mediaType: 'application/pdf', data: 'BBBB' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Malformed / missing data-URL — attachment is skipped
// ---------------------------------------------------------------------------

describe('toUploadItems — malformed data-URL skipping', () => {
  it('skips an attachment whose content is absent (no content array)', () => {
    const att = {
      id: 'att-no-content',
      type: 'image' as const,
      name: 'ghost.png',
      contentType: 'image/png',
      status: { type: 'complete' as const },
      content: [] as NonNullable<TestAttachment>[number]['content'],
    };
    expect(toUploadItems([att])).toEqual([]);
  });

  it('skips an attachment whose image part has no base64 segment (no semicolon)', () => {
    const att = {
      id: 'att-bad',
      type: 'image' as const,
      name: 'broken.png',
      contentType: 'image/png',
      status: { type: 'complete' as const },
      content: [{ type: 'image' as const, image: 'not-a-data-url' }],
    };
    expect(toUploadItems([att])).toEqual([]);
  });

  it('skips a malformed entry but still processes valid ones after it', () => {
    const bad = {
      id: 'att-bad',
      type: 'image' as const,
      name: 'broken.png',
      contentType: 'image/png',
      status: { type: 'complete' as const },
      content: [{ type: 'image' as const, image: 'invalid' }],
    };
    const good = makeDocument('ok.pdf', 'application/pdf', 'T0s=');
    expect(toUploadItems([bad, good])).toEqual([{ name: 'ok.pdf', mediaType: 'application/pdf', data: 'T0s=' }]);
  });
});
