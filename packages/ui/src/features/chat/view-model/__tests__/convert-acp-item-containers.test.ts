/**
 * User/system/error container mapping + stability for `convertAcpItems` —
 * split out of convert-acp-item.test.ts (todo #350, plan task 37, R2.13) to
 * keep that file under the 300-line cap.
 */
import { describe, expect, it } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { AccumulatedItem } from '../acp-item-accumulator';
import { convertAcpItems } from '../convert-acp-item';
import type { MainframeMessageMeta } from '../message-meta';
import { SANDBOX_CAPTURE_SENTINEL } from '../../markers/message-markers';

const createdAt = new Date('2026-08-28T00:00:00.000Z');
const stampFor = () => createdAt;

function textBlock(text: string) {
  return { type: 'text' as const, text };
}

function imageBlock(mimeType: string, data: string) {
  return { type: 'image' as const, mimeType, data };
}

function itemMeta(fields: Record<string, unknown>) {
  return { '_mainframe.dev': fields };
}

function mainframeMeta(container: ThreadMessageLike): MainframeMessageMeta | undefined {
  return (container.metadata?.custom as { mainframe?: MainframeMessageMeta } | undefined)?.mainframe;
}

describe('convertAcpItems — user container: sandbox captures', () => {
  it('routes capture images into native attachments, sets mainframe.captures, keeps the rest text', () => {
    const text =
      SANDBOX_CAPTURE_SENTINEL + '\n> **Preview captures**\n> - `element1` — selector `nav > .x`\n\nfix the spacing';
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 'u1', role: 'user', content: [textBlock(text), imageBlock('image/png', 'AAAA')] },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.role).toBe('user');
    expect(container.content).toEqual([{ type: 'text', text: 'fix the spacing' }]);
    expect(container.attachments).toEqual([
      {
        id: 'element1.png',
        type: 'image',
        name: 'element1.png',
        contentType: 'image/png',
        content: [{ type: 'image', image: 'data:image/png;base64,AAAA' }],
        status: { type: 'complete' },
      },
    ]);
    expect(mainframeMeta(container)?.captures).toEqual([
      { label: 'element1', imageName: 'element1.png', selector: 'nav > .x' },
    ]);
  });

  it('keeps an image block as a plain image content part when there is no capture sentinel', () => {
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 'u2', role: 'user', content: [textBlock('hi'), imageBlock('image/png', 'AAAA')] },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.content).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', image: 'data:image/png;base64,AAAA' },
    ]);
    expect(container.attachments).toBeUndefined();
    expect(container.metadata).toBeUndefined();
  });
});

describe('convertAcpItems — user container: file attachments', () => {
  it('merges attachment previews (kind file) with attachedFiles, deduped by name, contentType from preview mediaType', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'u3',
        role: 'user',
        content: [textBlock('look')],
        meta: itemMeta({
          messageMeta: {
            attachments: [
              { name: 'doc.pdf', kind: 'file', sizeBytes: 9000, mediaType: 'application/pdf' },
              { name: 'shot.png', kind: 'image' },
            ],
            attachedFiles: [{ name: 'doc.pdf' }, { name: 'extra.log' }],
          },
        }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.attachments).toEqual([
      {
        id: 'doc.pdf',
        type: 'file',
        name: 'doc.pdf',
        contentType: 'application/pdf',
        content: [],
        status: { type: 'complete' },
      },
      {
        id: 'extra.log',
        type: 'file',
        name: 'extra.log',
        contentType: 'application/octet-stream',
        content: [],
        status: { type: 'complete' },
      },
    ]);
    expect(mainframeMeta(container)?.attachmentPreviews).toEqual([
      { name: 'doc.pdf', kind: 'file', sizeBytes: 9000, mediaType: 'application/pdf' },
      { name: 'shot.png', kind: 'image' },
    ]);
  });
});

