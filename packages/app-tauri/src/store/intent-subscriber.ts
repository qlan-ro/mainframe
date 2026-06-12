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
 * Path normalization (F1 fix): before opening a tab the raw intent path is
 * normalized via `toFileRef` against the active bases (worktreePath /
 * projectPath, pushed into `useActiveBasesStore` by `useActiveBases`). This
 * gives all flavors — absolute tool-card paths, base-relative tree paths,
 * file:// LSP URIs — the same canonical relative key in the tabs store.
 *
 * Behaviour mirrored from 04-engine.jsx openTargetWS:
 *  - open-file: openTab(path, {mode:'preview'}) + ensure Files surface is active.
 *    When the intent carries a `line`/`character` position, also stashes a
 *    reveal target in useEditorStore so CmEditor can scroll to it on mount.
 *  - reveal-file: ensure Files surface is active (tree-reveal is a TODO — the
 *    tree component doesn't exist yet; we at minimum surface the panel).
 */
import { pickViewerKind } from '@/features/viewers/viewer-router';
import { toFileRef } from '@/lib/files/file-ref';
import { onSurfaceIntent } from './surface-intents';
import { useLayoutStore } from './layout';
import { useTabsStore } from './tabs';
import { useEditorStore } from './editor';
import { useFilesStore } from './files';
import { useActiveBasesStore } from './active-bases-store';
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
      const { path: rawPath, line, character } = intent;

      // Normalize to canonical base-relative path (F1 fix).
      const bases = useActiveBasesStore.getState().bases;
      const ref = toFileRef(rawPath, bases);
      const path = ref.relative;

      const title = path.split('/').pop() ?? path;
      const kind = kindForPath(path);

      useTabsStore.getState().openTab({ kind, path, title }, { mode: 'preview' });
      ensureFilesActive();

      // Stash a reveal target if both line and character are provided.
      if (typeof line === 'number' && typeof character === 'number') {
        useEditorStore.getState().setRevealTarget(path, { line, character });
      }
      return;
    }

    if (intent.type === 'open-diff') {
      const { path: rawPath } = intent;

      // Normalize to canonical base-relative path (same as open-file).
      const bases = useActiveBasesStore.getState().bases;
      const ref = toFileRef(rawPath, bases);
      const path = ref.relative;

      const title = path.split('/').pop() ?? path;

      // Open a diff tab; DiffTab will fetch HEAD-vs-working when original/modified
      // are absent, so we don't need to pass them here.
      useTabsStore.getState().openTab({ kind: 'diff', path, title }, { mode: 'preview' });
      ensureFilesActive();
      return;
    }

    if (intent.type === 'reveal-file') {
      // Activate Files surface so the user can see the tree.
      ensureFilesActive();
      // Normalize the path (same logic as open-file) and stash it for the tree.
      const bases = useActiveBasesStore.getState().bases;
      const ref = toFileRef(intent.path, bases);
      useFilesStore.getState().setRevealTarget(ref.relative);
      return;
    }

    if (intent.type === 'open-file-picker') {
      // Open the file-picker dialog. FilePickerDialog subscribes to this flag
      // via useFilesStore and renders the command-palette UI.
      useFilesStore.getState().setPickerOpen(true);
      return;
    }

    // 'inspector-tab' intents are consumed directly by InspectorPane via its
    // own onSurfaceIntent subscription — no action needed here.
  });
}
