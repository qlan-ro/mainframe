/**
 * Seams that tool cards depend on but that belong to other surfaces.
 *
 * - `useChatId` reads the active chat id from the runtime `extras`.
 * - `useOpenFile` emits surface intents; only `layout/` subscribes.
 */
import { useCallback } from 'react';
import { useTranscriptScope } from '../messages/compact/transcript-scope';
import { useChatExtras } from '../runtime/chat-extras';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useIntentPath } from './chat-file-bases';

/** The active chat id, or undefined before the runtime is ready. */
export function useChatId(): string | undefined {
  const extras = useChatExtras();
  const scope = useTranscriptScope();
  return extras?.state.chatId ?? scope.chatId;
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
  const intentPath = useIntentPath();
  const openFile = useCallback(
    (path: string, position?: OpenFilePosition) => {
      emitSurfaceIntent({
        type: 'open-file',
        path: intentPath(path),
        line: position?.line,
        character: position?.character,
      });
    },
    [intentPath],
  );
  const openDiff = useCallback(
    (path: string, original: string, modified: string) => {
      emitSurfaceIntent({ type: 'open-diff', path: intentPath(path), original, modified });
    },
    [intentPath],
  );
  const revealFile = useCallback(
    (path: string) => {
      emitSurfaceIntent({ type: 'reveal-file', path: intentPath(path) });
    },
    [intentPath],
  );
  return { openFile, openDiff, revealFile };
}
