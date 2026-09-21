/**
 * useCommentViewSync — keeps a CM6 view's gutter markers in sync with a note
 * set owned above it (markdown/CSV/SVG Source mode).
 *
 * Two directions, kept separate so neither can loop into the other:
 *   - model -> view: an effect, keyed by comment id (not full note equality),
 *     seeds the view on mount and reconciles on every owned-set change. A
 *     write-back that only moves a note's range never changes the id sets,
 *     so it never re-triggers a dispatch here.
 *   - view -> model: an EditorView.updateListener extension that, on a doc
 *     change, pushes each anchor's mapped start/end line back into the owned
 *     model via setNoteRange. It reads the model through a ref so its own
 *     identity stays stable across renders (merging it into the view's
 *     extensions must not force a remount).
 *
 * Entirely inert when no model is injected (the code/diff editor's own path).
 */
import { useEffect, useMemo, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { addCommentEffect, deleteCommentEffect, getCommentsFromState } from './comment-gutter';
import type { UseFileNotesResult } from './use-file-notes';

export interface UseCommentViewSyncOptions {
  view: EditorView | null;
  model: UseFileNotesResult | undefined;
}

export interface UseCommentViewSyncResult {
  /** Merge into the view's extensions so document edits write ranges back into the model. */
  writeBackExtension: Extension;
}

export function useCommentViewSync({ view, model }: UseCommentViewSyncOptions): UseCommentViewSyncResult {
  const modelRef = useRef(model);
  modelRef.current = model;

  useEffect(() => {
    if (!view || !model) return;

    const cmIds = new Set(getCommentsFromState(view.state).map((c) => c.id));
    const modelIds = new Set(model.notes.map((n) => n.id));

    for (const note of model.notes) {
      if (cmIds.has(note.id)) continue;
      // Past-EOF: the note still counts toward the submit bar, it just has
      // nowhere on the current document to anchor a marker.
      if (note.startLine > view.state.doc.lines) continue;
      view.dispatch({
        effects: [addCommentEffect.of({ id: note.id, line: note.endLine, startLine: note.startLine, text: note.text })],
      });
    }

    for (const id of cmIds) {
      if (!modelIds.has(id)) {
        view.dispatch({ effects: [deleteCommentEffect.of(id)] });
      }
    }
  }, [view, model]);

  const writeBackExtension = useMemo<Extension>(
    () =>
      EditorView.updateListener.of((update) => {
        const currentModel = modelRef.current;
        if (!currentModel || !update.docChanged) return;

        for (const comment of getCommentsFromState(update.state)) {
          const note = currentModel.notes.find((n) => n.id === comment.id);
          if (note && (note.startLine !== comment.startLine || note.endLine !== comment.endLine)) {
            currentModel.setNoteRange(comment.id, comment.startLine, comment.endLine);
          }
        }
      }),
    [],
  );

  return { writeBackExtension };
}
