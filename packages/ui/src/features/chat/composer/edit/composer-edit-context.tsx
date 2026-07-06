'use client';

/**
 * Shared "editing a queued message" state — links the queued cards (which start
 * an edit) to the composer (which enters edit mode). When `editing` is set, the
 * Composer loads that queued message's content into edit mode (amber header,
 * Save / Cancel-edit); the message stays queued until the run finishes.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export interface QueuedEdit {
  readonly messageId: string;
  readonly content: string;
}

interface ComposerEditValue {
  readonly editing: QueuedEdit | null;
  readonly startEdit: (edit: QueuedEdit) => void;
  readonly cancelEdit: () => void;
}

const NOOP: ComposerEditValue = { editing: null, startEdit: () => {}, cancelEdit: () => {} };
const ComposerEditContext = createContext<ComposerEditValue>(NOOP);

export function ComposerEditProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState<QueuedEdit | null>(null);
  const startEdit = useCallback((edit: QueuedEdit) => setEditing(edit), []);
  const cancelEdit = useCallback(() => setEditing(null), []);
  return (
    <ComposerEditContext.Provider value={{ editing, startEdit, cancelEdit }}>{children}</ComposerEditContext.Provider>
  );
}

export function useComposerEdit(): ComposerEditValue {
  return useContext(ComposerEditContext);
}
