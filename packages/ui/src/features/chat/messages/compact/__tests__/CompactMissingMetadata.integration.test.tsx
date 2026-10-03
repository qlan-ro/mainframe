import { useMemo } from 'react';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessage,
} from '@assistant-ui/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CompactTranscript } from '../CompactTranscript';
import { TranscriptScopeProvider } from '../transcript-scope';
import { boundedMessageComponents } from '../../bounded-messages';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import type { PresentationSource } from '@qlan-ro/mainframe-types';
import { useUiPrefs } from '@/store/ui-prefs';
import { createChatThreadState } from '../../../controller/chat-thread-state';
import { projectChatThreadMessages, projectChatThreadRepository } from '../../../controller/project-messages';
import { useNativeThreadMessages } from '../../../runtime/use-native-thread-messages';
import { convertAcpItems } from '../../../view-model/convert-acp-item';
import { TurnFixture, turnContext } from './turn-fixtures';

type Variant = 'absent metadata' | 'absent custom' | 'invalid Unicode spans';
const variants: Variant[] = ['absent metadata', 'absent custom', 'invalid Unicode spans'];
function invalidSources(length: number): PresentationSource[] {
  return [
    { sourceMessageId: 'work', start: 0, end: 2 },
    { sourceMessageId: 'final', start: 2, end: length },
  ].map(({ sourceMessageId, start, end }) => ({
    sourceMessageId,
    sourceBlockIndex: 0,
    presentation: { ...turnContext, phase: 'final_answer', finalEligible: true },
    target: { type: 'text', contentBlockIndex: 0, startUtf16: start, endUtf16: end },
  }));
}
function projected(variant: Variant, text: string, streaming = false, authoritativeItemStreaming = true) {
  const messages = convertAcpItems(
    [
      {
        id: 'wire',
        kind: 'message',
        role: 'agent',
        origin: 'live',
        content: [{ type: 'text', text }],
        meta: {
          '_mainframe.dev': {
            containerId: 'wire',
            created: true,
            timestamp: '2026-10-03T03:00:00Z',
            ...(streaming && { streaming: true }),
            ...(variant === 'invalid Unicode spans' && {
              presentationSources: { version: 1, sources: invalidSources(text.length) },
            }),
          },
        },
      },
    ],
    () => new Date(0),
  );
  expect(messages[0]!.metadata).toBeUndefined();
  if (variant === 'absent custom') messages[0] = { ...messages[0]!, metadata: {} };
  const state = { ...createChatThreadState('chat'), messages, authoritativeItemStreaming };
  const result = projectChatThreadMessages(state);
  expect(result[0]!.content).toBe(messages[0]!.content);
  expect(result[0]!.metadata).toBe(messages[0]!.metadata);
  return { state, messages: result };
}
interface FixtureProps {
  rootId: string;
  split: boolean;
  input: ReturnType<typeof projected>;
}
function Main({ rootId, input }: FixtureProps) {
  const repository = useMemo(() => projectChatThreadRepository(input.state), [input.state]);
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messageRepository: repository,
    isRunning: input.messages.some((message) => message.status?.type === 'running'),
    onNew: async () => {},
  });
  const scope = useMemo(() => ({ rootThreadId: rootId, ancestors: [], pendingToolIds: new Set<string>() }), [rootId]);
  const mode = useUiPrefs((state) => state.transcriptMode);
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>
        <TranscriptScopeProvider value={scope}>
          <ThreadPrimitive.Root>
            <ThreadPrimitive.Viewport>
              {mode === 'compact' ? (
                <CompactTranscript />
              ) : (
                <ThreadPrimitive.Messages components={boundedMessageComponents} />
              )}
            </ThreadPrimitive.Viewport>
          </ThreadPrimitive.Root>
        </TranscriptScopeProvider>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
function Split({ rootId, input }: FixtureProps) {
  const messages = useNativeThreadMessages(input.state);
  return <TurnFixture rootId={rootId} split messages={messages} />;
}
function Fixture(props: FixtureProps) {
  return props.split ? <Split {...props} /> : <Main {...props} />;
}
function expectVisibleText(text: string, status: 'running' | 'complete') {
  const element = screen.getByText(text);
  expect(element).toBeVisible();
  expect(screen.getAllByText(text)).toHaveLength(1);
  expect(element.closest('[data-status]')).toHaveAttribute('data-status', status);
  expect(screen.queryByRole('button', { name: 'Work details' })).toBeNull();
}
beforeEach(() => useUiPrefs.getState().setTranscriptMode('compact'));
for (const { split, authoritative } of [
  { split: false, authoritative: true },
  { split: true, authoritative: true },
  { split: false, authoritative: false },
  { split: true, authoritative: false },
]) {
  it.each(variants)(
    `keeps %s visible through native updates and mode changes (split=${split}, authoritative=${authoritative})`,
    async (variant) => {
      const rootId = `missing-${split}-${authoritative}-${variant}`;
      const initial = 'a😀b';
      const view = render(
        <Fixture rootId={rootId} split={split} input={projected(variant, initial, false, authoritative)} />,
      );
      expectVisibleText(initial, 'complete');
      const frame = view.container.querySelector('[data-message-id="wire"]');
      const growing = initial + ' grows';
      view.rerender(<Fixture rootId={rootId} split={split} input={projected(variant, growing, true, authoritative)} />);
      await waitFor(() => expectVisibleText(growing, 'running'));
      expect(view.container.querySelector('[data-message-id="wire"]')).toBe(frame);
      view.rerender(
        <Fixture rootId={rootId} split={split} input={projected(variant, growing, false, authoritative)} />,
      );
      await waitFor(() => expectVisibleText(growing, 'complete'));
      expect(view.container.querySelector('[data-message-id="wire"]')).toBe(frame);
      act(() => useUiPrefs.getState().setTranscriptMode('verbose'));
      expectVisibleText(growing, 'complete');
      act(() => useUiPrefs.getState().setTranscriptMode('compact'));
      expectVisibleText(growing, 'complete');
    },
  );
}
