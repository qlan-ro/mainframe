/**
 * `TranscriptProjector` — identity across projections. The native
 * `ThreadMessage` for an unchanged like is the same object every time; a
 * changed assistant message keeps the native tool-call parts whose source
 * parts did not change; status stamps never defeat either; and the trailing
 * queued/pending turns still follow the transcript in a linear parent chain.
 */
import { describe, expect, it } from 'vitest';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { AcpItemAccumulator } from '../../view-model/acp-item-accumulator';
import { TranscriptConverter } from '../../view-model/convert-acp-item';
import { createChatThreadState, reduceChatThreadState, type ChatThreadState } from '../chat-thread-state';
import { projectChatThreadRepository } from '../project-messages';
import { TranscriptProjector } from '../transcript-projector';
import { streamingTailChunk, streamingTailCreate, transcriptFrames } from '../../__tests__/transcript-fixture';

const stampFor = () => new Date('2026-10-01T00:00:00.000Z');

function withMessages(state: ChatThreadState, messages: ThreadMessageLike[]): ChatThreadState {
  return reduceChatThreadState(state, { type: 'transcript.updated', messages });
}

function assistant(id: string, text: string, extra: Partial<ThreadMessageLike> = {}): ThreadMessageLike {
  return { id, role: 'assistant', content: [{ type: 'text', text }], ...extra };
}

function toolPart(toolCallId: string) {
  return {
    type: 'tool-call' as const,
    toolCallId,
    toolName: 'Read',
    args: { file_path: `/${toolCallId}` },
    result: 'ok',
  };
}

