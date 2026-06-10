import { describe, it, expect } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayMessage } from '@qlan-ro/mainframe-types';
import { convertMessage } from '../convert-message';
import { SANDBOX_CAPTURE_SENTINEL } from '../parse-captures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Part = Exclude<ThreadMessageLike['content'], string>[number];

function user(content: DisplayMessage['content'], metadata?: Record<string, unknown>): DisplayMessage {
  return {
    id: 'u1',
    chatId: 'c1',
    type: 'user',
    timestamp: '2026-06-10T00:00:00.000Z',
    content,
    metadata,
  };
}

function result(msg: DisplayMessage) {
  return convertMessage(msg) as ThreadMessageLike & {
    attachments?: Array<{ id: string; type: string; name: string; content: unknown[]; status: { type: string } }>;
    metadata?: {
      custom?: {
        mainframe?: {
          captures?: unknown;
          attachmentPreviews?: unknown;
          codeRef?: unknown;
          [key: string]: unknown;
        };
      };
    };
  };
}

function mainframe(msg: DisplayMessage) {
  return result(msg).metadata?.custom?.mainframe;
}

function contentParts(msg: DisplayMessage): Part[] {
  return result(msg).content as Part[];
}

// ---------------------------------------------------------------------------
// 1. Capture message — sentinel + trailing text
// ---------------------------------------------------------------------------

