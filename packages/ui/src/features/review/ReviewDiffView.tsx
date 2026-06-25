/**
 * ReviewDiffView — CmDiffEditor wrapper + inline-comment authoring.
 *
 * Fetches the working diff for a single file via getWorkingDiff, renders it
 * in the side-by-side CmDiffEditor, and provides a minimal comment form.
 * Submitting the form calls `onAppend` with a string that satisfies the
 * parse-review-comment parser format:
 *
 *   Diff of `<file>`
 *
 *   At line <N>:
 *   ```
 *   <line content>
 *   ```
 *   <comment body>
 *
 * The selected line + its text come from clicking in the CmDiffEditor modified
 * pane via the `onLineSelect` prop — not from a manual number spinner. Submit
 * is disabled until a line is selected AND a comment is typed.
 *
 * The `onAppend` prop is wired by ReviewPanel to the runtime's append call.
 */
import { useEffect, useState, useCallback } from 'react';
import { CmDiffEditor, type LineSelection } from '@/features/editor/CmDiffEditor';
import { getWorkingDiff, type WorkingDiff } from '@/lib/api/git';
import { inferLanguage } from '@/lib/editor/file-types';
import { formatLineComment } from '@/lib/format-line-comment';

interface ReviewDiffViewProps {
  port: number;
  projectId: string;
  chatId?: string;
  file: string;
  onAppend: (text: string) => void;
}

export function ReviewDiffView({ port, projectId, chatId, file, onAppend }: ReviewDiffViewProps) {
  const [diff, setDiff] = useState<WorkingDiff | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Comment form state
  const [selectedLine, setSelectedLine] = useState<LineSelection | null>(null);
  const [comment, setComment] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setError(null);
    setSelectedLine(null);
    getWorkingDiff(port, projectId, file, { chatId })
      .then((d) => {
        if (!cancelled) setDiff(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.warn('[ReviewDiffView] Failed to load diff', file, err);
          setError('Failed to load diff. Please try again.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId, file, chatId]);

  const handleLineSelect = useCallback((sel: LineSelection) => {
    setSelectedLine(sel);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLine || !comment.trim()) return;
    const body = `Diff of \`${file}\`\n\n${formatLineComment({
      startLine: selectedLine.line,
      endLine: selectedLine.line,
      lineContent: selectedLine.text,
      comment: comment.trim(),
    })}`;
    onAppend(body);
    setComment('');
    setSelectedLine(null);
  }

  const language = inferLanguage(file);
  const canSubmit = selectedLine !== null && comment.trim().length > 0;

  // Truncate long lines in the snippet so the UI stays compact.
  const snippetText = selectedLine
    ? selectedLine.text.length > 60
      ? `${selectedLine.text.slice(0, 60)}…`
      : selectedLine.text
    : null;

  return (
    <div className="flex flex-col h-full">
      {error && <div className="px-4 py-3 text-caption text-destructive">{error}</div>}

      {diff && (
        <div className="flex-1 min-h-0">
          <CmDiffEditor
            original={diff.original}
            modified={diff.modified}
            language={language}
            path={file}
            readOnly
            onLineSelect={handleLineSelect}
          />
        </div>
      )}

      {!error && !diff && <div className="px-4 py-4 text-caption text-muted-foreground">Loading diff…</div>}

      {/* Inline comment authoring */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-border px-4 py-3 flex flex-col gap-2">
        {selectedLine ? (
          <div
            data-testid="review-comment-selected-line"
            className="flex items-baseline gap-1.5 text-caption text-muted-foreground"
          >
            <span className="font-medium text-foreground">Line {selectedLine.line}</span>
            {snippetText && <span className="font-mono truncate text-muted-foreground">— {snippetText}</span>}
          </div>
        ) : (
          <p className="text-caption text-muted-foreground">Click a line in the diff to anchor your comment.</p>
        )}
        <textarea
          data-testid="review-comment-input"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment…"
          rows={3}
          className="w-full rounded border border-border bg-transparent px-2 py-1 text-body resize-none outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            data-testid="review-comment-submit"
            disabled={!canSubmit}
            className="rounded-md px-3 py-1.5 text-body bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Comment
          </button>
        </div>
      </form>
    </div>
  );
}
