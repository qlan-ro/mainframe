/** Bridge between the active Monaco editor instance and the tabs store. */

interface CursorPosition {
  line: number;
  column: number;
}

type PositionGetter = () => CursorPosition | null;

let getPosition: PositionGetter | null = null;

/** Called by MonacoEditor on mount/unmount to register a cursor-position getter. */
export function setActiveEditorGetter(getter: PositionGetter | null): void {
  getPosition = getter;
}

/** Returns the live cursor position from the active Monaco editor, or null. */
export function getActiveEditorCursorPosition(): CursorPosition | null {
  return getPosition?.() ?? null;
}
