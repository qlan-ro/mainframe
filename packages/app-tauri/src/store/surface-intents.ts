export type SurfaceIntent =
  | { type: 'open-file'; path: string; line?: number; character?: number }
  | { type: 'open-diff'; path: string; original?: string; modified?: string }
  | { type: 'reveal-file'; path: string }
  | { type: 'activate-surface'; surface: 'chat' | 'files' | 'run' }
  /** Trigger the file-open picker / command palette in the Files surface. */
  | { type: 'open-file-picker' }
  /** Switch the InspectorPane to the specified tab. */
  | { type: 'inspector-tab'; tab: 'files' | 'changes' }
  /** Spawn a new terminal in the Run surface (optionally targeting a pane). */
  | { type: 'new-terminal'; paneId?: string }
  /** Open the global search / command palette overlay. */
  | { type: 'open-search-palette' }
  /** Open the find-in-path overlay scoped to a file or directory. */
  | { type: 'open-find-in-path'; scopePath: string; scopeType: 'file' | 'directory' }
  /** Open the review modal overlay. */
  | { type: 'open-review' }
  /** Open the settings dialog. */
  | { type: 'open-settings' }
  /** Toggle the left sidebar. */
  | { type: 'toggle-sidebar' }
  /** Toggle the right inspector. */
  | { type: 'toggle-inspector' };

type Listener = (intent: SurfaceIntent) => void;

const listeners = new Set<Listener>();

export function emitSurfaceIntent(intent: SurfaceIntent): void {
  for (const fn of listeners) fn(intent);
}

/** Subscribe to surface intents. Returns an unsubscribe function. */
export function onSurfaceIntent(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
