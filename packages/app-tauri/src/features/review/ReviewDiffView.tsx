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
 * The `onAppend` prop is wired by ReviewPanel to the runtime's append call.
 */
import { useEffect, useState } from 'react';
import { CmDiffEditor } from '@/features/editor/CmDiffEditor';
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
  const [startLine, setStartLine] = useState(1);
  const [comment, setComment] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setError(null);
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    // Line content is empty here (we have the diff but no per-line indexing yet).
    // The parse-review-comment parser accepts an empty fence (no fenced block) by
    // design — it still satisfies PART_RE.
    const body = `Diff of \`${file}\`\n\n${formatLineComment({
      startLine,
      endLine: startLine,
      lineContent: '',
      comment: comment.trim(),
    })}`;
    onAppend(body);
    setComment('');
  }

  const language = inferLanguage(file);

  return (
    <div className="flex flex-col h-full">
      {error && <div className="px-4 py-3 text-caption text-destructive">{error}</div>}

      {diff && (
        <div className="flex-1 min-h-0">
          <CmDiffEditor original={diff.original} modified={diff.modified} language={language} path={file} readOnly />
        </div>
      )}

      {!error && !diff && <div className="px-4 py-4 text-caption text-muted-foreground">Loading diff…</div>}

      {/* Inline comment authoring */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-border px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <label className="text-caption text-muted-foreground shrink-0">Line</label>
          <input
            type="number"
            min={1}
            data-testid="review-comment-line"
            value={startLine}
            onChange={(e) => setStartLine(Number(e.target.value) || 1)}
            className="w-20 rounded border border-border bg-transparent px-2 py-1 text-caption outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
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
            disabled={!comment.trim()}
            className="rounded-md px-3 py-1.5 text-body bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Comment
          </button>
        </div>
      </form>
    </div>
  );
}
