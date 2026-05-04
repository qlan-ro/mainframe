import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Save, RefreshCw, X } from 'lucide-react';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { useProjectsStore } from '../../store/projects';
import { getFileContent, getExternalFileContent, saveFileContent } from '../../lib/api';
import { daemonClient } from '../../lib/client';
import { resolveFileLocation } from '../../lib/file-location';
import { sendCommentMessage } from '../../lib/send-comment-message';
import { MonacoEditor } from '../editor/MonacoEditor';

function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    py: 'python',
    rs: 'rust',
    go: 'go',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    sh: 'shell',
    bash: 'shell',
    sql: 'sql',
    scala: 'scala',
    sc: 'scala',
    java: 'java',
  };
  return map[ext || ''] || 'plaintext';
}

export function EditorTab({
  filePath,
  content: providedContent,
  line,
  column,
  viewState,
  cursorLine,
  cursorColumn,
}: {
  filePath: string;
  content?: string;
  line?: number;
  column?: number;
  viewState?: unknown;
  cursorLine?: number;
  cursorColumn?: number;
}): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const activeChat = useChatsStore((s) => s.chats.find((c) => c.id === s.activeChatId));
  const project = useProjectsStore((s) => s.projects.find((p) => p.id === activeProjectId));
  const [savedContent, setSavedContent] = useState<string | null>(providedContent ?? null);
  const [currentContent, setCurrentContent] = useState<string | null>(providedContent ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [diskChanged, setDiskChanged] = useState(false);
  const dirty = savedContent !== null && currentContent !== null && savedContent !== currentContent;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const location = useMemo(() => {
    if (providedContent !== undefined) return null; // inline content, not a real file
    return resolveFileLocation(filePath, { activeChat, project, fallbackChatId: activeChatId });
  }, [filePath, providedContent, activeChat, project, activeChatId]);

  const fetchContent = useCallback((): Promise<string> => {
    if (!location) return Promise.reject(new Error('no location'));
    if (location.isExternal || location.relativePath === null) {
      return getExternalFileContent(location.absolutePath).then((r) => r.content);
    }
    if (!activeProjectId) return Promise.reject(new Error('no active project'));
    return getFileContent(activeProjectId, location.relativePath, location.chatIdForApi).then((r) => r.content);
  }, [location, activeProjectId]);

  useEffect(() => {
    if (providedContent !== undefined) {
      setSavedContent(providedContent);
      setCurrentContent(providedContent);
      return;
    }
    setSavedContent(null);
    setCurrentContent(null);
    setError(null);
    setDiskChanged(false);

    if (!location) return;

    fetchContent()
      .then((content) => {
        setSavedContent(content);
        setCurrentContent(content);
      })
      .catch(() => setError('Failed to load file'));
  }, [location, providedContent, fetchContent]);

  const handleSave = useCallback(async () => {
    if (
      !activeProjectId ||
      currentContent == null ||
      !location ||
      location.isExternal ||
      location.relativePath === null
    ) {
      return;
    }
    setSaving(true);
    try {
      await saveFileContent(activeProjectId, location.relativePath, currentContent, location.chatIdForApi);
      setSavedContent(currentContent);
    } catch {
      console.warn('[EditorTab] save failed');
    } finally {
      setSaving(false);
    }
  }, [activeProjectId, location, currentContent]);

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirtyRef.current) handleSaveRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Re-fetch file content when any agent edits this file via context.updated.
  // Match by absolute path — daemon emits absolute filePaths, and we resolve
  // both worktree-absolute and project-relative inputs to the same absolute.
  useEffect(() => {
    if (!location) return;
    return daemonClient.onEvent((event) => {
      if (event.type !== 'context.updated' || !event.filePaths) return;
      if (!event.filePaths.includes(location.absolutePath)) return;
      if (dirtyRef.current) return; // don't overwrite unsaved user changes
      fetchContent()
        .then((content) => {
          setSavedContent(content);
          setCurrentContent(content);
        })
        .catch(() => {
          /* file may have been deleted; keep current content */
        });
    });
  }, [location, fetchContent]);

  // Subscribe to file:changed events for disk-level change detection.
  useEffect(() => {
    if (!location) return;
    const watchPath = location.absolutePath;

    daemonClient.subscribeFile(watchPath);
    const unsub = daemonClient.onEvent((event) => {
      if (event.type !== 'file:changed' || event.path !== watchPath) return;
      if (dirtyRef.current) {
        // User has unsaved changes — surface a banner instead of silently overwriting.
        setDiskChanged(true);
        return;
      }
      // No unsaved changes — reload silently, preserving cursor/scroll via viewState.
      fetchContent()
        .then((content) => {
          setSavedContent(content);
          setCurrentContent(content);
        })
        .catch(() => {
          setError('File deleted or moved');
        });
    });

    return () => {
      unsub();
      daemonClient.unsubscribeFile(watchPath);
    };
  }, [location, fetchContent]);

  const handleReloadFromDisk = useCallback(() => {
    setDiskChanged(false);
    if (!location) return;
    fetchContent()
      .then((content) => {
        setSavedContent(content);
        setCurrentContent(content);
      })
      .catch(() => setError('File deleted or moved'));
  }, [location, fetchContent]);

  const handleKeepMine = useCallback(() => {
    setDiskChanged(false);
  }, []);

  const handleChange = useCallback((value: string | undefined) => {
    if (value !== undefined) setCurrentContent(value);
  }, []);

  const formatComment = useCallback(
    (item: { startLine: number; endLine: number; lineContent: string; comment: string }) => {
      const lineRef =
        item.startLine === item.endLine ? `line ${item.startLine}` : `lines ${item.startLine}-${item.endLine}`;
      const trimmed = item.lineContent.trim();
      const quote = trimmed ? `\n\`\`\`\n${trimmed}\n\`\`\`` : '';
      return `At ${lineRef}:${quote}\n${item.comment}`;
    },
    [],
  );

  const handleLineComment = useCallback(
    (startLine: number, endLine: number, lineContent: string, comment: string) => {
      const body = formatComment({ startLine, endLine, lineContent, comment });
      sendCommentMessage(`File: \`${filePath}\`\n\n${body}`);
    },
    [filePath, formatComment],
  );

  const handleSubmitReview = useCallback(
    (items: { startLine: number; endLine: number; lineContent: string; comment: string }[]) => {
      const parts = items.map(formatComment);
      sendCommentMessage(`File: \`${filePath}\`\n\n${parts.join('\n\n---\n\n')}`);
    },
    [filePath, formatComment],
  );

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (currentContent === null) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading...</div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {diskChanged && (
        <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 bg-yellow-500/10 border-b border-yellow-500/20 text-mf-small">
          <span className="text-yellow-400 flex-1">File changed on disk</span>
          <button
            onClick={handleReloadFromDisk}
            className="flex items-center gap-1 px-2 py-0.5 text-mf-small rounded bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 transition-colors"
          >
            <RefreshCw size={11} />
            Reload
          </button>
          <button
            onClick={handleKeepMine}
            className="flex items-center gap-1 px-2 py-0.5 text-mf-small rounded hover:bg-mf-hover text-mf-text-secondary transition-colors"
          >
            <X size={11} />
            Keep mine
          </button>
        </div>
      )}
      {dirty && (
        <div className="flex items-center justify-end px-3 py-1 shrink-0">
          <button
            className="flex items-center gap-1 px-2 py-1 text-mf-small rounded hover:bg-mf-input text-mf-text-secondary hover:text-mf-text-primary disabled:opacity-40"
            disabled={saving}
            onClick={handleSave}
          >
            <Save size={13} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <MonacoEditor
          value={currentContent}
          language={inferLanguage(filePath)}
          filePath={filePath}
          line={line}
          column={column}
          viewState={viewState}
          cursorLine={cursorLine}
          cursorColumn={cursorColumn}
          readOnly={false}
          onChange={handleChange}
          onLineComment={handleLineComment}
          onSubmitReview={handleSubmitReview}
        />
      </div>
    </div>
  );
}
