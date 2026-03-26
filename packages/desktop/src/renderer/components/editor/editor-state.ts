/**
 * Bridge between the active Monaco editor instance and the tabs store.
 *
 * Tracks the *previous* editor view state (scroll + cursor + selections + folds)
 * so that when CMD+click triggers go-to-definition, we save the state from
 * before the click moved the cursor — not the click-target state.
 *
 * View states are typed as `unknown` here to avoid leaking Monaco types into
 * the store layer. MonacoEditor casts them back on restore.
 */

let previousState: unknown = null;
let currentState: unknown = null;

/**
 * Called by MonacoEditor on cursor or scroll changes.
 * Rolls the window: old current becomes previous, new snapshot becomes current.
 */
export function updateEditorViewState(viewState: unknown): void {
  previousState = currentState;
  currentState = viewState;
}

/** Called by MonacoEditor on unmount. */
export function clearEditorViewState(): void {
  previousState = null;
  currentState = null;
}

/**
 * Returns the view state to save for navigation history.
 *
 * Prefers `previousState` because CMD+click moves the cursor (firing an
 * onDidChangeCursorPosition event that updates currentState) *before*
 * go-to-definition calls openEditorTab. The previous state is the one
 * the user actually saw.
 */
export function getEditorViewStateForNav(): unknown {
  return previousState ?? currentState;
}
