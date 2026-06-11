/**
 * SkillEditorTab — edits a skill file (typically Markdown) in the Files surface.
 *
 * Skills are `.md` files under `~/.claude/skills/` (or similar; the path comes
 * from the tab model). They are edited with the plain CmEditor using the
 * 'markdown' language pack.
 *
 * Load path mirrors EditorTab: project files via the daemon (worktree-aware),
 * fallback to the Tauri bridge for absolute paths without a project context.
 *
 * Null/undefined content is treated as a load error — it is NOT cached as an
 * empty buffer (which would mask real content after a fix).
 *
 * The cache is read once inside the effect via getState() to avoid re-running
 * on every keystroke (setBuffer → new buffer object).
 *
 * data-testid: "skill-editor-tab" on root.
 */
import { useCallback, useEffect, useState } from 'react';
import { readFile } from '@/lib/tauri/bridge';
import { getProjectFile } from '@/lib/api/files';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
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
  const promoteTab = useTabsStore((s) => s.promoteTab);
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();

  // Read the cache once inside the effect (not subscribed) so keystrokes don't
  // re-trigger loads. Project files load via the daemon; fallback to Tauri for
  // absolute paths with no project context.
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
        console.warn('[SkillEditorTab] failed to load skill file', path, message);
        setLoadState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
    };
  }, [path, setBuffer, port, projectId, chatId]);

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
        className="flex h-full items-center justify-center text-body text-muted-foreground"
      >
        Loading skill…
      </div>
    );
  }

  if (loadState.status === 'error') {
    return (
      <div
        data-testid="skill-editor-tab"
        className="flex h-full items-center justify-center text-body text-destructive"
      >
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
