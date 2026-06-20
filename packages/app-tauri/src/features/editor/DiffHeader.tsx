/**
 * DiffHeader — a 28px header bar for the diff view.
 *
 * Shows a git-branch icon + truncated file path on the left, separate +N / −N
 * add/del counts in the middle/right, and prev/next navigation buttons (chevron
 * icons) + a Reveal button on the right.
 *
 * data-testids:
 *   diff-prev-change  — navigate to the previous diff chunk
 *   diff-next-change  — navigate to the next diff chunk
 *   diff-reveal       — reveal file in tree
 */
import { ChevronDown, ChevronUp, Crosshair, GitBranch } from 'lucide-react';
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

export function DiffHeader({
  fileName,
  changeCount,
  additions,
  deletions,
  filePath,
  onPrev,
  onNext,
}: DiffHeaderProps) {
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
      className="flex h-[28px] shrink-0 items-center gap-2 border-b border-border bg-mf-content2 px-3"
    >
      {/* Leading git branch icon */}
      <GitBranch size={11} className="shrink-0 text-mf-text-3" aria-hidden />

      {/* Truncated file path */}
      <span className="min-w-0 flex-1 truncate font-mono text-micro text-mf-text-4">{fileName}</span>

      {/* Separate +N / −N counts */}
      {additions !== undefined && (
        <span className="font-semibold text-mf-success tabular-nums text-caption">+{additions}</span>
      )}
      {deletions !== undefined && (
        <span className="font-semibold text-destructive tabular-nums text-caption">−{deletions}</span>
      )}
      {additions === undefined && deletions === undefined && (
        <span className="text-caption text-mf-text-3 tabular-nums">{changeCount} changes</span>
      )}

      {/* Prev / Next buttons using chevron icons */}
      <button
        type="button"
        data-testid="diff-prev-change"
        disabled={disabled}
        onClick={onPrev}
        aria-label="Previous change"
        className="flex h-5 w-5 items-center justify-center rounded text-mf-text-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronUp size={13} aria-hidden />
      </button>
      <button
        type="button"
        data-testid="diff-next-change"
        disabled={disabled}
        onClick={onNext}
        aria-label="Next change"
        className="flex h-5 w-5 items-center justify-center rounded text-mf-text-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronDown size={13} aria-hidden />
      </button>

      {/* Reveal button */}
      {filePath && (
        <button
          type="button"
          data-testid="diff-reveal"
          onClick={handleReveal}
          aria-label="Reveal in file tree"
          className="inline-flex h-[20px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent text-muted-foreground transition-colors hover:bg-accent"
        >
          <Crosshair size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}
