export type SurfaceIntent =
  | { type: 'open-file'; path: string; line?: number; character?: number }
  | { type: 'open-diff'; path: string }
  | { type: 'reveal-file'; path: string }
  | { type: 'activate-surface'; surface: 'chat' | 'files' | 'run' }
  /** Trigger the file-open picker / command palette in the Files surface. */
  | { type: 'open-file-picker' }
  /** Switch the InspectorPane to the specified tab. */
  | { type: 'inspector-tab'; tab: 'files' | 'changes' }
  /** Spawn a new terminal in the Run surface (optionally targeting a pane). */
  | { type: 'new-terminal'; paneId?: string };

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
