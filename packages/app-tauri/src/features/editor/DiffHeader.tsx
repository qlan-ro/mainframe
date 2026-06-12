/**
 * DiffHeader — a 34px header bar for the diff view.
 *
 * Shows the file name on the left, change count in the middle/right, and
 * prev/next navigation buttons on the right.
 *
 * data-testids:
 *   diff-prev-change — navigate to the previous diff chunk
 *   diff-next-change — navigate to the next diff chunk
 */

interface DiffHeaderProps {
  /** Basename of the file being diffed (e.g. "index.ts"). */
  fileName: string;
  /** Total number of diff chunks in the active MergeView. */
  changeCount: number;
  /** Navigate to the previous change chunk. */
  onPrev: () => void;
  /** Navigate to the next change chunk. */
  onNext: () => void;
}

export function DiffHeader({ fileName, changeCount, onPrev, onNext }: DiffHeaderProps) {
  const disabled = changeCount === 0;

  return (
    <div
      role="toolbar"
      aria-label="Diff navigation"
      className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border px-3 bg-mf-tab-bar"
    >
      {/* Filename */}
      <span className="flex-1 truncate text-caption text-mf-text-3">{fileName}</span>

      {/* Change count */}
      <span className="text-caption text-mf-text-3 tabular-nums">{changeCount} changes</span>

      {/* Prev / Next buttons */}
      <button
        type="button"
        data-testid="diff-prev-change"
        disabled={disabled}
        onClick={onPrev}
        aria-label="Previous change"
        className="flex h-6 w-6 items-center justify-center rounded text-caption text-mf-text-3 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ←
      </button>
      <button
        type="button"
        data-testid="diff-next-change"
        disabled={disabled}
        onClick={onNext}
        aria-label="Next change"
        className="flex h-6 w-6 items-center justify-center rounded text-caption text-mf-text-3 hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
      >
        →
      </button>
    </div>
  );
}
