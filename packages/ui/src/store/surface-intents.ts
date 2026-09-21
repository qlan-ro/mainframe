import type { TabMode } from './run-pane';

export type SurfaceIntent =
  /** `mode` requests a permanent tab; omitted (or 'preview') keeps today's preview behavior. */
  | { type: 'open-file'; path: string; line?: number; character?: number; mode?: TabMode }
  | { type: 'open-diff'; path: string; original?: string; modified?: string; mode?: TabMode }
  | { type: 'reveal-file'; path: string }
  | { type: 'activate-surface'; surface: 'chat' | 'workspace' }
  /** Trigger the file-open picker / command palette. */
  | { type: 'open-file-picker' }
  /** Spawn a new terminal in the workspace (optionally targeting a pane). */
  | { type: 'new-terminal'; paneId?: string }
  /**
   * Open (or focus) a URL tab in the workspace (optionally targeting a pane).
   * Omit `url` for a blank tab — it renders the address bar with nothing loaded,
   * which is what ⌘T opens.
   */
  | { type: 'open-url-tab'; url?: string; paneId?: string }
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
  /** Toggle the workspace surface's local Files sidebar (expands → also lights the workspace). */
  | { type: 'toggle-workspace-files' };

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
