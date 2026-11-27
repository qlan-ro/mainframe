import { createContext, useContext, type RefObject } from 'react';
export interface TranscriptScrollController {
  viewport?: HTMLDivElement | null;
  viewportElement: RefObject<HTMLDivElement | null>;
  isFollowing: () => boolean;
  isInteracting?: () => boolean;
  beginInteraction: () => () => void;
  /** The plain list's owner (no virtualizer, no row or prepend anchors of Mainframe's own). */
  owned?: boolean;
  /** Called before rows land above the reader, so the owner can record what they read. */
  beforePrepend?: () => void;
}
const Context = createContext<TranscriptScrollController | null>(null);
export const TranscriptScrollProvider = Context.Provider;
export const useTranscriptScroll = () => useContext(Context);
