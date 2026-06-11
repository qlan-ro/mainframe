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
import { useCallback, useEffect, useRef, useState } from 'react';
import { readFile } from '@/lib/tauri/bridge';
import { getProjectFile, saveProjectFile } from '@/lib/api/files';
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const setBuffer = useEditorStore((s) => s.setBuffer);
  const promoteTab = useTabsStore((s) => s.promoteTab);
  const port = useDaemonPort();
  const { projectId, chatId } = useActiveIdentity();
  // Stable ref so the unmount cleanup always has the current path.
  const pathRef = useRef(path);
  pathRef.current = path;

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

  // On unmount: clear clean buffers so disk changes win on reopen.
  useEffect(() => {
    return () => {
      const p = pathRef.current;
      const buf = useEditorStore.getState().getBuffer(p);
      if (buf && !buf.dirty) {
        useEditorStore.getState().clearBuffer(p);
      }
    };
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setBuffer(path, value, true);
      promoteTab(tabId);
    },
    [path, setBuffer, promoteTab, tabId],
  );

  const handleSave = useCallback(
    (value: string) => {
      if (!projectId) return;
      saveProjectFile(port, projectId, path, value, chatId)
        .then(() => {
          setBuffer(path, value, false);
          setSaveError(null);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn('[SkillEditorTab] save failed', { path, msg });
          setSaveError(msg);
        });
    },
    [port, projectId, path, chatId, setBuffer],
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
      {saveError !== null && (
        <div
          data-testid="skill-editor-tab-save-error"
          className="flex-shrink-0 bg-destructive/10 px-3 py-1 text-caption text-destructive"
        >
          Save failed: {saveError}
        </div>
      )}
      <CmEditor
        value={loadState.value}
        language="markdown"
        readOnly={false}
        onChange={handleChange}
        onSave={handleSave}
        path={path}
      />
    </div>
  );
}
