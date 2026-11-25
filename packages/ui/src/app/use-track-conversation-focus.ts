import { useEffect } from 'react';
import { trackConversationFocus } from '@/lib/conversation-focus';

/** Mounted once, by the app's shell. */
export function useTrackConversationFocus(): void {
  useEffect(trackConversationFocus, []);
}
