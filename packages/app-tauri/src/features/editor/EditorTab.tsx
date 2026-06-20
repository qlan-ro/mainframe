/**
 * EditorTab — renders the active 'code' or 'viewer' tab in the Files surface.
 *
 * Responsibilities:
 *  - loads file content via lib/tauri bridge
 *  - routes through ViewerRouter (code → CmEditor, non-code → specific viewer)
 *  - mounts LSP extensions when projectId is available (Phase 3 seam)
 *  - promotes the tab to 'permanent' on first edit (mirrors prototype double-click)
 *  - syncs buffer state to the editor store on change
 *
 * data-testid: "editor-tab" on the root wrapper.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ViewerShell } from '@/features/viewers/ViewerShell';
import type { EditorView } from '@codemirror/view';
import { readFile } from '@/lib/tauri/bridge';
import { getProjectFile, saveProjectFile } from '@/lib/api/files';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { inferLanguage } from '@/lib/editor/file-types';
import { useEditorStore } from '@/store/editor';
import { useTabsStore } from '@/store/tabs';
import { ViewerRouter } from '@/features/viewers/viewer-router';
import { lspClientManager, getLspLanguage } from '@/lib/lsp';
import { EditorContextMenu } from './context-menu/EditorContextMenu';
import { CmEditorWithComments } from './inline-comments/CmEditorWithComments';
import { MarkdownEditorTab } from './MarkdownEditorTab';
import { useFileWatchReload } from './use-file-watch-reload';
import { useLspDocument } from './use-lsp-document';

interface EditorTabProps {
  tabId: string;
  path: string;
  /** When true, the editor is opened in read-only mode and a visual indicator is shown. */
  readOnly?: boolean;
}

type LoadState = { status: 'loading' } | { status: 'ready'; value: string } | { status: 'error'; message: string };

/** Save-status chip shown in the ViewerShell header actions slot. */
function SaveStatusChip({ dirty }: { dirty: boolean }) {
  if (dirty) {
    return (
      <span
        data-testid="editor-save-status"
        className="rounded-[4px] bg-mf-warning-tint px-[5px] py-[1px] font-mono text-micro text-mf-warning"
      >
        ● unsaved
      </span>
    );
  }
  return (
    <span
      data-testid="editor-save-status"
      className="rounded-[4px] bg-mf-success-tint px-[5px] py-[1px] font-mono text-micro text-mf-success"
    >
      ● saved
    </span>
  );
}

