import type { ThreadMessage } from '@assistant-ui/react';
import { describe, expect, it } from 'vitest';
import type { MainframeMessageMeta } from '@/features/chat/view-model/message-meta';
import { mergeSteps } from '../merge-steps';

type Spec = { key: string; part: Record<string, unknown>; source?: string };
const call = (id: string, source?: string): Spec => ({
  key: `${id}#call`,
  part: { type: 'tool-call', toolCallId: id, toolName: 'Read', args: {} },
  source,
});
const thought = (id: string, text: string, source?: string): Spec => ({
  key: `${id}#thought`,
  part: { type: 'reasoning', text },
  source,
});
const text = (item: string, block: number, body: string, source?: string): Spec => ({
  key: `${item}#${block}`,
  part: { type: 'text', text: body },
  source,
});
const image = (item: string, block: number): Spec => ({
  key: `${item}#${block}`,
  part: { type: 'image', image: `data:image/png;base64,${item}${block}` },
});

/** A sub-agent's steps message, as the converter builds it. */
function steps(specs: Spec[], extra: Partial<MainframeMessageMeta> = {}): ThreadMessage {
  const partSources: Record<number, unknown[]> = {};
  specs.forEach(({ source }, index) => {
    if (source) partSources[index] = [{ sourceMessageId: source }];
  });
  return {
    id: 'item-1:transcript',
    role: 'assistant',
    content: specs.map(({ part }) => part),
    status: { type: 'complete', reason: 'stop' },
    metadata: {
      custom: {
        mainframe: {
          partKeys: specs.map(({ key }) => key),
          ...(Object.keys(partSources).length && { partSources }),
          ...extra,
        },
      },
    },
  } as unknown as ThreadMessage;
}

const meta = (message: ThreadMessage) => message.metadata.custom.mainframe as MainframeMessageMeta;
const keys = (message?: ThreadMessage) => meta(message!).partKeys;
const sourceOf = (message: ThreadMessage, index: number) =>
  (meta(message).partSources?.[index]?.[0] as unknown as { sourceMessageId: string } | undefined)?.sourceMessageId;

describe('mergeSteps', () => {
  it('adds what the stream has beyond the fetched copy, thinking included, in order', () => {
    const fetched = steps([call('s1', 'src-s1'), call('s2', 'src-s2-old')]);
    const live = steps([call('s2', 'src-s2'), thought('t1', 'hmm', 'src-t1'), call('s3', 'src-s3')]);
    const [merged] = mergeSteps([fetched], [live]);
    expect(keys(merged)).toEqual(['s1#call', 's2#call', 't1#thought', 's3#call']);
    expect(merged!.content.map((part) => (part as { type: string }).type)).toEqual([
      'tool-call',
      'tool-call',
      'reasoning',
      'tool-call',
    ]);
    // The source table follows the merged positions, and the stream's copy of a shared part wins.
    expect([0, 1, 2, 3].map((index) => sourceOf(merged!, index))).toEqual(['src-s1', 'src-s2', 'src-t1', 'src-s3']);
  });

  it('keeps every block of a text, image, text sequence once', () => {
    const fetched = steps([text('a', 0, 'first'), image('a', 1), text('a', 2, 'last')]);
    const live = steps([image('a', 1), text('a', 2, 'last, longer'), text('b', 0, 'next')]);
    const [merged] = mergeSteps([fetched], [live]);
    expect(keys(merged)).toEqual(['a#0', 'a#1', 'a#2', 'b#0']);
    expect(merged!.content.map((part) => (part as { text?: string }).text)).toEqual([
      'first',
      undefined,
      'last, longer',
      'next',
    ]);
  });

  it('shows a thought still being written as the stream has it', () => {
    const fetched = steps([call('s1'), thought('t1', 'half a thou')]);
    const live = steps([thought('t1', 'half a thought, now whole'), call('s2')]);
    const [merged] = mergeSteps([fetched], [live]);
    expect(merged!.content.map((part) => (part as { text?: string }).text)).toEqual([
      undefined,
      'half a thought, now whole',
      undefined,
    ]);
  });

  it('keeps the stream’s other metadata and drops a source table that no longer fits', () => {
    const fetched = steps([call('s1')]);
    const live = steps([call('s2', 'src-s2')], { cost: 2 });
    const [merged] = mergeSteps([fetched], [live]);
    expect(meta(merged!).cost).toBe(2);
    expect(sourceOf(merged!, 0)).toBeUndefined();
    expect(sourceOf(merged!, 1)).toBe('src-s2');
  });

  it('takes the stream’s message whole when a copy has no keys', () => {
    const unkeyed = { ...steps([call('s2')]), metadata: { custom: {} } } as unknown as ThreadMessage;
    const [merged] = mergeSteps([steps([call('s1')])], [unkeyed]);
    expect(merged).toBe(unkeyed);
  });

  it('is the other copy when one is empty', () => {
    const only = steps([call('s1')]);
    expect(mergeSteps([only], [])).toEqual([only]);
    expect(mergeSteps([], [only])).toEqual([only]);
  });
});
