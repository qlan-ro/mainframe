/**
 * Where a transcript's own files are. The chat column needs none: the open-file
 * intents resolve against the active session, which is the conversation. A chat
 * in a workspace tab can be another worktree's or project's, where the same
 * relative path is a different file, so its paths leave the tab absolute.
 */
import { createContext, useCallback, useContext } from 'react';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { toFileRef, type FileBases } from '@/lib/files/file-ref';

export const ChatFileBasesContext = createContext<FileBases | null>(null);

/** What a transcript's paths are relative to: its own chat's files, or the active session's. */
export function useFileBases(): FileBases {
  const active = useActiveBasesStore((s) => s.bases);
  return useContext(ChatFileBasesContext) ?? active;
}

/** The path to put in an intent: absolute inside a tab with bases of its own, as given otherwise. */
export function useIntentPath(): (path: string) => string {
  const bases = useContext(ChatFileBasesContext);
  return useCallback((path: string) => (bases == null ? path : (toFileRef(path, bases).absolute ?? path)), [bases]);
}
