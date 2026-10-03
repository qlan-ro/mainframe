import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExportedMessageRepository, type ThreadMessageLike } from '@assistant-ui/react';
import { normalizeNativeRepository } from '../../view-model/normalize-native-messages';
import { createChatThreadState, type ChatThreadState } from '../../controller/chat-thread-state';
import { projectChatThreadRepository } from '../../controller/project-messages';
import { useNativeThreadMessages } from '../use-native-thread-messages';

function assistant(id = 'answer'): ThreadMessageLike {
  return { id, role: 'assistant', createdAt: new Date(0), content: [{ type: 'text', text: id }] };
}
function stateFor(messages: ThreadMessageLike[], authoritativeItemStreaming = false): ChatThreadState {
  return { ...createChatThreadState('chat'), messages, authoritativeItemStreaming };
}
const ack: ThreadMessageLike = { id: 'ack', role: 'user', createdAt: new Date(1), content: 'next' };
it('normalizes legal idle messages exactly like the main repository without mutating source values', () => {
  const source = assistant();
  const state = stateFor([source, ack, { id: 'notice', role: 'system', createdAt: new Date(2), content: 'notice' }]);
  const { result } = renderHook(() => useNativeThreadMessages(state));
  expect(result.current).toMatchObject(projectChatThreadRepository(state).messages.map(({ message }) => message));
  expect(result.current[0]).toMatchObject({
    status: { type: 'complete', reason: 'unknown' },
    metadata: { custom: {}, steps: [] },
  });
  expect(result.current[1]).toMatchObject({ attachments: [], metadata: { custom: {} } });
  expect(result.current[1]).not.toHaveProperty('status');
  expect(result.current[2]).not.toHaveProperty('status');
  expect(source).not.toHaveProperty('status');
  expect(source).not.toHaveProperty('metadata');
});
it.each([false, true])(
  'keeps running and cancelling acknowledgment behavior aligned with main (authoritative=%s)',
  (authoritative) => {
    const base = stateFor([assistant(), ack], authoritative);
    const { result, rerender } = renderHook(({ state }) => useNativeThreadMessages(state), {
      initialProps: { state: base },
    });
    for (const type of ['running', 'cancelling', 'idle'] as const) {
      const state = { ...base, runState: { type } } as ChatThreadState;
      rerender({ state });
      expect(result.current).toMatchObject(projectChatThreadRepository(state).messages.map(({ message }) => message));
      expect(result.current[0]!.status?.type).toBe(authoritative || type === 'idle' ? 'complete' : 'running');
      expect(result.current[1]).not.toHaveProperty('status');
    }
  },
);
it.each([
  { type: 'running' as const },
  { type: 'complete' as const, reason: 'stop' as const },
  { type: 'incomplete' as const, reason: 'cancelled' as const },
])('retains explicit authoritative status %j and native source metadata', (status) => {
  const partStatus = { type: 'complete' as const };
  const mainframe = { partSources: { 0: [{ sourceMessageId: 'source', startUtf16: 0, endUtf16: 6 }] } };
  const message: ThreadMessageLike = {
    ...assistant(),
    status,
    content: [{ type: 'text', text: 'answer', status: partStatus }],
    metadata: { custom: { mainframe } },
  };
  const state = stateFor([message, ack], true);
  const { result } = renderHook(() => useNativeThreadMessages(state));
  expect(result.current[0]!.status).toBe(status);
  expect(result.current[0]!.content[0]).toMatchObject({ status: partStatus, text: 'answer' });
  expect(result.current[0]!.metadata.custom.mainframe).toBe(mainframe);
  expect(result.current[0]!.createdAt).toBe(message.createdAt);
  expect(result.current.map((entry) => entry.id)).toEqual(['answer', 'ack']);
});
it('preserves explicit legacy running status behind a later acknowledgment', () => {
  const status = { type: 'running' as const };
  const state = { ...stateFor([{ ...assistant(), status }, ack]), runState: { type: 'running' as const } };
  const { result } = renderHook(() => useNativeThreadMessages(state));
  expect(result.current[0]!.status).toBe(status);
});
it('reuses immutable historical native objects across active updates and reorder, and converts replacements', () => {
  const history = assistant('history');
  const active = assistant('active');
  const state = stateFor([history, active], true);
  const { result, rerender } = renderHook(({ state }) => useNativeThreadMessages(state), { initialProps: { state } });
  const original = result.current[0]!;
  const grown = { ...active, content: [{ type: 'text' as const, text: 'active grows' }] };
  rerender({ state: { ...state, messages: [history, grown] } });
  expect(result.current[0]).toBe(original);
  expect(result.current[0]!.content).toBe(original.content);
  expect(result.current[0]!.metadata).toBe(original.metadata);
  expect(result.current[1]!.content).toEqual(grown.content);
  rerender({ state: { ...state, messages: [grown, history] } });
  expect(result.current[1]).toBe(original);
  rerender({ state: { ...state, messages: [grown] } });
  expect(result.current.map((message) => message.id)).toEqual(['active']);
  const replacement = { ...history, content: [{ type: 'text' as const, text: 'replacement' }] };
  rerender({ state: { ...state, messages: [replacement] } });
  expect(result.current[0]).not.toBe(original);
  expect(result.current[0]!.content).toEqual(replacement.content);
});
it('keeps pending and queued user messages in canonical order without assistant status', () => {
  const base = stateFor([assistant()]);
  const state: ChatThreadState = {
    ...base,
    pendingUserMessages: {
      pending: { clientId: 'pending', chatId: 'chat', text: 'pending', createdAt: 3, status: 'pending' },
    },
    interactions: {
      ...base.interactions,
      queued: {
        queued: {
          messageId: 'queued',
          chatId: 'chat',
          uuid: 'queued',
          content: 'queued',
          timestamp: new Date(2).toISOString(),
        },
      },
    },
  };
  const { result } = renderHook(() => useNativeThreadMessages(state));
  expect(result.current.map((message) => message.id)).toEqual(['answer', 'queued', 'local:pending']);
  for (const message of result.current.slice(1)) {
    expect(message.role).toBe('user');
    expect(message).not.toHaveProperty('status');
  }
});

