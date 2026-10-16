/**
 * ReviewDiffView — CmDiffEditor wrapper + inline-comment authoring.
 *
 * Fetches the diff for a single file — from git via getWorkingDiff (against
 * `base` when the scope compares to one, HEAD otherwise), or from the session's
 * own edits via getSessionDiff — renders it in the side-by-side CmDiffEditor,
 * and provides a minimal comment form.
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
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useEffect, useState, useCallback } from 'react';
import { CmDiffEditor, type LineSelection } from '@/features/editor/CmDiffEditor';
import { getWorkingDiff } from '@/lib/api/git';
import { getSessionDiff } from '@/lib/api/files';
import { inferLanguage } from '@/lib/editor/file-types';
import { formatLineComment } from '@/lib/format-line-comment';

/**
 * Where a file's two sides come from. `git`: the file at `base` (HEAD when
 * absent; read from `oldPath` for a rename) against the working tree.
 * `session`: the file before and after the session's edits.
 */
export type DiffSource = { kind: 'git'; base?: string; oldPath?: string } | { kind: 'session' };

interface LoadedDiff {
  original: string;
  modified: string;
  /** The session's edits could not be replayed; git's view stands in. */
  fellBackToGit: boolean;
}

interface ReviewDiffViewProps {
  port: number;
  projectId: string;
  chatId?: string;
  file: string;
  source: DiffSource;
  onAppend: (text: string) => void;
}

export function ReviewDiffView({ port, projectId, chatId, file, source, onAppend }: ReviewDiffViewProps) {
  const [diff, setDiff] = useState<LoadedDiff | null>(null);
  // Primitive effect deps: a fresh `source` object each render must not refetch.
  const sourceKind = source.kind;
  const base = source.kind === 'git' ? source.base : undefined;
  const oldPath = source.kind === 'git' ? source.oldPath : undefined;
  const [error, setError] = useState<string | null>(null);

  // Comment form state
  const [selectedLine, setSelectedLine] = useState<LineSelection | null>(null);
  const [comment, setComment] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDiff(null);
    setError(null);
    setSelectedLine(null);
    const request: Promise<LoadedDiff> =
      sourceKind === 'session'
        ? getSessionDiff(port, chatId ?? '', file).then((d) => ({ ...d, fellBackToGit: d.source === 'git' }))
        : getWorkingDiff(port, projectId, file, { chatId, base, oldPath }).then((d) => ({
            ...d,
            fellBackToGit: false,
          }));
    request
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
  }, [port, projectId, file, chatId, sourceKind, base, oldPath]);

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
      {error && <div className="px-4 py-3 text-xs text-destructive">{error}</div>}

      {diff?.fellBackToGit && (
        <div data-testid="review-session-diff-fallback" className="px-4 py-2 text-xs text-muted-foreground">
          Later changes to this file stop the session&apos;s edits from replaying, so this compares it with the last
          commit before the session started.
        </div>
      )}

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

      {!error && !diff && <div className="px-4 py-4 text-xs text-muted-foreground">Loading diff…</div>}

      {/* Inline comment authoring */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t px-4 py-3 flex flex-col gap-2">
        {selectedLine ? (
          <div
            data-testid="review-comment-selected-line"
            className="flex items-baseline gap-1.5 text-xs text-muted-foreground"
          >
            <span className="font-medium text-foreground">Line {selectedLine.line}</span>
            {snippetText && <span className="font-mono truncate text-muted-foreground">— {snippetText}</span>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Click a line in the diff to anchor your comment.</p>
        )}
        <Textarea
          data-testid="review-comment-input"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a comment…"
          rows={3}
          className="resize-none"
        />
        <div className="flex justify-end">
          <Button size="sm" type="submit" data-testid="review-comment-submit" disabled={!canSubmit}>
            Comment
          </Button>
        </div>
      </form>
    </div>
  );
}
