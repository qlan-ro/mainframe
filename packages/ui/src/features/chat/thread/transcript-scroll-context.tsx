import { createContext, useContext, type RefObject } from 'react';
export interface TranscriptScrollController {
  viewport?: HTMLDivElement | null;
  viewportElement: RefObject<HTMLDivElement | null>;
  isFollowing: () => boolean;
  isInteracting?: () => boolean;
  beginInteraction: () => () => void;
  /** Re-pins to the bottom and jumps there; the user's own send calls it. */
  pinToBottom?: () => void;
}
const Context = createContext<TranscriptScrollController | null>(null);
export const TranscriptScrollProvider = Context.Provider;
export const useTranscriptScroll = () => useContext(Context);