describe('TranscriptProjector — identity across projections', () => {
  it('projects an unchanged like to the same ThreadMessage, in both the list and the repository shape', () => {
    const projector = new TranscriptProjector();
    const like = assistant('a1', 'hello');
    let state = withMessages(createChatThreadState('c1'), [like]);
    const first = projector.projectRepository(state).messages[0]!.message;

    state = reduceChatThreadState(state, { type: 'context.usage', percentage: 10, totalTokens: 1, maxTokens: 10 });
    expect(projector.projectRepository(state).messages[0]!.message).toBe(first);
    expect(projector.projectMessages(state)[0]).toBe(first);
  });

  it('a streamed chunk replaces only the live tail, and that tail keeps its untouched tool-call parts', () => {
    const turns = 6;
    const acc = new AcpItemAccumulator({ strictCreation: true });
    for (const update of transcriptFrames(turns)) acc.apply(update);
    acc.apply(streamingTailCreate(turns));
    const converter = new TranscriptConverter();
    const projector = new TranscriptProjector();
    let state = createChatThreadState('c1');
    state = reduceChatThreadState(state, { type: 'capabilities.updated', authoritativeItemStreaming: true });
    state = reduceChatThreadState(state, { type: 'run.started' });
    state = withMessages(state, converter.convert(acc.itemsInOrder, stampFor));
    const before = projector.projectMessages(state);

    acc.apply(streamingTailChunk(turns, 0));
    state = withMessages(state, converter.convert(acc.itemsInOrder, stampFor));
    const after = projector.projectMessages(state);

    expect(after).toHaveLength(before.length);
    after.slice(0, -1).forEach((message, index) => expect(message).toBe(before[index]));
    expect(after[after.length - 1]).not.toBe(before[before.length - 1]);

    // The previous turn's answer carries four tool cards: untouched, so still the same objects.
    const settledAnswer = after[after.length - 2]!;
    expect(settledAnswer.role).toBe('assistant');
  });

  it("keeps a changed assistant message's unchanged tool-call parts referentially stable", () => {
    const projector = new TranscriptProjector();
    const tool = toolPart('t1');
    const first = assistant('a1', 'typing', { content: [tool, { type: 'text', text: 'typing' }] });
    const grown = assistant('a1', 'typing more', { content: [tool, { type: 'text', text: 'typing more' }] });

    const before = projector.projectMessages(withMessages(createChatThreadState('c1'), [first]))[0]!;
    const after = projector.projectMessages(withMessages(createChatThreadState('c1'), [grown]))[0]!;

    expect(after).not.toBe(before);
    expect(after.content[0]).toBe(before.content[0]);
    expect(after.content[1]).not.toBe(before.content[1]);
    expect((after.content[1] as { text: string }).text).toBe('typing more');
  });

  it('a tool-call part whose source changed is re-normalized, not reused', () => {
    const projector = new TranscriptProjector();
    const first = assistant('a1', 'x', { content: [toolPart('t1'), { type: 'text', text: 'x' }] });
    const changed = assistant('a1', 'x', {
      content: [
        { ...toolPart('t1'), result: 'different' },
        { type: 'text', text: 'x' },
      ],
    });
    const before = projector.projectMessages(withMessages(createChatThreadState('c1'), [first]))[0]!;
    const after = projector.projectMessages(withMessages(createChatThreadState('c1'), [changed]))[0]!;
    expect(after.content[0]).not.toBe(before.content[0]);
    expect((after.content[0] as { result: unknown }).result).toBe('different');
  });

  it('authoritative mode stamps a status-less assistant like complete once, and keeps that identity', () => {
    const projector = new TranscriptProjector();
    const like = assistant('a1', 'done');
    let state = reduceChatThreadState(createChatThreadState('c1'), {
      type: 'capabilities.updated',
      authoritativeItemStreaming: true,
    });
    state = withMessages(state, [like]);
    const first = projector.projectMessages(state)[0]!;
    expect(first.role === 'assistant' && first.status).toEqual({ type: 'complete', reason: 'unknown' });
    state = reduceChatThreadState(state, { type: 'run.started' });
    expect(projector.projectMessages(state)[0]).toBe(first);
  });

  it('legacy mode stamps the running tail stably while running and drops back to the idle identity afterwards', () => {
    const projector = new TranscriptProjector();
    const like = assistant('a1', 'working');
    let state = withMessages(createChatThreadState('c1'), [like]);
    const idle = projector.projectMessages(state)[0]!;

    state = reduceChatThreadState(state, { type: 'run.started' });
    const running = projector.projectMessages(state)[0]!;
    expect(running).not.toBe(idle);
    expect(running.role === 'assistant' && running.status).toEqual({ type: 'running' });
    state = reduceChatThreadState(state, { type: 'context.usage', percentage: 1, totalTokens: 1, maxTokens: 2 });
    expect(projector.projectMessages(state)[0]).toBe(running);

    state = reduceChatThreadState(state, { type: 'run.stopped' });
    expect(projector.projectMessages(state)[0]).toBe(idle);
  });

  it('queued and pending turns follow the transcript in a linear parent chain, matching the one-shot projection', () => {
    const projector = new TranscriptProjector();
    // A like without `createdAt` is stamped `new Date()` at projection time, so
    // the two projections below only compare equal with a fixed stamp.
    let state = withMessages(createChatThreadState('c1'), [assistant('a1', 'answer', { createdAt: stampFor() })]);
    state = reduceChatThreadState(state, {
      type: 'queued.snapshot',
      refs: [{ uuid: 'q1', messageId: 'q1', chatId: 'c1', content: 'queued', timestamp: '2026-10-01T00:00:01.000Z' }],
    });
    state = reduceChatThreadState(state, {
      type: 'local.message.queued',
      pending: { clientId: 'p1', chatId: 'c1', text: 'pending', createdAt: 1, status: 'pending' },
    });

    const repository = projector.projectRepository(state);
    expect(repository.messages.map((entry) => [entry.parentId, entry.message.id])).toEqual([
      [null, 'a1'],
      ['a1', 'q1'],
      ['q1', 'local:p1'],
    ]);
    expect(repository.messages.map((entry) => entry.message)).toMatchObject(
      projectChatThreadRepository(state).messages.map((entry) => entry.message),
    );
  });
});