function mappedMessage(): Omit<ThreadMessageLike, 'content'> & {
  content: Exclude<ThreadMessageLike['content'], string>;
} {
  const sources = Object.fromEntries(
    [0, 1, 2, 3].map((index) => [index, Object.freeze([{ sourceMessageId: `source-${index}` }])]),
  );
  return {
    ...assistant(),
    status: { type: 'complete', reason: 'stop' },
    content: [
      { type: 'image', image: 'invalid-image' },
      { type: 'reasoning', text: ' ' },
      {
        type: 'tool-call',
        toolCallId: 'read',
        toolName: 'Read',
        args: { file_path: 'a.ts' },
        argsText: '{"file_path":"a.ts"}',
        result: 'content',
        providerMetadata: { mainframe: { acpStatus: 'completed' } },
      },
      { type: 'text', text: 'Done', status: { type: 'complete' } },
    ],
    metadata: { custom: { unrelated: 'retained', mainframe: { cost: 0.01, partSources: sources } } },
  };
}
it('remaps retained tool/final sources using canonical filtering without mutating source metadata', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const source = mappedMessage();
    const before = JSON.stringify(source);
    const sourceMeta = source.metadata!.custom!.mainframe as { partSources: Record<number, unknown> };
    const result = normalizeNativeRepository([source, ack]);
    const native = ExportedMessageRepository.fromArray([source, ack]);
    const message = result.messages[0]!.message;
    expect(result.messages.map(({ parentId }) => parentId)).toEqual(native.messages.map(({ parentId }) => parentId));
    expect(result.headId).toBe(native.headId);
    expect(message.content).toEqual(native.messages[0]!.message.content);
    expect(message.status).toBe(source.status);
    expect(message.content[0]).toMatchObject({
      type: 'tool-call',
      toolCallId: 'read',
      result: 'content',
      providerMetadata: { mainframe: { acpStatus: 'completed' } },
    });
    expect(message.content[1]).toMatchObject({ type: 'text', text: 'Done', status: { type: 'complete' } });
    const meta = message.metadata.custom.mainframe as { partSources: Record<number, unknown> };
    expect(Object.keys(meta.partSources)).toEqual(['0', '1']);
    expect(meta.partSources[0]).toBe(sourceMeta.partSources[2]);
    expect(meta.partSources[1]).toBe(sourceMeta.partSources[3]);
    expect(message.metadata.custom).toMatchObject({ unrelated: 'retained', mainframe: { cost: 0.01 } });
    expect(JSON.stringify(source)).toBe(before);
  } finally {
    warning.mockRestore();
  }
});
it('keeps canonical retained part objects and cached remapped sources stable', () => {
  const source = {
    ...mappedMessage(),
    content: [{ type: 'text' as const, text: ' ' }, ...mappedMessage().content.slice(1)],
  };
  const nativeConvert = ExportedMessageRepository.fromArray;
  const outputs: ReturnType<typeof nativeConvert>[] = [];
  const conversion = vi.spyOn(ExportedMessageRepository, 'fromArray').mockImplementation((messages) => {
    const result = nativeConvert(messages);
    outputs.push(result);
    return result;
  });
  try {
    const state = stateFor([source], true);
    const { result, rerender } = renderHook(({ state }) => useNativeThreadMessages(state), { initialProps: { state } });
    const first = result.current[0]!;
    expect(first.content).toBe(outputs[0]!.messages[0]!.message.content);
    const calls = conversion.mock.calls.length;
    rerender({ state: { ...state } });
    expect(result.current[0]).toBe(first);
    expect(conversion).toHaveBeenCalledTimes(calls);
  } finally {
    conversion.mockRestore();
  }
});