export function EditorTab({ tabId, path, readOnly = false }: EditorTabProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState<{ ln: number; col: number }>({ ln: 1, col: 1 });
  const setBuffer = useEditorStore((s) => s.setBuffer);
  const promoteTab = useTabsStore((s) => s.promoteTab);
  const port = useDaemonPort();
  const { projectId, chatId, projectPath } = useActiveIdentity();
  // Stable ref for path so the unmount effect always sees the current path.
  const pathRef = useRef(path);
  pathRef.current = path;
  // Ref to the live EditorView — populated via CmEditor's onViewReady seam.
  const viewRef = useRef<EditorView | null>(null);

  // Subscribe to the dirty flag for the save-status chip.
  // Read from store state (not subscribed via selector — we want the live value).
  const isDirty = useEditorStore((s) => s.getBuffer(path)?.dirty ?? false);

  // Callback for silent reload (disk change with clean buffer): updates loadState
  // value so React reflects the new content even without an EditorView.
  const handleSilentReload = useCallback(
    (content: string) => {
      setBuffer(path, content, false);
      setLoadState({ status: 'ready', value: content });
    },
    [path, setBuffer],
  );

  // File-watch live reload (D4): subscribe to disk changes and apply them
  // silently (clean buffer) or via the conflict banner (dirty buffer).
  const {
    diskConflict,
    reload: reloadFromDisk,
    keepMine,
  } = useFileWatchReload({
    path,
    enabled: !!projectId,
    port,
    projectId,
    chatId,
    viewRef,
    onSilentReload: handleSilentReload,
  });

  // Load file content — read the cache ONCE inside the effect (not subscribed)
  // so that keystrokes (setBuffer → new buffer object) do not re-run this
  // effect. Project files load via the daemon (worktree-aware; resolves
  // repo-relative tree paths AND absolute chat-card paths). Falls back to the
  // Tauri bridge only when there is no active project.
  useEffect(() => {
    const cached = useEditorStore.getState().getBuffer(path);
    if (cached) {
      setLoadState({ status: 'ready', value: cached.value });
      return;
    }

    let cancelled = false;
    setLoadState({ status: 'loading' });

    const load = projectId ? getProjectFile(port, projectId, path, chatId) : readFile(path);
    load
      .then((content) => {
        if (cancelled) return;
        if (content == null) {
          setLoadState({ status: 'error', message: 'File not found or unreadable' });
          return;
        }
        setBuffer(path, content, false);
        setLoadState({ status: 'ready', value: content });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[EditorTab] failed to load file', path, message);
        setLoadState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [path, setBuffer, port, projectId, chatId]);

  // On unmount: clear the buffer unless it is dirty (preserves unsaved edits
  // across an accidental tab reopen; clean tabs re-read from disk).
  useEffect(() => {
    return () => {
      const p = pathRef.current;
      const buf = useEditorStore.getState().getBuffer(p);
      if (buf && !buf.dirty) {
        useEditorStore.getState().clearBuffer(p);
      }
    };
  }, []);

  const lspLanguage = projectId ? getLspLanguage(path) : null;
  const loadedValue = loadState.status === 'ready' ? loadState.value : null;

  // LSP lifecycle: ensure-client (with startup-race fix + identity reset),
  // ensure-document-open, and CM6 extension builder.
  const { lspReady, extraExtensions } = useLspDocument({
    path,
    projectId,
    projectPath,
    chatId,
    loadedValue,
  });

  const handleChange = useCallback(
    (value: string) => {
      setBuffer(path, value, true);
      // First edit promotes preview → permanent (mirrors prototype behaviour).
      promoteTab(tabId);
    },
    [path, setBuffer, promoteTab, tabId],
  );

  const handleCursorChange = useCallback((line: number, col: number) => {
    setCursorPos({ ln: line, col });
  }, []);

  const handleSave = useCallback(
    (value: string) => {
      if (readOnly) return;
      if (!projectId) return;
      saveProjectFile(port, projectId, path, value, chatId)
        .then(() => {
          setBuffer(path, value, false);
          setSaveError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn('[EditorTab] save failed', { path, msg });
          setSaveError(msg);
        });
    },
    [port, projectId, path, chatId, setBuffer, readOnly],
  );

  if (loadState.status === 'loading') {
    return (
      <div data-testid="editor-tab" className="flex h-full items-center justify-center text-body text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (loadState.status === 'error') {
    return (
      <div data-testid="editor-tab" className="flex h-full items-center justify-center text-body text-destructive">
        {loadState.message}
      </div>
    );
  }

  const language = inferLanguage(path);

  // Save status chip for the ViewerShell header actions slot.
  const saveStatusChip = <SaveStatusChip dirty={isDirty} />;

  return (
    <div data-testid="editor-tab" className="flex h-full flex-col overflow-hidden">
      <ViewerRouter
        path={path}
        renderCode={() =>
          language === 'markdown' ? (
            <MarkdownEditorTab
              value={loadState.value}
              path={path}
              onChange={handleChange}
              onSave={handleSave}
              readOnly={readOnly}
            />
          ) : (
            <ViewerShell path={path} status={`Ln ${cursorPos.ln}, Col ${cursorPos.col}`} actions={saveStatusChip}>
              {readOnly && (
                <div
                  data-testid="editor-tab-readonly"
                  className="flex-shrink-0 bg-mf-tab-bar px-3 py-0.5 text-caption text-mf-text-3"
                >
                  Read-only
                </div>
              )}
              {saveError !== null && (
                <div
                  data-testid="editor-tab-save-error"
                  className="flex-shrink-0 bg-mf-destructive-tint px-3 py-1 text-caption text-destructive"
                >
                  Save failed: {saveError}
                </div>
              )}
              {diskConflict !== null && (
                <div
                  data-testid="editor-tab-disk-conflict"
                  className="flex flex-shrink-0 items-center gap-2 bg-mf-warning-tint px-3 py-1 text-caption text-mf-warning"
                >
                  <span className="flex-1">File changed on disk</span>
                  <button
                    data-testid="editor-tab-reload"
                    onClick={reloadFromDisk}
                    className="rounded px-2 py-0.5 hover:opacity-80"
                  >
                    Reload
                  </button>
                  <button
                    data-testid="editor-tab-keep-mine"
                    onClick={keepMine}
                    className="rounded px-2 py-0.5 hover:opacity-80"
                  >
                    Keep mine
                  </button>
                </div>
              )}
              <EditorContextMenu
                filePath={path}
                viewRef={viewRef}
                providers={projectId && lspLanguage ? lspClientManager : undefined}
                lspConfig={projectId && lspLanguage ? { projectId, language: lspLanguage, lspReady } : undefined}
              >
                <CmEditorWithComments
                  value={loadState.value}
                  language={language}
                  readOnly={readOnly}
                  onChange={handleChange}
                  onSave={handleSave}
                  onCursorChange={handleCursorChange}
                  path={path}
                  extraExtensions={extraExtensions}
                  onViewReady={(v) => {
                    viewRef.current = v;
                  }}
                />
              </EditorContextMenu>
            </ViewerShell>
          )
        }
      />
    </div>
  );
}
