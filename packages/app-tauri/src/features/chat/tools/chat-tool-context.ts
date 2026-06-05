/**
 * Seams that tool cards depend on but that belong to other surfaces.
 *
 * - `useChatId` reads the active chat id from the runtime `extras` (the
 *   controller's ChatThreadState), so a card can fetch the full output of a
 *   truncated tool result without prop-drilling.
 * - `useOpenFile` is a forward-looking intent seam: the editor surface is a
 *   later migration leaf, so for now opening/revealing a file logs an intent.
 *   When the surface-intent bus lands, only this hook changes — not the cards.
 */
import { useCallback } from 'react';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';

/** The active chat id, or undefined before the runtime is ready. */
export function useChatId(): string | undefined {
  const extras = useChatExtras();
  return extras?.state.chatId;
}

export interface OpenFileIntent {
  openFile: (path: string) => void;
  revealFile: (path: string) => void;
}

/**
 * Returns intent callbacks for opening / revealing a file from a tool card.
 * Stubbed until the editor surface + surface-intent bus are ported (tracker:
 * "Surface-intent bus"). Cards bind to this stable shape today.
 */
export function useOpenFile(): OpenFileIntent {
  const openFile = useCallback((path: string) => {
    console.warn(`[chat] openFile intent (editor surface not yet ported): ${path}`);
  }, []);
  const revealFile = useCallback((path: string) => {
    console.warn(`[chat] revealFile intent (editor surface not yet ported): ${path}`);
  }, []);
  return { openFile, revealFile };
}
