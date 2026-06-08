/**
 * Seams that tool cards depend on but that belong to other surfaces.
 *
 * - `useChatId` reads the active chat id from the runtime `extras`.
 * - `useOpenFile` emits surface intents; only `layout/` subscribes.
 */
import { useCallback } from 'react';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { emitSurfaceIntent } from '@/store/surface-intents';

/** The active chat id, or undefined before the runtime is ready. */
export function useChatId(): string | undefined {
  const extras = useChatExtras();
  return extras?.state.chatId;
}

export interface OpenFileIntent {
  openFile: (path: string) => void;
  revealFile: (path: string) => void;
}

export function useOpenFile(): OpenFileIntent {
  const openFile = useCallback((path: string) => {
    emitSurfaceIntent({ type: 'open-file', path });
  }, []);
  const revealFile = useCallback((path: string) => {
    emitSurfaceIntent({ type: 'reveal-file', path });
  }, []);
  return { openFile, revealFile };
}
