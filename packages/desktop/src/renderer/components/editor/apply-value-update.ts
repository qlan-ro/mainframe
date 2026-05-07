import type * as monacoType from 'monaco-editor';

/**
 * Apply a new value to a Monaco editor's text model while preserving the
 * editor's view state (scroll position, cursor, folding, selection).
 *
 * `model.setValue` resets the model and clears any view state attached to it,
 * which is the source of "external file change scrolls editor to the top"
 * (issue #151). Saving the view state before the swap and restoring it after
 * keeps the user's place. No-ops when the value is unchanged.
 */
export function applyValueUpdate(
  editor: monacoType.editor.IStandaloneCodeEditor,
  model: monacoType.editor.ITextModel,
  nextValue: string,
): void {
  if (model.getValue() === nextValue) return;
  const saved = editor.saveViewState();
  model.setValue(nextValue);
  if (saved) {
    editor.restoreViewState(saved);
  }
}
