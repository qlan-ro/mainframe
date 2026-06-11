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
import { useCallback, useEffect, useState } from 'react';
import { readFile } from '@/lib/tauri/bridge';
import { inferLanguage } from '@/lib/editor/file-types';
import { useEditorStore } from '@/store/editor';
import { useTabsStore } from '@/store/tabs';
import { ViewerRouter } from '@/features/viewers/viewer-router';
import { CmEditor } from './CmEditor';
import { MarkdownEditorTab } from './MarkdownEditorTab';

interface EditorTabProps {
  tabId: string;
  path: string;
}

type LoadState = { status: 'loading' } | { status: 'ready'; value: string } | { status: 'error'; message: string };

export function EditorTab({ tabId, path }: EditorTabProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const setBuffer = useEditorStore((s) => s.setBuffer);
  const cachedBuffer = useEditorStore((s) => s.getBuffer(path));
  const promoteTab = useTabsStore((s) => s.promoteTab);

  // Load file content — use the in-memory buffer if already cached.
  useEffect(() => {
    if (cachedBuffer) {
      setLoadState({ status: 'ready', value: cachedBuffer.value });
      return;
    }

    let cancelled = false;
    setLoadState({ status: 'loading' });

    readFile(path)
      .then((content) => {
        if (cancelled) return;
        const value = content ?? '';
        setBuffer(path, value, false);
        setLoadState({ status: 'ready', value });
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
  }, [path, cachedBuffer, setBuffer]);

  const handleChange = useCallback(
    (value: string) => {
      setBuffer(path, value, true);
      // First edit promotes preview → permanent (mirrors prototype behaviour).
      promoteTab(tabId);
    },
    [path, setBuffer, promoteTab, tabId],
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

  return (
    <div data-testid="editor-tab" className="flex h-full flex-col overflow-hidden">
      <ViewerRouter
        path={path}
        renderCode={() =>
          language === 'markdown' ? (
            <MarkdownEditorTab value={loadState.value} path={path} onChange={handleChange} />
          ) : (
            <CmEditor
              value={loadState.value}
              language={language}
              readOnly={false}
              onChange={handleChange}
              path={path}
            />
          )
        }
      />
    </div>
  );
}
