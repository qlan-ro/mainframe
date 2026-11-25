/** What a draft's captures and code annotations become in the message, read back as the transcript reads it. */
import { describe, expect, it } from 'vitest';
import { convertUserContainer } from '../../../view-model/convert-acp-user';
import { visibleMessageText } from '../../../markers/message-markers';
import { composeMessage } from '../compose-message';
import type { DraftCapture, DraftCodeNote } from '../draft-content-store';

const element = (over: Partial<DraftCapture> = {}): DraftCapture => ({
  id: 'c1',
  kind: 'capture',
  type: 'element',
  imageDataUrl: 'data:image/png;base64,AAAA',
  selector: '.meter > span.pct',
  note: 'Still reads 100%',
  ...over,
});
const code = (over: Partial<DraftCodeNote> = {}): DraftCodeNote => ({
  id: 'n1',
  kind: 'code',
  filePath: 'src/codex.rs',
  startLine: 32,
  endLine: 33,
  lineContent: 'let a = 1;\nlet b = 2;',
  note: 'Keep resets_at',
  ...over,
});

const read = (body: string, images = 0) => {
  const like = convertUserContainer(
    [
      { type: 'text', text: body },
      ...Array.from({ length: images }, () => ({ type: 'image' as const, data: 'AAAA', mimeType: 'image/png' })),
    ],
    {},
    { id: 'm', createdAt: new Date(0) },
  );
  const custom = (like.metadata as { custom?: { mainframe?: Record<string, unknown> } } | undefined)?.custom;
  const text = Array.isArray(like.content) ? like.content.find((p) => p.type === 'text') : undefined;
  return { meta: custom?.mainframe ?? {}, text: (text as { text?: string } | undefined)?.text ?? '', like };
};

describe('composeMessage', () => {
  it('leaves a plain message alone', () => {
    expect(composeMessage('hello', [])).toEqual({ body: 'hello', attachments: [], captures: [] });
  });

  it('sends a capture as its image, with its selector and note beside the text', () => {
    const { body, attachments } = composeMessage('Fix this', [element()]);
    expect(attachments).toEqual([
      {
        id: 'c1',
        type: 'image',
        name: 'element1.png',
        contentType: 'image/png',
        content: [{ type: 'image', image: 'data:image/png;base64,AAAA' }],
        status: { type: 'complete' },
      },
    ]);
    const { meta, text } = read(body, 1);
    expect(meta.captures).toEqual([
      { label: 'element1', imageName: 'element1.png', selector: '.meter > span.pct', annotation: 'Still reads 100%' },
    ]);
    expect(text).toBe('Fix this');
  });

  it('keeps a note of several lines on its row, so none of it spills into the message', () => {
    const { body } = composeMessage('Fix this', [element({ note: 'first\n\nsecond' })]);
    const { meta, text } = read(body, 1);
    expect(meta.captures).toEqual([expect.objectContaining({ annotation: 'first second' })]);
    expect(text).toBe('Fix this');
  });

  it('pairs each image with its own row', () => {
    const { body, attachments } = composeMessage('', [
      element({ id: 'a', note: 'one' }),
      code(),
      element({ id: 'b', type: 'screenshot', selector: undefined, note: 'two' }),
    ]);
    expect(attachments.map((a) => [a.id, a.name])).toEqual([
      ['a', 'element1.png'],
      ['b', 'screenshot1.png'],
    ]);
    expect(read(body, 2).meta.captures).toEqual([
      expect.objectContaining({ label: 'element1', annotation: 'one' }),
      expect.objectContaining({ label: 'screenshot1', annotation: 'two' }),
    ]);
  });

  it('keeps session references readable behind a capture', () => {
    const refs = 'Referenced session @session[Quota]: /x/quota.jsonl\n\nFix @session[Quota]';
    const { body } = composeMessage(refs, [element()]);
    expect(read(body, 1).meta.captures).toHaveLength(1);
    expect(read(body, 1).text).toBe(refs);
    expect(visibleMessageText(body)).toBe('Fix @session[Quota]');
  });

  it('leaves a slash command on line 1, with the captures as a list under it', () => {
    const { body, attachments } = composeMessage('/review the capsule', [element()]);
    expect(body.split('\n')[0]).toBe('/review the capsule');
    expect(body).toContain('`element1` — selector `.meter > span.pct` — "Still reads 100%"');
    expect(body).not.toContain('\0');
    expect(attachments).toHaveLength(1);
  });

  it('is the review card when a file’s annotations are all there is, in line order', () => {
    const { body } = composeMessage('', [code({ id: 'late', startLine: 50, endLine: 50, note: 'later' }), code()]);
    expect(read(body).meta.reviewComment).toEqual({
      file: 'src/codex.rs',
      comments: [
        { start: 32, end: 33, code: 'let a = 1;\nlet b = 2;', body: 'Keep resets_at' },
        { start: 50, code: 'let a = 1;\nlet b = 2;', body: 'later' },
      ],
    });
  });

  it('puts the text first, so it is not read as the annotation’s', () => {
    const { body } = composeMessage('Same bug in both', [code()]);
    const { meta, text } = read(body);
    expect(meta.reviewComment).toBeUndefined();
    expect(text.startsWith('Same bug in both\n\n')).toBe(true);
    for (const part of ['File: `src/codex.rs`', 'At lines 32-33:', 'let a = 1;', 'Keep resets_at']) {
      expect(text).toContain(part);
    }
  });

  it('keeps two files apart when there is no text', () => {
    const { body } = composeMessage('', [code(), code({ id: 'n2', filePath: 'src/b.ts', note: 'second file' })]);
    const { meta, text } = read(body);
    expect(meta.reviewComment).toBeUndefined();
    expect(text).toContain('File: `src/codex.rs`');
    expect(text).toContain('File: `src/b.ts`');
  });

  it('sends an annotation without a note', () => {
    expect(read(composeMessage('', [code({ note: '' })]).body).text).toContain('let b = 2;');
  });

  it('carries captures, annotations and text in one message', () => {
    const { body } = composeMessage('Both', [element(), code()]);
    const { meta, text } = read(body, 1);
    expect(meta.captures).toHaveLength(1);
    expect(text.startsWith('Both')).toBe(true);
    expect(text).toContain('Keep resets_at');
  });
});
