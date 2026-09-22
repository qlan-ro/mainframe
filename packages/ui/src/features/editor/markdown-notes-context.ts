/**
 * markdown-notes-context — carries the lifted per-tab note set into
 * MarkdownPreview's rendered blocks.
 *
 * MarkdownAnnotatedBlock reads this via useMarkdownNotesContext instead of
 * threading props through react-markdown's component map. Absent (null)
 * means "no notes feature" — MarkdownAnnotatedBlock then renders its
 * children unwrapped, which is what keeps MarkdownPreview's own render
 * unchanged for callers that pass no `notes` prop.
 */
import { createContext, useContext } from 'react';
import type { UseFileNotesResult } from './inline-comments/use-file-notes';

export interface MarkdownNotesContextValue {
  /** Raw markdown source, sliced by a block's line range to quote its own text. */
  source: string;
  model: UseFileNotesResult;
  /** The note id whose widget is open on a Preview block, if any. */
  openNoteId: string | null;
  openNote: (id: string) => void;
  /** Sends a single note's review comment and removes it from every surface. */
  handleSendOne: (noteId: string) => Promise<void>;
}

const MarkdownNotesContext = createContext<MarkdownNotesContextValue | null>(null);

export const MarkdownNotesProvider = MarkdownNotesContext.Provider;

export function useMarkdownNotesContext(): MarkdownNotesContextValue | null {
  return useContext(MarkdownNotesContext);
}
