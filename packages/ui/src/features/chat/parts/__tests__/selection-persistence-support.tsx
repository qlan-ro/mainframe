/**
 * Shared fixtures for `selection-persistence.test.tsx` — split out once that
 * file crossed 300 lines (same convention as `acp-attachment-support.ts`).
 * NOT a `.test.ts(x)` file in vitest's own sense of contributing cases:
 * vitest's include glob only picks up `*.test.ts(x)`, so this module (despite
 * the `.tsx` extension, needed for JSX) contributes no cases of its own.
 */
// @vitest-environment jsdom
import { vi } from 'vitest';
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
import { MarkdownText } from '../markdown-text';
import type { AccumulatedItem } from '../../view-model/acp-item-accumulator';
import { convertAcpItems } from '../../view-model/convert-acp-item';
import { createChatThreadState, reduceChatThreadState, type ChatThreadState } from '../../controller/chat-thread-state';
import { projectChatThreadMessages } from '../../controller/project-messages';

export { render };

function Assistant() {
  return (
    <MessagePrimitive.Root data-testid="msg">
      <MessagePrimitive.GroupedParts groupBy={() => []} indicator="never">
        {({ part }) => {
          if (part.type === 'text') return <MarkdownText {...part} />;
          if (part.type === 'tool-call') return <div data-testid="tool" />;
          return null;
        }}
      </MessagePrimitive.GroupedParts>
    </MessagePrimitive.Root>
  );
}

export function Harness({ messages, isRunning }: { messages: ThreadMessageLike[]; isRunning: boolean }) {
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

const stampFor = () => new Date(0);

function meta(fields: Record<string, unknown> = {}) {
  return { '_mainframe.dev': fields };
}

export function textItem(
  id: string,
  text: string,
  opts: { streaming?: boolean; origin?: 'live' | 'replay'; containerId?: string; extra?: Record<string, unknown> } = {},
): AccumulatedItem {
  return {
    kind: 'message',
    id,
    role: 'agent',
    content: [{ type: 'text', text }],
    meta: meta({
      containerId: opts.containerId ?? id,
      ...(opts.streaming !== undefined ? { streaming: opts.streaming } : {}),
      ...opts.extra,
    }),
    origin: opts.origin,
  };
}

function stateFromItems(items: AccumulatedItem[], phase: 'running' | 'idle'): ChatThreadState {
  let state = createChatThreadState('c1');
  if (phase === 'running') state = reduceChatThreadState(state, { type: 'run.started' });
  state = reduceChatThreadState(state, { type: 'transcript.updated', messages: convertAcpItems(items, stampFor) });
  if (phase === 'idle') state = reduceChatThreadState(state, { type: 'run.stopped' });
  return state;
}

export function messagesFromItems(items: AccumulatedItem[], phase: 'running' | 'idle'): ThreadMessageLike[] {
  return projectChatThreadMessages(stateFromItems(items, phase));
}

export const tick = (ms: number): void => void act(() => void vi.advanceTimersByTime(ms));
export const flush = (): Promise<void> => act(async () => void (await new Promise((r) => setImmediate(r))));

/** Finds the first Text node under `root` whose data contains `needle`, and selects exactly that substring. */
export function selectSubstring(root: ParentNode, needle: string): Range {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const idx = node.data.indexOf(needle);
    if (idx >= 0) {
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + needle.length);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      // A real browser fires `selectionchange` on every user-driven selection
      // change; jsdom does not simulate that for a programmatic `addRange` —
      // dispatch it ourselves so `selection-hold.ts`'s listener reacts, same
      // as it would for a real mouse/keyboard selection.
      document.dispatchEvent(new Event('selectionchange'));
      return range;
    }
  }
  throw new Error(`selectSubstring: "${needle}" not found under ${root.nodeName}`);
}

export function assertSelectionSurvived(expectedText: string): void {
  const selection = window.getSelection()!;
  if (selection.rangeCount <= 0) throw new Error('assertSelectionSurvived: no selection');
  const range = selection.getRangeAt(0);
  if (range.collapsed) throw new Error('assertSelectionSurvived: selection collapsed');
  if (!document.contains(range.startContainer) || !document.contains(range.endContainer)) {
    throw new Error('assertSelectionSurvived: selection detached from the document');
  }
  if (selection.toString() !== expectedText) {
    throw new Error(`assertSelectionSurvived: expected "${expectedText}", got "${selection.toString()}"`);
  }
}

/** Collapses the selection and fires `selectionchange`, same as a real click-away. */
export function clearSelection(): void {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event('selectionchange'));
}

/**
 * Collapses the selection WITHOUT firing `selectionchange` — simulates a
 * missed event (WebKit is unreliable here, notably `removeAllRanges()` after
 * a Quote action), independent review round 3, finding 1.
 */
export function clearSelectionWithoutEvent(): void {
  window.getSelection()?.removeAllRanges();
}

export const shownText = (): string => document.querySelector('[data-status]')!.textContent ?? '';
