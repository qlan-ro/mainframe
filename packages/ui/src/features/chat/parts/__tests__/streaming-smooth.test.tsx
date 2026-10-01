/**
 * Ported from Fable's `/tmp/mf-smooth/smooth.test.tsx` (long-chat-and-
 * streaming plan task U3) — the `useSmooth` contract
 * (`@assistant-ui/react` 0.15.13 / `@assistant-ui/react-markdown` 0.14.10)
 * that D6 (item-owned streaming status) and D7 (the settle-delayed stop)
 * exist to satisfy: a part reveals progressively only while it is actually
 * the one streaming, a replayed tail never retypes, and the final snippet
 * of a turn gets a chance to animate before the turn's own idle flips it to
 * complete.
 *
 * Unlike the original harness (synthetic `ThreadMessageLike` fixtures), this
 * one builds `AccumulatedItem[]`, runs them through the REAL
 * `convertAcpItems` → `ChatThreadState` → `projectChatThreadMessages`
 * pipeline, and feeds the resulting messages to the harness — so a
 * regression in the status wiring itself (not just this file's fixtures)
 * fails here too.
 *
 * The `@assistant-ui/tap` scheduler flushes store updates on a
 * `MessageChannel` macrotask, which fake timers do not cover — every
 * `rerender()` is followed by `flush()`, a real `setImmediate` tick.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  useExternalStoreRuntime,
  ExportedMessageRepository,
  type ThreadMessageLike,
  type ThreadMessage,
} from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import type { AccumulatedItem } from '../../view-model/acp-item-accumulator';
import { convertAcpItems } from '../../view-model/convert-acp-item';
import { createChatThreadState, reduceChatThreadState, type ChatThreadState } from '../../controller/chat-thread-state';
import { projectChatThreadMessages } from '../../controller/project-messages';

function Assistant() {
  return (
    <MessagePrimitive.Root data-testid="msg">
      <MessagePrimitive.GroupedParts groupBy={() => []} indicator="never">
        {({ part }) => {
          if (part.type === 'text') return <MarkdownTextPrimitive />; // smooth defaults to true, as in the app's MarkdownText
          if (part.type === 'tool-call') return <div data-testid="tool" />;
          return null;
        }}
      </MessagePrimitive.GroupedParts>
    </MessagePrimitive.Root>
  );
}

function Harness({ messages, isRunning }: { messages: ThreadMessageLike[]; isRunning: boolean }) {
  // Same wiring as use-chat-thread-runtime.ts: a pre-built messageRepository + thread-level isRunning.
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isRunning,
    messageRepository: ExportedMessageRepository.fromArray(messages),
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Messages components={{ AssistantMessage: Assistant, UserMessage: () => null }} />
    </AssistantRuntimeProvider>
  );
}

const LONG = 'A'.repeat(80);
const MORE = 'B'.repeat(80);
const stampFor = () => new Date(0);

function meta(fields: Record<string, unknown> = {}) {
  return { '_mainframe.dev': { containerId: 'm1', ...fields } };
}

/** A live or replayed agent message item — the D6 inputs `convertAcpItems` turns into part status. */
function textItem(text: string, opts: { streaming?: boolean; origin?: 'live' | 'replay' } = {}): AccumulatedItem {
  return {
    kind: 'message',
    id: 'm1',
    role: 'agent',
    content: [{ type: 'text', text }],
    meta: meta(opts.streaming !== undefined ? { streaming: opts.streaming } : {}),
    origin: opts.origin,
  };
}

function toolItem(id: string): AccumulatedItem {
  return {
    kind: 'tool-call',
    id,
    title: 'Read',
    status: 'completed',
    content: [],
    rawInput: {},
    meta: meta(),
  };
}

/** Builds the `ChatThreadState` the real controller would reach for this item snapshot + run phase. */
function stateFromItems(items: AccumulatedItem[], phase: 'running' | 'idle'): ChatThreadState {
  let state = createChatThreadState('c1');
  if (phase === 'running') state = reduceChatThreadState(state, { type: 'run.started' });
  state = reduceChatThreadState(state, { type: 'transcript.updated', messages: convertAcpItems(items, stampFor) });
  if (phase === 'idle') state = reduceChatThreadState(state, { type: 'run.stopped' });
  return state;
}

