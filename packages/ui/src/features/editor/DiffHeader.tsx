/**
 * DiffHeader — the diff view's 32px header: the file's name, its folder, the
 * +N / −N counts, then the prev/next navigation buttons and Reveal on the right.
 *
 * data-testids:
 *   diff-prev-change  — navigate to the previous diff chunk
 *   diff-next-change  — navigate to the next diff chunk
 *   diff-reveal       — reveal file in tree
 */
import { ChevronDown, ChevronUp, Crosshair } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { emitSurfaceIntent } from '@/store/surface-intents';

const baseName = (path: string): string => path.split('/').pop() ?? path;
const folderOf = (path: string): string => path.split('/').slice(0, -1).join('/');

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
      className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border pr-1.5 pl-3.5 text-meta/[1.45]"
    >
      <span className="shrink-0 font-medium text-ink-secondary">{baseName(fileName)}</span>
      <span className="min-w-0 truncate text-muted-foreground" title={filePath ?? fileName}>
        {folderOf(filePath ?? fileName)}
      </span>

      {additions !== undefined && <span className="text-success tabular-nums">+{additions}</span>}
      {deletions !== undefined && <span className="text-red tabular-nums">−{deletions}</span>}
      {additions === undefined && deletions === undefined && (
        <span className="text-muted-foreground tabular-nums">{changeCount} changes</span>
      )}
      <span className="flex-1" />

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
