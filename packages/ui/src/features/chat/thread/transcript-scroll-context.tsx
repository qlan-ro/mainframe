import { createContext, useContext, type RefObject } from 'react';
export interface TranscriptScrollController {
  viewportElement: RefObject<HTMLDivElement | null>;
  beginInteraction: () => () => void;
}
const Context = createContext<TranscriptScrollController | null>(null);
export const TranscriptScrollProvider = Context.Provider;
export const useTranscriptScroll = () => useContext(Context);
