/**
 * store/intent-subscriber.ts
 *
 * Subscribes to `open-file` and `reveal-file` surface intents and drives the
 * tab store + layout store accordingly.
 *
 * This module is a PURE side-effect bridge between the intent bus and the two
 * stores. It must be mounted once (in SurfaceHost, or the app root) and never
 * re-subscribed on state changes — the callbacks capture live store state via
 * `getState()` calls, not via closure.
 *
 * Behaviour mirrored from 04-engine.jsx openTargetWS:
 *  - open-file: openTab(path, {mode:'preview'}) + ensure Files surface is active.
 *  - reveal-file: ensure Files surface is active (tree-reveal is a TODO — the
 *    tree component doesn't exist yet; we at minimum surface the panel).
 */
import { pickViewerKind } from '@/features/viewers/viewer-router';
import { onSurfaceIntent } from './surface-intents';
import { useLayoutStore } from './layout';
import { useTabsStore } from './tabs';
import type { OpenTabTarget } from './tabs';

/** Ensure the Files surface is visible in the layout. Pure store call. */
function ensureFilesActive(): void {
  const state = useLayoutStore.getState();
  const { layout } = state;
  const isActive = layout.top.includes('files') || layout.bottom === 'files';
  if (!isActive) {
    state.toggleSurface('files');
  }
}

/** Derive the tab kind for a file path using the viewer router's classifier. */
function kindForPath(path: string): OpenTabTarget['kind'] {
  const vk = pickViewerKind(path);
  if (vk === 'code') return 'code';
  return 'viewer';
}

/**
 * Register the `open-file` / `reveal-file` subscribers.
 * Returns an unsubscribe function — call it on component unmount.
 *
 * Designed to be called once from `useEffect(() => { return subscribeToFileIntents(); }, [])`.
 */
export function subscribeToFileIntents(): () => void {
  return onSurfaceIntent((intent) => {
    if (intent.type === 'open-file') {
      const path = intent.path;
      const title = path.split('/').pop() ?? path;
      const kind = kindForPath(path);

      useTabsStore.getState().openTab({ kind, path, title }, { mode: 'preview' });
      ensureFilesActive();
      return;
    }

    if (intent.type === 'reveal-file') {
      // Activate Files surface so the user can see the tree.
      // Full tree-scroll/select reveal requires a file-tree component (Phase 8+).
      ensureFilesActive();
      // TODO(Phase 8): emit a secondary intent or call a tree-scroll action here.
      return;
    }
  });
}
