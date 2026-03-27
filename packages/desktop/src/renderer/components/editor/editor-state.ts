/**
 * Bridge between the active Monaco editor instance and the tabs store.
 *
 * Tracks two things independently:
 * 1. Full view state (scroll + cursor + folds) — rolling 2-slot window
 * 2. Cursor position — rolling 2-slot window
 *
 * On restore: apply view state first (gets scroll right), then override
 * the cursor with the previous cursor position (CMD+click moves cursor
 * before go-to-definition fires, so the view state's cursor is wrong).
 *
 * Types are `unknown` to avoid leaking Monaco types into the store layer.
 */

export interface CursorPosition {
  line: number;
  column: number;
}

// --- View state tracking (scroll + folds) ---
let previousViewState: unknown = null;
let currentViewState: unknown = null;

export function updateEditorViewState(viewState: unknown): void {
  previousViewState = currentViewState;
  currentViewState = viewState;
}

export function getEditorViewStateForNav(): unknown {
  return previousViewState ?? currentViewState;
}

// --- Cursor position tracking ---
let previousCursor: CursorPosition | null = null;
let currentCursor: CursorPosition | null = null;

export function updateCursorPosition(pos: CursorPosition): void {
  previousCursor = currentCursor;
  currentCursor = pos;
}

export function getCursorPositionForNav(): CursorPosition | null {
  return previousCursor ?? currentCursor;
}

// --- Cleanup ---
export function clearEditorViewState(): void {
  previousViewState = null;
  currentViewState = null;
  previousCursor = null;
  currentCursor = null;
}
