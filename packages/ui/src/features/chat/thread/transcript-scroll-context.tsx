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
  /** While following, move to the tail now (from a layout effect, before paint). */
  followNow?: () => void;
  /** The chat this list belongs to (a jump or Find names a chat; a list answers only its own). */
  chatId?: string;
  /** This list is the one Find searches (the focused main chat), so only it reveals every row for Find. */
  findOwner?: boolean;
  /** Whether rows of the first window are still waiting to mount above the newest ones (tail-first). */
  tailPending?: {
    get: () => boolean;
    subscribe: (listener: () => void) => () => void;
    set: (pending: boolean) => void;
  };
}
const Context = createContext<TranscriptScrollController | null>(null);
export const TranscriptScrollProvider = Context.Provider;
export const useTranscriptScroll = () => useContext(Context);
