import React, { useCallback, useEffect, useState } from 'react';
import { useProjectsStore } from '../../store';
import { useChatsStore } from '../../store/chats';
import { getFileContent } from '../../lib/api';
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

export function EditorTab({ filePath }: { filePath: string }): React.ReactElement {
  const { activeProjectId } = useProjectsStore();
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeProjectId) return;
    setContent(null);
    setError(null);
    getFileContent(activeProjectId, filePath, activeChatId ?? undefined)
      .then((result) => setContent(result.content))
      .catch(() => setError('Failed to load file'));
  }, [activeProjectId, filePath, activeChatId]);

  const handleLineComment = useCallback(
    (line: number, lineContent: string, comment: string) => {
      const shortPath = filePath.split('/').slice(-3).join('/');
      const trimmedLine = lineContent.trim();
      const formatted = `In \`${shortPath}\` at line ${line}:\n> ${trimmedLine}\n\n${comment}`;
      sendCommentMessage(formatted);
    },
    [filePath],
  );

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (content === null) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading...</div>
    );
  }

  return (
    <MonacoEditor
      value={content}
      language={inferLanguage(filePath)}
      filePath={filePath}
      readOnly
      onLineComment={handleLineComment}
    />
  );
}
