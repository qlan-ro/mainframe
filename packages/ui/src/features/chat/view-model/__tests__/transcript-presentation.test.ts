import { expect, it } from 'vitest';
import type { PresentationSource, TranscriptPresentation } from '@qlan-ro/mainframe-types';
import { convertAcpItems } from '../convert-acp-item';
import type { AccumulatedItem } from '../acp-item-accumulator';
import type { MainframeMessageMeta } from '../message-meta';

const work: TranscriptPresentation = {
  version: 1,
  provider: 'codex',
  turnId: '["thread","turn"]',
  phase: 'work',
  state: 'completed',
  finalEligible: false,
};
function source(id: string, start: number, end: number, final = false): PresentationSource {
  return {
    sourceMessageId: id,
    sourceBlockIndex: 0,
    streaming: false,
    presentation: final ? { ...work, phase: 'final_answer', finalEligible: true } : work,
    target: { type: 'text', contentBlockIndex: 0, startUtf16: start, endUtf16: end },
  };
}
function message(text: string, sources?: PresentationSource[]): Extract<AccumulatedItem, { kind: 'message' }> {
  return {
    kind: 'message',
    id: 'text-item',
    role: 'agent',
    origin: 'replay',
    content: [{ type: 'text', text }],
    meta: {
      '_mainframe.dev': { containerId: 'container', ...(sources && { presentationSources: { version: 1, sources } }) },
    },
  };
}
const convert = (items: AccumulatedItem[]) => convertAcpItems(items, () => new Date(0));
const meta = (items: AccumulatedItem[]) =>
  (convert(items)[0]!.metadata?.custom?.mainframe ?? {}) as MainframeMessageMeta;

it('maps coalesced UTF16 sources without changing native messages, text, parts or statuses', () => {
  const prefix = 'Work 🛠️\n\n';
  const text = prefix + 'Final 😀e\u0301';
  const plain = convert([message(text)])[0]!;
  const mapped = convert([
    message(text, [source('work', 0, prefix.length), source('final', prefix.length, text.length, true)]),
  ])[0]!;
  expect({ ...mapped, metadata: plain.metadata }).toEqual(plain);
  expect((mapped.metadata!.custom!.mainframe as MainframeMessageMeta).partSources).toMatchObject({
    0: [
      { sourceMessageId: 'work', startUtf16: 0, endUtf16: prefix.length },
      {
        sourceMessageId: 'final',
        startUtf16: prefix.length,
        endUtf16: text.length,
        presentation: { phase: 'final_answer' },
      },
    ],
  });
});
it.each([
  ['surrogate split', [source('a', 0, 2), source('b', 2, 4)]],
  ['negative', [source('a', -1, 4)]],
  ['past end', [source('a', 0, 5)]],
  ['gap', [source('a', 0, 1), source('b', 3, 4)]],
  ['overlap', [source('a', 0, 3), source('b', 1, 4)]],
  ['duplicate source', [source('a', 0, 1), source('a', 1, 4)]],
  ['empty', [source('a', 0, 0), source('b', 0, 4)]],
] as const)('leaves %s ranges wholly native and visible', (_, sources) => {
  const text = 'a😀b';
  const item = message(text, [...sources]);
  expect(meta([item]).partSources).toBeUndefined();
  expect(convert([item])[0]!.content).toEqual(convert([message(text)])[0]!.content);
});
it('maps thought text blocks into their joined reasoning part and offsets subsequent native parts', () => {
  const thought: AccumulatedItem = {
    kind: 'thought',
    id: 'thought',
    content: [
      { type: 'text', text: 'a😀' },
      { type: 'text', text: 'b' },
    ],
    meta: {
      '_mainframe.dev': {
        containerId: 'container',
        presentationSources: {
          version: 1,
          sources: [
            source('a', 0, 3),
            {
              ...source('b', 0, 1),
              sourceBlockIndex: 1,
              target: { type: 'text', contentBlockIndex: 1, startUtf16: 0, endUtf16: 1 },
            },
          ],
        },
      },
    },
  };
  const tail = message('tail', [source('tail', 0, 4, true)]);
  expect(meta([thought, tail]).partSources).toMatchObject({
    0: [
      { startUtf16: 0, endUtf16: 3 },
      { startUtf16: 3, endUtf16: 4 },
    ],
    1: [{ sourceMessageId: 'tail', startUtf16: 0, endUtf16: 4 }],
  });
});
it('maps native tool block identity and subsequent part offsets', () => {
  const tool: AccumulatedItem = {
    kind: 'tool-call',
    id: 'call',
    title: 'Read',
    status: 'completed',
    content: [],
    meta: {
      '_mainframe.dev': {
        containerId: 'container',
        presentationSources: {
          version: 1,
          sources: [
            {
              sourceMessageId: 'call',
              sourceBlockIndex: 0,
              presentation: work,
              target: { type: 'block', contentBlockIndex: 0 },
            },
          ],
        },
      },
    },
  };
  const tail = message('tail', [source('tail', 0, 4, true)]);
  expect(meta([tool, tail]).partSources).toMatchObject({
    0: [{ sourceMessageId: 'call' }],
    1: [{ sourceMessageId: 'tail' }],
  });
});
it('retains native images and unrelated cost while mapping only exact whole image blocks', () => {
  const item = message('caption');
  item.content.push({ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' });
  item.meta = {
    '_mainframe.dev': {
      containerId: 'container',
      messageMeta: { cost_usd: 0.02 },
      presentationSources: {
        version: 1,
        sources: [
          source('caption', 0, 7),
          {
            sourceMessageId: 'image',
            sourceBlockIndex: 1,
            presentation: work,
            target: { type: 'block', contentBlockIndex: 1 },
          },
        ],
      },
    },
  };
  const converted = convert([item])[0]!;
  expect(converted.content).toEqual([
    { type: 'text', text: 'caption', status: { type: 'complete' } },
    { type: 'image', image: 'data:image/png;base64,aGVsbG8=' },
  ]);
  expect(meta([item])).toMatchObject({ cost: 0.02, partSources: { 1: [{ sourceMessageId: 'image' }] } });
});
it('rejects a source boundary that splits a surrogate only after thought blocks are joined', () => {
  const item: AccumulatedItem = {
    kind: 'thought',
    id: 'split-surrogate',
    content: [
      { type: 'text', text: '\ud83d' },
      { type: 'text', text: '\ude00' },
    ],
    meta: {
      '_mainframe.dev': {
        containerId: 'container',
        presentationSources: {
          version: 1,
          sources: [
            source('a', 0, 1),
            {
              ...source('b', 0, 1),
              sourceBlockIndex: 1,
              target: { type: 'text', contentBlockIndex: 1, startUtf16: 0, endUtf16: 1 },
            },
          ],
        },
      },
    },
  };
  expect(meta([item]).partSources).toBeUndefined();
  expect(convert([item])[0]!.content).toEqual([{ type: 'reasoning', text: '😀' }]);
});
