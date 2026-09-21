/**
 * Seams that tool cards depend on but that belong to other surfaces.
 *
 * - `useChatId` reads the active chat id from the runtime `extras`.
 * - `useOpenFile` emits surface intents; only `layout/` subscribes.
 */
import { useCallback } from 'react';
import { useChatExtras } from '../runtime/chat-extras';
import { emitSurfaceIntent } from '@/store/surface-intents';

/** The active chat id, or undefined before the runtime is ready. */
export function useChatId(): string | undefined {
  const extras = useChatExtras();
  return extras?.state.chatId;
}

/** 0-based line/character reveal target, forwarded as-is to the open-file intent. */
export interface OpenFilePosition {
  line: number;
  character: number;
}

export interface OpenFileIntent {
  openFile: (path: string, position?: OpenFilePosition) => void;
  /** Open a diff tab showing pre-resolved original-vs-modified content. */
  openDiff: (path: string, original: string, modified: string) => void;
  revealFile: (path: string) => void;
}

export function useOpenFile(): OpenFileIntent {
  const openFile = useCallback((path: string, position?: OpenFilePosition) => {
    emitSurfaceIntent({ type: 'open-file', path, line: position?.line, character: position?.character });
  }, []);
  const openDiff = useCallback((path: string, original: string, modified: string) => {
    emitSurfaceIntent({ type: 'open-diff', path, original, modified });
  }, []);
  const revealFile = useCallback((path: string) => {
    emitSurfaceIntent({ type: 'reveal-file', path });
  }, []);
  return { openFile, openDiff, revealFile };
}
