/**
 * convertUserContainer / coerceUserMeta — direct unit tests.
 *
 * convert-acp-item.test.ts already pins the headline capture/file-attachment/
 * review-comment/coerceUserMeta behaviors through the full convertAcpItems
 * pipeline. This file adds the edge cases convert-message-user-extras.test.ts
 * (deleted with convert-message.ts) covered that aren't duplicated there:
 * multi-capture-row ordering, the capture-N.png fallback name, malformed
 * attachment-entry filtering, dedup ordering, and null/undefined metadata.
 */
import { describe, it, expect } from 'vitest';
import type { ContentBlock } from '@qlan-ro/mainframe-types';
import { coerceUserMeta, convertUserContainer } from '../convert-acp-user';
import { SANDBOX_CAPTURE_SENTINEL } from '../../markers/message-markers';

const BASE = { id: 'u1', createdAt: new Date('2026-08-28T00:00:00.000Z') };

function textBlock(text: string): ContentBlock {
  return { type: 'text', text };
}

function imageBlock(mimeType: string, data: string): ContentBlock {
  return { type: 'image', mimeType, data };
}

describe('convertUserContainer — multi-capture image ordering', () => {
  it('maps two capture rows to two image attachments in order with correct data URLs', () => {
    const text =
      SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1` — selector `nav > .x`\n> - `screenshot1`';
    const blocks: ContentBlock[] = [textBlock(text), imageBlock('image/png', 'AAAA'), imageBlock('image/jpeg', 'BBBB')];

    const container = convertUserContainer(blocks, undefined, BASE);

    expect(container.attachments).toEqual([
      {
        id: 'element1.png',
        type: 'image',
        name: 'element1.png',
        contentType: 'image/png',
        content: [{ type: 'image', image: 'data:image/png;base64,AAAA' }],
        status: { type: 'complete' },
      },
      {
        id: 'screenshot1.png',
        type: 'image',
        name: 'screenshot1.png',
        contentType: 'image/jpeg',
        content: [{ type: 'image', image: 'data:image/jpeg;base64,BBBB' }],
        status: { type: 'complete' },
      },
    ]);
  });

  it('falls back to capture-N.png when there are more images than capture rows', () => {
    const text = SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1` — selector `nav > .x`';
    const blocks: ContentBlock[] = [textBlock(text), imageBlock('image/png', 'AAAA'), imageBlock('image/png', 'BBBB')];

    const container = convertUserContainer(blocks, undefined, BASE);

    expect(container.attachments).toHaveLength(2);
    expect(container.attachments![0]!.name).toBe('element1.png');
    expect(container.attachments![1]!.name).toBe('capture-2.png');
  });
});

describe('convertUserContainer — file attachment merge/dedup', () => {
  it('merges metadata.attachments(file) and attachedFiles deduped by name, preserving insertion order', () => {
    const rawMeta = {
      attachments: [{ name: 'seed.json', kind: 'file' }],
      attachedFiles: [{ name: 'seed.json' }, { name: 'extra.log' }],
    };

    const container = convertUserContainer([textBlock('x')], rawMeta, BASE);

    expect((container.attachments ?? []).map((a) => a.name)).toEqual(['seed.json', 'extra.log']);
  });

  it('silently drops malformed attachment entries (null, missing name, wrong-typed name, unknown kind)', () => {
    const rawMeta = {
      attachments: [
        null,
        { kind: 'file' },
        { name: 42, kind: 'file' },
        { name: 'ok.ts', kind: 'file' },
        { name: 'weird', kind: 'bogus' },
      ],
    };

    const container = convertUserContainer([textBlock('x')], rawMeta, BASE);

    expect((container.attachments ?? []).map((a) => a.name)).toEqual(['ok.ts']);
  });

  it('sets contentType from the preview mediaType, falling back to octet-stream for a replay-only file', () => {
    const rawMeta = {
      attachments: [{ name: 'doc.pdf', kind: 'file', mediaType: 'application/pdf' }],
      attachedFiles: [{ name: 'extra.log' }],
    };

    const container = convertUserContainer([textBlock('x')], rawMeta, BASE);

    const byName = Object.fromEntries((container.attachments ?? []).map((a) => [a.name, a.contentType]));
    expect(byName['doc.pdf']).toBe('application/pdf');
    expect(byName['extra.log']).toBe('application/octet-stream');
  });
});

describe('coerceUserMeta — malformed metadata', () => {
  it('returns {} for null or non-object metadata', () => {
    expect(coerceUserMeta(null)).toEqual({});
    expect(coerceUserMeta(undefined)).toEqual({});
    expect(coerceUserMeta('not an object')).toEqual({});
  });

  it('drops a wrong-typed error field (number instead of string)', () => {
    expect(coerceUserMeta({ error: 123 })).toEqual({});
  });

  it('drops a command object whose name is not a string', () => {
    expect(coerceUserMeta({ command: { name: 99 } })).toEqual({});
  });

  it('passes through a well-formed command object', () => {
    expect(coerceUserMeta({ command: { name: 'plan', userText: 'go' } })).toEqual({
      command: { name: 'plan', userText: 'go' },
    });
  });
});

describe('convertUserContainer — no metadata', () => {
  it('produces no mainframe metadata and does not throw when rawMeta is undefined', () => {
    expect(() => convertUserContainer([textBlock('hello')], undefined, BASE)).not.toThrow();
    const container = convertUserContainer([textBlock('hello')], undefined, BASE);
    expect(container.metadata).toBeUndefined();
    expect(container.attachments).toBeUndefined();
  });
});
