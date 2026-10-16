/**
 * viewer-file-path.ts
 *
 * Resolves a viewer's `path` prop to the absolute on-disk path that the native
 * file actions (Reveal in Finder, open with the default app) need, and gates
 * those actions on the file being reachable from this machine.
 *
 * Viewer paths are often worktree/project-relative (`src/spec.pdf`). They are
 * joined against the active bases from `useActiveBasesStore` — worktree first,
 * then project, the same precedence the tab used to relativize them. Absolute
 * paths (including external files) pass through. A relative path with no known
 * base resolves to null.
 */
import { useHost } from '@/lib/host';
import { useDaemonIsLocal } from '@/lib/daemon/use-daemon-is-local';
import { toFileRef } from '@/lib/files/file-ref';
import { useActiveBasesStore } from '@/store/active-bases-store';

export function useViewerAbsolutePath(path: string): string | null {
  const bases = useActiveBasesStore((s) => s.bases);
  return toFileRef(path, bases).absolute ?? null;
}

export type NativeFileAction = 'reveal' | 'open';

interface NativeFileActionState {
  /** Why the action is unavailable, or null when it can run. */
  disabledReason: string | null;
  run: () => Promise<void>;
}

/**
 * A native file action on the viewer's file: `reveal` shows it in Finder,
 * `open` opens it with its default app. Both need the daemon's filesystem to
 * be this machine's and an absolute path.
 */
export function useNativeFileAction(path: string, action: NativeFileAction): NativeFileActionState {
  const host = useHost();
  const isLocal = useDaemonIsLocal();
  const absolutePath = useViewerAbsolutePath(path);

  const disabledReason = !isLocal
    ? 'Unavailable: file lives on the remote server'
    : absolutePath === null
      ? 'Unavailable: project root is unknown for this relative path'
      : null;

  async function run() {
    if (disabledReason !== null || absolutePath === null) return;
    try {
      if (action === 'reveal') await host.fs.showItemInFolder(absolutePath);
      else await host.fs.openPath(absolutePath);
    } catch (err) {
      console.warn(`[viewer] ${action} failed`, absolutePath, err);
    }
  }

  return { disabledReason, run };
}