describe('convertMessage USER — sandbox captures', () => {
  it('parses capture rows into mainframe.captures and sets content to the trailing text', () => {
    const text =
      SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1` — selector `nav > .x`\n\nfix the spacing';
    const msg = user([{ type: 'text', text }]);
    const r = result(msg);

    expect(r.metadata?.custom?.mainframe?.captures).toEqual([
      { label: 'element1', imageName: 'element1.png', selector: 'nav > .x' },
    ]);

    const textParts = contentParts(msg).filter((p): p is Part & { type: 'text'; text: string } => p.type === 'text');
    expect(textParts).toHaveLength(1);
    expect(textParts[0]!.text).toBe('fix the spacing');
  });

  // ---------------------------------------------------------------------------
  // 2. Capture-only message — no trailing text, ensureNonEmpty invariant
  // ---------------------------------------------------------------------------

  it('produces captures metadata and at least one content part when there is no trailing text', () => {
    const text = SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1`';
    const msg = user([{ type: 'text', text }]);
    const r = result(msg);

    expect((r.metadata?.custom?.mainframe?.captures as Array<{ label: string }> | undefined)?.[0]?.label).toBe(
      'element1',
    );

    // ensureNonEmpty must guarantee at least one part even when rest is empty.
    expect(contentParts(msg).length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // 3. Non-capture plain text — no captures key
  // ---------------------------------------------------------------------------

  it('passes plain text through unchanged with no captures metadata', () => {
    const msg = user([{ type: 'text', text: 'hello' }]);
    const mf = mainframe(msg);

    // Either mainframe is absent entirely or it has no captures key.
    expect(mf?.captures).toBeUndefined();

    const textParts = contentParts(msg).filter((p): p is Part & { type: 'text'; text: string } => p.type === 'text');
    expect(textParts[0]!.text).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// 4. Native file attachments — images excluded, attachmentPreviews include all
// ---------------------------------------------------------------------------

describe('convertMessage USER — native file attachments', () => {
  it('adds only file-kind entries to result.attachments, images are excluded; attachmentPreviews includes both', () => {
    const msg = user([{ type: 'text', text: 'look' }], {
      attachments: [
        { name: 'seed.json', kind: 'file', sizeBytes: 2100 },
        { name: 'shot.png', kind: 'image' },
      ],
    });
    const r = result(msg);

    expect(r.attachments).toHaveLength(1);
    expect(r.attachments![0]).toEqual({
      id: 'seed.json',
      type: 'file',
      name: 'seed.json',
      contentType: 'application/octet-stream',
      content: [],
      status: { type: 'complete' },
    });

    expect(r.metadata?.custom?.mainframe?.attachmentPreviews).toEqual([
      { name: 'seed.json', kind: 'file', sizeBytes: 2100 },
      { name: 'shot.png', kind: 'image' },
    ]);
  });

  it('sets contentType from the preview mediaType, falling back to octet-stream for replay files', () => {
    const msg = user([{ type: 'text', text: 'x' }], {
      attachments: [{ name: 'doc.pdf', kind: 'file', sizeBytes: 9000, mediaType: 'application/pdf' }],
      attachedFiles: [{ name: 'extra.log' }],
    });
    const r = result(msg);

    const byName = Object.fromEntries((r.attachments ?? []).map((a) => [a.name, a.contentType]));
    expect(byName['doc.pdf']).toBe('application/pdf');
    expect(byName['extra.log']).toBe('application/octet-stream');
    expect(r.metadata?.custom?.mainframe?.attachmentPreviews).toEqual([
      { name: 'doc.pdf', kind: 'file', sizeBytes: 9000, mediaType: 'application/pdf' },
    ]);
  });

  // ---------------------------------------------------------------------------
  // 5. Dedup: attachments from metadata.attachments + metadata.attachedFiles
  // ---------------------------------------------------------------------------

  it('merges metadata.attachments(file) and metadata.attachedFiles deduped by name, in order', () => {
    const msg = user([{ type: 'text', text: 'x' }], {
      attachments: [{ name: 'seed.json', kind: 'file', sizeBytes: 2100 }],
      attachedFiles: [{ name: 'seed.json' }, { name: 'extra.log' }],
    });
    const r = result(msg);

    const names = (r.attachments ?? []).map((a) => a.name);
    expect(names).toEqual(['seed.json', 'extra.log']);
  });

  // ---------------------------------------------------------------------------
  // 6. Malformed attachments — null, missing name, wrong kind, invalid name type
  // ---------------------------------------------------------------------------

  it('silently skips malformed attachment entries and keeps only well-formed file ones', () => {
    const msg = user([{ type: 'text', text: 'x' }], {
      attachments: [
        null,
        { kind: 'file' }, // missing name
        { name: 42, kind: 'file' }, // name is not a string
        { name: 'ok.ts', kind: 'file' },
        { name: 'weird', kind: 'bogus' },
      ],
    });
    const r = result(msg);

    // Only ok.ts survives in native attachments.
    expect((r.attachments ?? []).map((a) => a.name)).toEqual(['ok.ts']);

    // Only ok.ts survives in previews (bogus kind + missing name + null all dropped).
    expect(r.metadata?.custom?.mainframe?.attachmentPreviews).toEqual([{ name: 'ok.ts', kind: 'file' }]);

    // Must not throw — already verified by reaching this line.
  });

  // ---------------------------------------------------------------------------
  // 9. Mixed-image order regression — attachmentPreviews preserves insertion order
  // ---------------------------------------------------------------------------

  it('attachmentPreviews preserves original order for image-kind entries', () => {
    const msg = user([{ type: 'text', text: 'x' }], {
      attachments: [
        { name: 'photo.png', kind: 'image' },
        { name: 'element1.png', kind: 'image' },
      ],
    });
    const r = result(msg);

    const previews = r.metadata?.custom?.mainframe?.attachmentPreviews as
      | Array<{ name: string; kind: string }>
      | undefined;
    expect(previews).toEqual([
      { name: 'photo.png', kind: 'image' },
      { name: 'element1.png', kind: 'image' },
    ]);

    // element1.png is specifically at index 1.
    expect(previews?.[1]?.name).toBe('element1.png');
  });
});

// ---------------------------------------------------------------------------
// 10. Capture message — image content block becomes a native image attachment
// ---------------------------------------------------------------------------

describe('convertMessage USER — capture image attachments', () => {
  it('routes the image block into a native image attachment (not a content part) when the text starts with the capture sentinel', () => {
    const text = SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1` — selector `nav > .x`';
    const msg = user([
      { type: 'text', text },
      { type: 'image', mediaType: 'image/png', data: 'AAAA' },
    ]);
    const r = result(msg);

    // The capture image must appear as a native attachment, not as an image content part.
    const imageParts = contentParts(msg).filter((p) => p.type === 'image');
    expect(imageParts).toHaveLength(0);

    expect(r.attachments).toHaveLength(1);
    expect(r.attachments![0]).toEqual({
      id: 'element1.png',
      type: 'image',
      name: 'element1.png',
      contentType: 'image/png',
      content: [{ type: 'image', image: 'data:image/png;base64,AAAA' }],
      status: { type: 'complete' },
    });

    // capture row is also reflected in metadata.
    expect(r.metadata?.custom?.mainframe?.captures).toEqual([
      { label: 'element1', imageName: 'element1.png', selector: 'nav > .x' },
    ]);
  });

  it('maps two capture rows to two image attachments in order with correct data URLs', () => {
    const text =
      SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1` — selector `nav > .x`\n> - `screenshot1`';
    const msg = user([
      { type: 'text', text },
      { type: 'image', mediaType: 'image/png', data: 'AAAA' },
      { type: 'image', mediaType: 'image/jpeg', data: 'BBBB' },
    ]);
    const r = result(msg);

    expect(r.attachments).toHaveLength(2);
    expect(r.attachments![0]).toEqual({
      id: 'element1.png',
      type: 'image',
      name: 'element1.png',
      contentType: 'image/png',
      content: [{ type: 'image', image: 'data:image/png;base64,AAAA' }],
      status: { type: 'complete' },
    });
    expect(r.attachments![1]).toEqual({
      id: 'screenshot1.png',
      type: 'image',
      name: 'screenshot1.png',
      contentType: 'image/jpeg',
      content: [{ type: 'image', image: 'data:image/jpeg;base64,BBBB' }],
      status: { type: 'complete' },
    });
  });

  it('keeps an image block as a plain image content part (not an attachment) when there is no capture sentinel', () => {
    const msg = user([
      { type: 'text', text: 'hi' },
      { type: 'image', mediaType: 'image/png', data: 'AAAA' },
    ]);
    const r = result(msg);

    const imageParts = (r.content as Array<{ type: string; image?: string }>).filter((p) => p.type === 'image');
    expect(imageParts).toHaveLength(1);
    expect(imageParts[0]!.image).toBe('data:image/png;base64,AAAA');

    // No image attachments added.
    const imageAttachments = (r.attachments ?? []).filter((a) => a.type === 'image');
    expect(imageAttachments).toHaveLength(0);
  });

  it('falls back to capture-N.png name when there are more images than capture rows', () => {
    const text = SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1` — selector `nav > .x`';
    const msg = user([
      { type: 'text', text },
      { type: 'image', mediaType: 'image/png', data: 'AAAA' },
      { type: 'image', mediaType: 'image/png', data: 'BBBB' },
    ]);
    const r = result(msg);

    expect(r.attachments).toHaveLength(2);
    expect(r.attachments![0]!.name).toBe('element1.png');
    expect(r.attachments![1]!.name).toBe('capture-2.png');
  });
});

// ---------------------------------------------------------------------------
// 7. codeRef — valid shape is forwarded intact
// ---------------------------------------------------------------------------

describe('convertMessage USER — codeRef metadata', () => {
  it('passes a well-formed codeRef through to mainframe.codeRef', () => {
    const msg = user([{ type: 'text', text: 'review' }], {
      codeRef: { file: 'Layout.tsx', range: { start: 42, end: 46 }, code: 'const a = 1;' },
    });

    expect(mainframe(msg)?.codeRef).toEqual({
      file: 'Layout.tsx',
      range: { start: 42, end: 46 },
      code: 'const a = 1;',
    });
  });

  // ---------------------------------------------------------------------------
  // 8a. Bad codeRef — missing file
  // ---------------------------------------------------------------------------

  it('omits codeRef when file is missing', () => {
    const msg = user([{ type: 'text', text: 'review' }], {
      codeRef: { range: { start: 42, end: 46 }, code: 'const a = 1;' },
    });

    expect(mainframe(msg)?.codeRef).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 8b. Bad codeRef — range.start is a string
  // ---------------------------------------------------------------------------

  it('omits codeRef when range.start is a string, not a number', () => {
    const msg = user([{ type: 'text', text: 'review' }], {
      codeRef: { file: 'Layout.tsx', range: { start: '42', end: 46 }, code: 'const a = 1;' },
    });

    expect(mainframe(msg)?.codeRef).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // 8c. Bad codeRef — codeRef is null
  // ---------------------------------------------------------------------------

  it('omits codeRef when codeRef is null', () => {
    const msg = user([{ type: 'text', text: 'review' }], {
      codeRef: null,
    });

    expect(mainframe(msg)?.codeRef).toBeUndefined();
  });
});
