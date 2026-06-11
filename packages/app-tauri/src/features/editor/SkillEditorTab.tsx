/**
 * SkillEditorTab — edits a skill file (typically Markdown) in the Files surface.
 *
 * Skills are `.md` files under `~/.claude/skills/` (or similar; the path comes
 * from the tab model). They are edited with the plain CmEditor using the
 * 'markdown' language pack.
 *
 * If a dedicated skill-loading API lands later, this wrapper is the right place
 * to hook it in. For now it reads the file via the Tauri bridge like EditorTab.
 *
 * data-testid: "skill-editor-tab" on root.
 */
import { useCallback, useEffect, useState } from 'react';
import { readFile } from '@/lib/tauri/bridge';
import { useEditorStore } from '@/store/editor';
import { useTabsStore } from '@/store/tabs';
import { CmEditor } from './CmEditor';

interface SkillEditorTabProps {
  tabId: string;
  path: string;
}

type LoadState = { status: 'loading' } | { status: 'ready'; value: string } | { status: 'error'; message: string };

export function SkillEditorTab({ tabId, path }: SkillEditorTabProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const setBuffer = useEditorStore((s) => s.setBuffer);
  const cachedBuffer = useEditorStore((s) => s.getBuffer(path));
  const promoteTab = useTabsStore((s) => s.promoteTab);

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
        console.warn('[SkillEditorTab] failed to load skill file', path, message);
        setLoadState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [path, cachedBuffer, setBuffer]);

  const handleChange = useCallback(
    (value: string) => {
      setBuffer(path, value, true);
      promoteTab(tabId);
    },
    [path, setBuffer, promoteTab, tabId],
  );

  if (loadState.status === 'loading') {
    return (
      <div
        data-testid="skill-editor-tab"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        Loading skill…
      </div>
    );
  }

  if (loadState.status === 'error') {
    return (
      <div data-testid="skill-editor-tab" className="flex h-full items-center justify-center text-sm text-destructive">
        {loadState.message}
      </div>
    );
  }

  return (
    <div data-testid="skill-editor-tab" className="flex h-full flex-col overflow-hidden">
      <CmEditor value={loadState.value} language="markdown" readOnly={false} onChange={handleChange} path={path} />
    </div>
  );
}
