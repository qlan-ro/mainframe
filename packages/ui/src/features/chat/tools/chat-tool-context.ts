/**
 * Seams that tool cards depend on but that belong to other surfaces.
 *
 * - `useChatId` reads the chat id from the transcript's scope, or the runtime `extras`.
 * - `useOpenFile` emits surface intents; only `layout/` subscribes.
 */
import { useCallback } from 'react';
import { useTranscriptScope } from '../messages/turn/transcript-scope';
import { useChatExtras } from '../runtime/chat-extras';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useIntentPath } from './chat-file-bases';

/**
 * The chat the transcript is of, or undefined before the runtime is ready. A
 * sub-agent's tab binds no thread, so the extras there are the chat column's.
 */
export function useChatId(): string | undefined {
  const extras = useChatExtras();
  const scope = useTranscriptScope();
  return scope.chatId ?? extras?.state.chatId;
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
      const resolvedPath = intentPath(path);
      emitSurfaceIntent({
        type: 'open-file',
        path: resolvedPath,
        line: position?.line,
        character: position?.character,
      });
      emitSurfaceIntent({ type: 'reveal-file', path: resolvedPath });
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
