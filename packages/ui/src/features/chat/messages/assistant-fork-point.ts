import {
  forkAvailability,
  type ForkAvailability,
  type ForkBaseInput,
} from '@/features/sessions/view-model/fork-availability';
import {
  forkFromMessageAvailability,
  latestSegmentBlock,
  type SegmentedMessage,
} from '@/features/sessions/view-model/fork-from-message-availability';

export type AssistantForkPoint = { kind: 'before'; messageId: string } | { kind: 'current' } | null;

export function assistantForkPoint(messages: readonly SegmentedMessage[], assistantId: string): AssistantForkPoint {
  const index = messages.findIndex((message) => message.id === assistantId && message.role === 'assistant');
  if (index < 0) return null;

  for (let i = index + 1; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.role === 'assistant') return null;
    if (message.role === 'user') return { kind: 'before', messageId: message.id };
  }

  return { kind: 'current' };
}

export function assistantForkAvailability(
  messages: readonly SegmentedMessage[],
  assistantId: string,
  point: NonNullable<AssistantForkPoint>,
  base: ForkBaseInput,
  current: { isRunning: boolean; hasPending: boolean; hasMoreHistory?: boolean },
): ForkAvailability {
  if (point.kind === 'current') {
    const segmentBlock = latestSegmentBlock(messages, assistantId);
    if (segmentBlock == null) return forkAvailability({ ...base, ...current });
    return forkFromMessageAvailability({
      ...base,
      messageUnsent: false,
      isFirstUserMessage: false,
      beforeLatestSegment: segmentBlock,
    });
  }

  const nextMeta = messages.find((message) => message.id === point.messageId)?.metadata?.custom?.mainframe;
  return forkFromMessageAvailability({
    ...base,
    messageUnsent: nextMeta?.pending === true || nextMeta?.queued === true || nextMeta?.error != null,
    isFirstUserMessage:
      !current.hasMoreHistory && messages.find((message) => message.role === 'user')?.id === point.messageId,
    beforeLatestSegment: latestSegmentBlock(messages, point.messageId),
  });
}
