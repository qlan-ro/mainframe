/**
 * Render isolation: streaming one chunk into the live tail answer must not
 * re-render the settled messages above it. Counts component renders through
 * the real accumulator → converter → projection → `useExternalStoreRuntime`
 * path, with assistant-ui's own message/part dispatch.
 *
 * The `@assistant-ui/tap` scheduler flushes store updates on a
 * `MessageChannel` macrotask, so every rerender is followed by a real
 * `setImmediate` tick.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  useAuiState,
  useExternalStoreRuntime,
  type ExportedMessageRepository,
  type ThreadMessage,
} from '@assistant-ui/react';
import { AcpItemAccumulator } from '../../view-model/acp-item-accumulator';
import { TranscriptConverter } from '../../view-model/convert-acp-item';
import { createChatThreadState, reduceChatThreadState, type ChatThreadState } from '../../controller/chat-thread-state';
import { TranscriptProjector } from '../../controller/transcript-projector';
import { streamingTailChunk, streamingTailCreate, transcriptFrames } from '../../__tests__/transcript-fixture';

const renders = { assistant: 0, user: 0, text: 0, tool: 0, reasoning: 0 };

function resetRenders() {
  for (const key of Object.keys(renders) as Array<keyof typeof renders>) renders[key] = 0;
}

function TextPart() {
  renders.text += 1;
  const text = useAuiState((s) => (s.part.type === 'text' ? s.part.text : ''));
  return <p data-testid="text">{text}</p>;
}

function ToolPart() {
  renders.tool += 1;
  const part = useAuiState((s) => s.part);
  return <div data-testid="tool">{part.type === 'tool-call' ? part.toolName : ''}</div>;
}

function ReasoningPart() {
  renders.reasoning += 1;
  useAuiState((s) => s.part);
  return <div data-testid="reasoning" />;
}

function Assistant() {
  renders.assistant += 1;
  const id = useAuiState((s) => s.message.id);
  return (
    <MessagePrimitive.Root data-message-id={id}>
      <MessagePrimitive.GroupedParts groupBy={() => []} indicator="never">
        {({ part }) => {
          if (part.type === 'text') return <TextPart />;
          if (part.type === 'tool-call') return <ToolPart />;
          if (part.type === 'reasoning') return <ReasoningPart />;
          return null;
        }}
      </MessagePrimitive.GroupedParts>
    </MessagePrimitive.Root>
  );
}

function User() {
  renders.user += 1;
  useAuiState((s) => s.message.id);
  return <div data-testid="user" />;
}

function Harness({ repository, isRunning }: { repository: ExportedMessageRepository; isRunning: boolean }) {
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning,
    messageRepository: repository,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Messages components={{ AssistantMessage: Assistant, UserMessage: User }} />
    </AssistantRuntimeProvider>
  );
}

const flush = () => act(() => new Promise<void>((resolve) => setImmediate(resolve)));

const TURNS = 30;
const CHUNKS = 10;

describe('transcript render isolation', () => {
  it('a streamed chunk re-renders only the live tail message', async () => {
    const stampFor = () => new Date(0);
    const acc = new AcpItemAccumulator({ strictCreation: true });
    acc.setReplaying(true);
    for (const update of transcriptFrames(TURNS)) acc.apply(update);
    acc.setReplaying(false);
    acc.apply(streamingTailCreate(TURNS));

    let state: ChatThreadState = createChatThreadState('c1');
    state = reduceChatThreadState(state, { type: 'capabilities.updated', authoritativeItemStreaming: true });
    state = reduceChatThreadState(state, { type: 'run.started' });
    const converter = new TranscriptConverter();
    const projector = new TranscriptProjector();
    const project = () => {
      state = reduceChatThreadState(state, {
        type: 'transcript.updated',
        messages: converter.convert(acc.itemsInOrder, stampFor),
      });
      return projector.projectRepository(state);
    };

    const view = render(<Harness repository={project()} isRunning />);
    await flush();
    const mounted = { ...renders };
    resetRenders();

    for (let i = 0; i < CHUNKS; i++) {
      acc.apply(streamingTailChunk(TURNS, i));
      view.rerender(<Harness repository={project()} isRunning />);
      await flush();
    }

    const perChunk = {
      assistant: renders.assistant / CHUNKS,
      user: renders.user / CHUNKS,
      text: renders.text / CHUNKS,
      tool: renders.tool / CHUNKS,
      reasoning: renders.reasoning / CHUNKS,
    };
    process.stderr.write(`[render] mount: ${JSON.stringify(mounted)}\n`);
    process.stderr.write(`[render] per chunk: ${JSON.stringify(perChunk)}\n`);

    // Settled messages must stay untouched: at most the tail assistant message
    // and its single text part render per chunk (plus React's own double render
    // slack in development mode).
    expect(perChunk.user).toBe(0);
    expect(perChunk.tool).toBe(0);
    expect(perChunk.reasoning).toBe(0);
    expect(perChunk.assistant).toBeLessThanOrEqual(2);
    expect(perChunk.text).toBeLessThanOrEqual(2);
  });
});
