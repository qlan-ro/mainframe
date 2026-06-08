export type SurfaceIntent =
  | { type: 'open-file'; path: string }
  | { type: 'reveal-file'; path: string }
  | { type: 'activate-surface'; surface: 'chat' | 'files' | 'run' };

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
