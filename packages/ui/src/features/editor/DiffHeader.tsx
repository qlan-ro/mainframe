/**
 * DiffHeader — a 28px header bar for the diff view.
 *
 * Shows a git-branch icon + truncated file path on the left, separate +N / −N
 * add/del counts in the middle/right, and prev/next navigation buttons (chevron
 * icons) + a Reveal button on the right.
 *
 * The add/del counts keep the bridge-owned `mf-diff-*` palette on purpose: they
 * are the same greens/reds CmDiffEditor paints the gutter with.
 *
 * data-testids:
 *   diff-prev-change  — navigate to the previous diff chunk
 *   diff-next-change  — navigate to the next diff chunk
 *   diff-reveal       — reveal file in tree
 */
import { ChevronDown, ChevronUp, Crosshair, GitBranch } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { emitSurfaceIntent } from '@/store/surface-intents';

interface DiffHeaderProps {
  /** Basename or full path of the file being diffed. */
  fileName: string;
  /** Total number of diff chunks in the active MergeView. */
  changeCount: number;
  /** Number of added lines (for the +N count). */
  additions?: number;
  /** Number of deleted lines (for the −N count). */
  deletions?: number;
  /** Full file path used for the Reveal intent. */
  filePath?: string;
  /** Navigate to the previous change chunk. */
  onPrev: () => void;
  /** Navigate to the next change chunk. */
  onNext: () => void;
}

export function DiffHeader({ fileName, changeCount, additions, deletions, filePath, onPrev, onNext }: DiffHeaderProps) {
  const disabled = changeCount === 0;

  function handleReveal() {
    if (filePath) {
      emitSurfaceIntent({ type: 'reveal-file', path: filePath });
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Diff navigation"
      className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-card px-3"
    >
      <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />

      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{fileName}</span>

      {additions !== undefined && (
        <span className="text-xs font-semibold text-mf-diff-add-text tabular-nums">+{additions}</span>
      )}
      {deletions !== undefined && (
        <span className="text-xs font-semibold text-mf-diff-del-text tabular-nums">−{deletions}</span>
      )}
      {additions === undefined && deletions === undefined && (
        <span className="text-xs text-muted-foreground tabular-nums">{changeCount} changes</span>
      )}

      <Button
        data-testid="diff-prev-change"
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        onClick={onPrev}
        aria-label="Previous change"
      >
        <ChevronUp aria-hidden />
      </Button>
      <Button
        data-testid="diff-next-change"
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        onClick={onNext}
        aria-label="Next change"
      >
        <ChevronDown aria-hidden />
      </Button>

      {filePath && (
        <Button
          data-testid="diff-reveal"
          variant="ghost"
          size="icon-xs"
          onClick={handleReveal}
          aria-label="Reveal in file tree"
        >
          <Crosshair aria-hidden />
        </Button>
      )}
    </div>
  );
}
