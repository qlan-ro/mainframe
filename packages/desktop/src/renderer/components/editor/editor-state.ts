/**
 * Bridge between the active Monaco editor instance and the tabs store.
 *
 * Tracks the *previous* cursor position so that when CMD+click triggers
 * go-to-definition, we save where the user was before the click moved the
 * cursor — not the click target itself.
 */

export interface CursorPosition {
  line: number;
  column: number;
}

let previousPosition: CursorPosition | null = null;
let currentPosition: CursorPosition | null = null;

/** Called by MonacoEditor's onDidChangeCursorPosition listener. */
export function updateCursorPosition(pos: CursorPosition): void {
  previousPosition = currentPosition;
  currentPosition = pos;
}

/** Called by MonacoEditor on mount/unmount. */
export function clearCursorTracking(): void {
  previousPosition = null;
  currentPosition = null;
}

/**
 * Returns the cursor position to save for navigation history.
 *
 * Uses the previous position because CMD+click moves the cursor to the
 * clicked word *before* go-to-definition fires openEditorTab. The previous
 * position is where the user actually was.
 */
export function getActiveEditorCursorPosition(): CursorPosition | null {
  return previousPosition ?? currentPosition;
}