describe('convertAcpItems — user container: coerceUserMeta', () => {
  it('coerces command/cleanText into mainframe meta and drops malformed fields — queued no longer rides the wire (D1, T32: it comes from the queue snapshot projection instead)', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'u4',
        role: 'user',
        content: [textBlock('go')],
        meta: itemMeta({
          messageMeta: {
            queued: true,
            cleanText: 'go',
            command: { name: 'plan', userText: 'go' },
            error: 123,
            pending: 'yes',
          },
        }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(mainframeMeta(container)).toEqual({
      cleanText: 'go',
      command: { name: 'plan', userText: 'go' },
    });
  });
});

describe('convertAcpItems — user container: review comment', () => {
  it('parses a review-comment text into mainframe.reviewComment and drops the raw text part', () => {
    const text = 'Diff of `app/globals.css`\n\nAt line 43:\n```\n--mf-app-bg: #f4f4f2;\n```\ntoo bright';
    const items: AccumulatedItem[] = [{ kind: 'message', id: 'u5', role: 'user', content: [textBlock(text)] }];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(mainframeMeta(container)?.reviewComment).toEqual({
      file: 'app/globals.css',
      comments: [{ start: 43, code: '--mf-app-bg: #f4f4f2;', body: 'too bright' }],
    });
    expect(container.content).toEqual([{ type: 'text', text: '' }]);
  });
});

describe('convertAcpItems — system container', () => {
  it('carries skillLoaded/isCompacted into role system + metadata.custom.mainframe', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 's1',
        role: 'agent',
        content: [textBlock('note')],
        meta: itemMeta({
          kind: 'system',
          isCompacted: true,
          skillLoaded: { skillName: 'x', path: '/y', content: 'z' },
        }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.role).toBe('system');
    expect(container.content).toEqual([{ type: 'text', text: 'note' }]);
    expect(mainframeMeta(container)).toEqual({
      isCompacted: true,
      skillLoaded: { skillName: 'x', path: '/y', content: 'z' },
    });
  });

  it('ensureNonEmpty gives one empty text part when there are no text blocks', () => {
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 's2', role: 'agent', content: [], meta: itemMeta({ kind: 'system' }) },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.role).toBe('system');
    expect(container.content).toEqual([{ type: 'text', text: '' }]);
    expect(container.metadata).toBeUndefined();
  });
});

describe('convertAcpItems — error container', () => {
  it('sets role assistant, the errorText as content, and metadata.custom.mainframe.errorText', () => {
    const items: AccumulatedItem[] = [
      {
        kind: 'message',
        id: 'e1',
        role: 'agent',
        content: [],
        meta: itemMeta({ kind: 'error', errorText: 'CLI died' }),
      },
    ];

    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.role).toBe('assistant');
    expect(container.content).toEqual([{ type: 'text', text: 'CLI died' }]);
    expect(mainframeMeta(container)).toEqual({ errorText: 'CLI died' });
  });
});

describe('convertAcpItems — ensureNonEmpty (assistant)', () => {
  it('an empty agent message item still renders one empty text part', () => {
    const items: AccumulatedItem[] = [{ kind: 'message', id: 'a1', role: 'agent', content: [] }];
    const container = convertAcpItems(items, stampFor)[0]!;
    expect(container.content).toEqual([{ type: 'text', text: '' }]);
  });
});

describe('convertAcpItems — stability', () => {
  it('converting the same container twice yields deeply equal results', () => {
    const items: AccumulatedItem[] = [
      { kind: 'message', id: 'm1', role: 'agent', content: [textBlock('hi')], meta: itemMeta({ containerId: 'c1' }) },
      {
        kind: 'tool-call',
        id: 't1',
        title: 'Bash',
        status: 'completed',
        content: [],
        meta: itemMeta({ containerId: 'c1' }),
      },
    ];

    const first = convertAcpItems(items, stampFor);
    const second = convertAcpItems(items, stampFor);
    expect(second).toEqual(first);
  });

  it('a container whose meta lacks containerId falls back to grouping by item id', () => {
    const items: AccumulatedItem[] = [
      { kind: 'tool-call', id: 'solo-1', title: 'Bash', status: 'completed', content: [] },
      { kind: 'tool-call', id: 'solo-2', title: 'Bash', status: 'completed', content: [] },
    ];

    const converted = convertAcpItems(items, stampFor);
    expect(converted.map((m) => m.id)).toEqual(['solo-1', 'solo-2']);
  });
});
