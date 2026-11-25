'use client';

/** Above the card: the project and branch before the first message (K3), the ongoing work after it (K4). */
import { useAuiState } from '@assistant-ui/react';
import { useChatExtrasSelector } from '../../runtime/chat-extras';
import { ActivityStrip } from './ActivityStrip';
import { DraftStrip } from './DraftStrip';

export function TopStrip() {
  const started = useAuiState((s) => s.thread.messages.length > 0);
  const isDraft = useChatExtrasSelector(
    (extras) => extras != null && extras.state.chatConfig == null && extras.state.chatId.startsWith('__LOCALID_'),
  );
  if (!started && isDraft) return <DraftStrip />;
  return <ActivityStrip />;
}
