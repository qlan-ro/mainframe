/**
 * Discriminates nested (subagent) transcript rendering from top-level.
 *
 * `boundedMessageComponents` is one canonical `components` map consumed by
 * both `ChatThread.tsx` and `TaskCard.tsx`, and `AssistantMessage` takes no
 * props — so "nested messages mount no context-menu wrapper" needs an actual
 * discriminator that survives arbitrary nesting depth. A React context does
 * that; a second `components` map would not (spec Decision 19).
 */
import { createContext, useContext, type ReactNode } from 'react';

const NestedTranscriptContext = createContext(false);

export function NestedTranscriptProvider({ children }: { children: ReactNode }) {
  return <NestedTranscriptContext.Provider value={true}>{children}</NestedTranscriptContext.Provider>;
}

export function useIsNestedTranscript(): boolean {
  return useContext(NestedTranscriptContext);
}
