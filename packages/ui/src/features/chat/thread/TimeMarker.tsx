import { useAuiState } from '@assistant-ui/react';
import { useChatExtrasSelector } from '../runtime/chat-extras';
import { timeMarker } from '../view-model/time-markers';

/** The centred time above a message, where the conversation starts or resumes (T1b). */
export function TimeMarker({ index }: { index: number }) {
  const hasMore = useChatExtrasSelector((extras) => extras?.state.historyWindow?.hasMore === true);
  const label = useAuiState((s) => timeMarker(s.thread.messages, index, !hasMore, new Date()));
  if (!label) return null;
  return (
    <div data-testid="chat-time-marker" className="mf-tr-meta pt-2 pb-1 text-center text-muted-foreground tabular-nums">
      {label}
    </div>
  );
}
