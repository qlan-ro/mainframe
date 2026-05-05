import React, { useCallback } from 'react';
import { MonacoDiffEditor } from '../editor/MonacoDiffEditor';
import { Button } from '../ui/button';
import { sendCommentMessage } from '../../lib/send-comment-message';

interface DiffViewProps {
  oldCode: string;
  newCode: string;
  filename: string;
  chatId?: string;
  mode?: 'inline' | 'split';
  onModeChange?: (mode: 'inline' | 'split') => void;
}

function inferLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
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

function formatComment(item: { startLine: number; endLine: number; lineContent: string; comment: string }): string {
  const lineRef =
    item.startLine === item.endLine ? `line ${item.startLine}` : `lines ${item.startLine}-${item.endLine}`;
  const trimmed = item.lineContent.trim();
  const quote = trimmed ? `\n\`\`\`\n${trimmed}\n\`\`\`` : '';
  return `At ${lineRef}:${quote}\n${item.comment}`;
}

export const DiffView: React.FC<DiffViewProps> = ({
  oldCode,
  newCode,
  filename,
  chatId,
  mode = 'inline',
  onModeChange,
}) => {
  const handleLineComment = useCallback(
    (startLine: number, endLine: number, lineContent: string, comment: string) => {
      const body = formatComment({ startLine, endLine, lineContent, comment });
      sendCommentMessage(`Diff of \`${filename}\`\n\n${body}`, chatId);
    },
    [filename, chatId],
  );

  const handleSubmitReview = useCallback(
    (items: { startLine: number; endLine: number; lineContent: string; comment: string }[]) => {
      const parts = items.map(formatComment);
      sendCommentMessage(`Diff of \`${filename}\`\n\n${parts.join('\n\n---\n\n')}`, chatId);
    },
    [filename, chatId],
  );

  return (
    <div className="flex h-full flex-col bg-mf-panel-bg">
      <div className="flex items-center justify-between border-b border-mf-border px-4 py-3 shrink-0">
        <span className="text-sm font-medium text-mf-text-secondary">{filename}</span>
        <div className="flex gap-2">
          <Button
            variant={mode === 'inline' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onModeChange?.('inline')}
            aria-label="Switch to inline diff view"
          >
            ≣ Inline
          </Button>
          <Button
            variant={mode === 'split' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onModeChange?.('split')}
            aria-label="Switch to side-by-side diff view"
          >
            ⇄ Split
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <MonacoDiffEditor
          key={`${filename}:${mode}`}
          original={oldCode}
          modified={newCode}
          language={inferLanguage(filename)}
          filePath={filename}
          renderSideBySide={mode === 'split'}
          onLineComment={handleLineComment}
          onSubmitReview={handleSubmitReview}
        />
      </div>
    </div>
  );
};