/** The real `convertAcpItems` → `projectChatThreadMessages` pipeline, end to end. */
function messagesFromItems(items: AccumulatedItem[], phase: 'running' | 'idle'): ThreadMessageLike[] {
  return projectChatThreadMessages(stateFromItems(items, phase));
}

const shown = () => document.querySelector('[data-status]')!.textContent ?? '';
const tick = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
// The @assistant-ui/tap scheduler flushes store updates on a MessageChannel macrotask; fake timers don't cover it.
const flush = () => act(async () => void (await new Promise((r) => setImmediate(r))));

describe('useSmooth contract fed by the real D6/D7 pipeline (long-chat-and-streaming plan task U3)', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('1. a part created by a live streaming frame mounts empty and reveals progressively', () => {
    const items = [textItem(LONG, { streaming: true, origin: 'live' })];
    render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);

    expect(shown().length).toBeLessThan(LONG.length);
    tick(100);
    expect(shown().length).toBeGreaterThan(0);
    expect(shown().length).toBeLessThan(LONG.length);
    tick(400);
    expect(shown()).toBe(LONG);
  });

  it('2. a replayed running-thread tail shows its full text at once (no retype)', () => {
    const items = [textItem(LONG, { origin: 'replay' })];
    render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);

    expect(shown()).toBe(LONG);
  });

  it('3. the final snippet followed by idle animates given the settle delay; an immediate stop pops instead', async () => {
    const items = [textItem(LONG, { streaming: true, origin: 'live' })];
    const streaming = render(<Harness isRunning messages={messagesFromItems(items, 'running')} />);
    tick(500);
    expect(shown()).toBe(LONG);

    // The commit frame lands: no longer streaming, but — because of the
    // settle delay (D7) — the thread is still reported `running` for
    // RUN_STOP_SETTLE_MS, so the fallback keeps the part's message
    // running and the new, longer text still gets to animate.
    const committedButRunning = [textItem(LONG + MORE, { origin: 'live' })];
    streaming.rerender(<Harness isRunning messages={messagesFromItems(committedButRunning, 'running')} />);
    await flush();
    expect(shown().length).toBeLessThan(LONG.length + MORE.length);
    tick(500);
    expect(shown()).toBe(LONG + MORE);

    // Documenting the race this plan closes: the SAME commit frame, but
    // with idle already applied (no settle delay) — nothing marks the
    // message running any more, so the part pops in whole instead.
    const popped = render(
      <Harness isRunning={false} messages={messagesFromItems([textItem(LONG + MORE, { origin: 'live' })], 'idle')} />,
    );
    expect(popped.container.querySelector('[data-status]')!.textContent).toBe(LONG + MORE);
  });

  it('4. in [text, tool, text] only the streaming last text animates; the first text is static', async () => {
    const items: AccumulatedItem[] = [textItem('before the tool', { origin: 'live' }), toolItem('t1')];
    // Segment 0 is the first text item (unsuffixed id); the streaming tail
    // is a distinct segment, matching the encoder's real id scheme.
    const tail: AccumulatedItem = { ...textItem(LONG, { streaming: true, origin: 'live' }), id: 'm1-1' };
    const r = render(<Harness isRunning messages={messagesFromItems([...items, tail], 'running')} />);
    await flush();

    const statuses = Array.from(document.querySelectorAll('[data-status]')).map((el) => el.textContent ?? '');
    expect(statuses[0]).toBe('before the tool'); // static — shown whole, immediately
    expect(statuses[1]!.length).toBeLessThan(LONG.length); // the streaming tail is mid-reveal

    tick(500);
    const after = Array.from(document.querySelectorAll('[data-status]')).map((el) => el.textContent ?? '');
    expect(after).toEqual(['before the tool', LONG]);
    void r;
  });

  it('5. flipping the item to complete mid-reveal does not cut the tail short', async () => {
    const r = render(
      <Harness
        isRunning
        messages={messagesFromItems([textItem(LONG, { streaming: true, origin: 'live' })], 'running')}
      />,
    );
    tick(50);
    expect(shown().length).toBeLessThan(LONG.length);

    r.rerender(
      <Harness isRunning={false} messages={messagesFromItems([textItem(LONG, { origin: 'live' })], 'idle')} />,
    );
    await flush();
    expect(shown().length).toBeLessThan(LONG.length);
    tick(500);
    expect(shown()).toBe(LONG);
  });
});
