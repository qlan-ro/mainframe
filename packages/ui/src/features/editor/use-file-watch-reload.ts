/**
 * useFileWatchReload — subscribes to disk changes for a project file and
 * applies the new content either silently (clean buffer) or via a conflict
 * banner (dirty buffer).
 *
 * Extracted from EditorTab to keep that file under the 300-line limit.
 */
import { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import { daemonWs } from '@/lib/daemon/ws-client';
import { getProjectFile } from '@/lib/api/files';
import { applyValueUpdate } from '@/lib/editor/apply-value-update';
import { useEditorStore } from '@/store/editor';

export interface DiskConflict {
  /** The new content from disk. */
  diskContent: string;
}

export interface UseFileWatchReloadResult {
  /** Non-null when a dirty-buffer conflict is pending. */
  diskConflict: DiskConflict | null;
  /** Apply disk content and clear the conflict banner. */
  reload: () => void;
  /** Dismiss the conflict banner without applying disk content. */
  keepMine: () => void;
}

interface UseFileWatchReloadOptions {
  /** Absolute or relative path as used by the editor. The watcher registers on
   *  this path; D3 maps resolved paths back so the listener fires correctly. */
  path: string;
  /** Set to true when a real project context is available. When false the
   *  watcher is not registered (no-project / Tauri-bridge fallback mode). */
  enabled: boolean;
  port: number;
  projectId: string | undefined;
  chatId: string | undefined;
  /** Ref to the live EditorView — used to apply updates via applyValueUpdate. */
  viewRef: MutableRefObject<EditorView | null>;
  /** Callback to update the load-state value in the parent when silently reloading. */
  onSilentReload: (content: string) => void;
}

export function useFileWatchReload({
  path,
  enabled,
  port,
  projectId,
  chatId,
  viewRef,
  onSilentReload,
}: UseFileWatchReloadOptions): UseFileWatchReloadResult {
  const [diskConflict, setDiskConflict] = useState<DiskConflict | null>(null);

  // Keep a stable ref to the latest path so the async fetch closure can
  // compare and ignore stale responses after a path change.
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!enabled || !path) return;

    const fileContext = projectId ? { projectId, chatId } : undefined;
    daemonWs.subscribeFile(path, fileContext);

    const unregister = daemonWs.onFileChange(path, () => {
      if (!projectId) return;
      getProjectFile(port, projectId, pathRef.current, chatId)
        .then((content) => {
          if (pathRef.current !== path) return; // path changed, discard
          const buf = useEditorStore.getState().getBuffer(path);
          if (buf?.dirty) {
            // Dirty buffer: surface the conflict banner.
            setDiskConflict({ diskContent: content });
          } else {
            // Clean buffer: apply silently.
            onSilentReload(content);
            if (viewRef.current) {
              applyValueUpdate(viewRef.current, content);
            }
          }
        })
        .catch((err: unknown) => {
          console.warn('[useFileWatchReload] failed to re-fetch after disk change', err);
        });
    });

    return () => {
      unregister();
      daemonWs.unsubscribeFile(path, fileContext);
    };
  }, [path, enabled, port, projectId, chatId, viewRef, onSilentReload]);

  const reload = () => {
    if (!diskConflict) return;
    const content = diskConflict.diskContent;
    setDiskConflict(null);
    onSilentReload(content);
    if (viewRef.current) {
      applyValueUpdate(viewRef.current, content);
    }
  };

  const keepMine = () => {
    setDiskConflict(null);
  };

  return { diskConflict, reload, keepMine };
}
