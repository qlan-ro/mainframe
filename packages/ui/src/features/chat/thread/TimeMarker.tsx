import { useAuiState } from '@assistant-ui/react';
import { useChatExtrasSelector } from '../runtime/chat-extras';
import { isPlaceholder } from '../view-model/placeholder';
import { timeMarker } from '../view-model/time-markers';

/** The centred time above a message, where the conversation starts or resumes (T1b). */
export function TimeMarker({ index }: { index: number }) {
  const hasMore = useChatExtrasSelector((extras) => extras?.state.historyWindow?.hasMore === true);
  // The stand-in is dated now: after a long run it would claim a gap.
  const label = useAuiState((s) =>
    isPlaceholder(s.thread.messages[index]) ? null : timeMarker(s.thread.messages, index, !hasMore, new Date()),
  );
  if (!label) return null;
  return (
    <div
      data-testid="chat-time-marker"
      className="mt-1 -mb-1 flex justify-center mf-tr-clock text-(--mf-tr-muted) tabular-nums"
    >
      {label}
    </div>
  );
}
