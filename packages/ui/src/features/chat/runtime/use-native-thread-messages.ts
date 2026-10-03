import { useMemo } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { ChatThreadState } from '../controller/chat-thread-state';
import { TranscriptProjector } from '../controller/transcript-projector';

/** The native message list for an `ExternalThread({ messages })` mount — one identity-preserving projector per caller. */
export function useNativeThreadMessages(state: ChatThreadState): ThreadMessage[] {
  const projector = useMemo(() => new TranscriptProjector(), []);
  return useMemo(() => projector.projectMessages(state), [projector, state]);
}
