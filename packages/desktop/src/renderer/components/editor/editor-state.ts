/**
 * Bridge between the active Monaco editor instance and the tabs store.
 *
 * Uses a debounced "stable" state so that rapid events from a CMD+click
 * (cursor move + scroll + highlight) don't overwrite the pre-click state
 * before go-to-definition reads it.
 *
 * View states are typed as `unknown` to avoid leaking Monaco types into
 * the store layer. MonacoEditor casts them back on restore.
 */

/** The last confirmed-stable view state (updated after 150ms of idle). */
let stableState: unknown = null;
/** The most recent view state snapshot (may reflect a mid-action state). */
let latestState: unknown = null;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 150;

/**
 * Called by MonacoEditor on cursor or scroll changes.
 * The latest snapshot is stored immediately; it only promotes to "stable"
 * after the editor is idle for DEBOUNCE_MS.
 */
export function updateEditorViewState(viewState: unknown): void {
  latestState = viewState;
  if (debounceTimer != null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    stableState = latestState;
    debounceTimer = null;
  }, DEBOUNCE_MS);
}

/** Called by MonacoEditor on unmount. */
export function clearEditorViewState(): void {
  stableState = null;
  latestState = null;
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/**
 * Returns the view state to save for navigation history.
 *
 * Prefers the debounced stable state — this is where the user was before
 * the CMD+click burst of events. Falls back to the latest snapshot if
 * no stable state has been recorded yet.
 */
export function getEditorViewStateForNav(): unknown {
  return stableState ?? latestState;
}
