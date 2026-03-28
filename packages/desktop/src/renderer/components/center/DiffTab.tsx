import React, { useCallback, useEffect, useState } from 'react';
import { useActiveProjectId } from '../../hooks/useActiveProjectId.js';
import { getDiff } from '../../lib/api';
import { sendCommentMessage } from '../../lib/send-comment-message';
import { MonacoDiffEditor } from '../editor/MonacoDiffEditor';

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
  };
  return map[ext || ''] || 'plaintext';
}

interface DiffTabProps {
  filePath: string;
  source: 'git' | 'inline';
  chatId?: string;
  oldPath?: string;
  original?: string;
  modified?: string;
  startLine?: number;
  base?: string;
}

export function DiffTab({
  filePath,
  source,
  chatId,
  oldPath,
  original: inlineOriginal,
  modified: inlineModified,
  startLine,
  base,
}: DiffTabProps): React.ReactElement {
  const activeProjectId = useActiveProjectId();
  const [original, setOriginal] = useState<string | null>(inlineOriginal ?? null);
  const [modified, setModified] = useState<string | null>(inlineModified ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (source === 'inline') return;
    if (!activeProjectId) return;
    setOriginal(null);
    setModified(null);
    setError(null);

    getDiff(activeProjectId, filePath, source, chatId, oldPath, base)
      .then((result) => {
        setOriginal(result.original);
        setModified(result.modified);
      })
      .catch(() => setError('Failed to load diff'));
  }, [activeProjectId, filePath, source, chatId, oldPath, base]);

  useEffect(() => {
    if (source === 'inline') {
      setOriginal(inlineOriginal ?? null);
      setModified(inlineModified ?? null);
    }
  }, [source, inlineOriginal, inlineModified]);

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
      sendCommentMessage(`Diff of \`${filePath}\`\n\n${body}`, chatId);
    },
    [filePath, chatId, formatComment],
  );

  const handleSubmitReview = useCallback(
    (items: { startLine: number; endLine: number; lineContent: string; comment: string }[]) => {
      const parts = items.map(formatComment);
      sendCommentMessage(`Diff of \`${filePath}\`\n\n${parts.join('\n\n---\n\n')}`, chatId);
    },
    [filePath, chatId, formatComment],
  );

  if (error) {
    return <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">{error}</div>;
  }

  if (original === null || modified === null) {
    return (
      <div className="h-full flex items-center justify-center text-mf-text-secondary text-mf-body">Loading diff...</div>
    );
  }

  return (
    <MonacoDiffEditor
      key={source === 'inline' ? `${original?.length}:${modified?.length}` : filePath}
      original={original}
      modified={modified}
      language={inferLanguage(filePath)}
      startLine={startLine}
      onLineComment={handleLineComment}
      onSubmitReview={handleSubmitReview}
    />
  );
}
