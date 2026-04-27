import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Save } from 'lucide-react';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { useChatsStore } from '../../store/chats';
import { getFileContent, getExternalFileContent, saveFileContent } from '../../lib/api';
import { daemonClient } from '../../lib/client';
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
  const [savedContent, setSavedContent] = useState<string | null>(providedContent ?? null);
  const [currentContent, setCurrentContent] = useState<string | null>(providedContent ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = savedContent !== null && currentContent !== null && savedContent !== currentContent;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (providedContent !== undefined) {
      setSavedContent(providedContent);
      setCurrentContent(providedContent);
      return;
    }
    setSavedContent(null);
    setCurrentContent(null);
    setError(null);

    // Absolute paths live outside the project root — use the external file endpoint.
    if (filePath.startsWith('/')) {
      getExternalFileContent(filePath)
        .then((result) => {
          setSavedContent(result.content);
          setCurrentContent(result.content);
        })
        .catch(() => setError('Failed to load file'));
      return;
    }

    if (!activeProjectId) return;
    getFileContent(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => {
        setSavedContent(result.content);
        setCurrentContent(result.content);
      })
      .catch(() => setError('Failed to load file'));
  }, [activeProjectId, filePath, activeChatId, providedContent]);

  const handleSave = useCallback(async () => {
    if (!activeProjectId || currentContent == null) return;
    setSaving(true);
    try {
      await saveFileContent(activeProjectId, filePath, currentContent, activeChatId ?? undefined);
      setSavedContent(currentContent);
    } catch {
      console.warn('[EditorTab] save failed');
    } finally {
      setSaving(false);
    }
  }, [activeProjectId, filePath, currentContent, activeChatId]);

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

  // Re-fetch file content when any agent edits this file
  useEffect(() => {
    // External files (absolute paths) are not managed by the project agent.
    if (!activeProjectId || providedContent !== undefined || filePath.startsWith('/')) return;
    return daemonClient.onEvent((event) => {
      if (event.type !== 'context.updated' || !event.filePaths) return;
      const match = event.filePaths.some((fp) => filePath.endsWith(fp) || fp.endsWith(filePath));
      if (!match) return;
      if (dirtyRef.current) return; // don't overwrite unsaved user changes
      getFileContent(activeProjectId, filePath, activeChatId ?? undefined)
        .then((result) => {
          setSavedContent(result.content);
          setCurrentContent(result.content);
        })
        .catch(() => {
          /* file may have been deleted; keep current content */
        });
    });
  }, [activeChatId, activeProjectId, filePath, providedContent]);

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
