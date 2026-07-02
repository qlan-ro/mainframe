/**
 * ReviewFileTree — changed-file list with status badges + stat meters.
 *
 * Mirrors the prototype ReviewModal file list (07-review.jsx 218-241):
 * a "Changed files" heading, then rows with a tinted square status badge,
 * filename + dir, and a 5-square +/- stat meter. The active row gets the
 * brand selection tint; viewed (non-active) rows dim and strike through.
 */
import { KIND_LABEL } from '@/lib/git-status-kind';
import type { ReviewFile } from './git-status-to-files';

/**
 * Square badge tint per semantic status (text + chip background).
 * Alpha matches the design's exact `${statusColor}1f` hex-alpha (~12.16%),
 * not the previous /15 approximation.
 */
const BADGE_CLASS: Record<ReviewFile['status'], string> = {
  added: 'text-mf-success bg-mf-success/[12.16%]',
  modified: 'text-mf-warning bg-mf-warning/[12.16%]',
  deleted: 'text-mf-diff-del-text bg-mf-diff-del-text/[12.16%]',
  renamed: 'text-mf-warning bg-mf-warning/[12.16%]',
};

interface ReviewFileTreeProps {
  files: ReviewFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  viewedFiles?: Set<string>;
}

/** GitHub-style 5-square +/- proportion meter. */
function StatMeter({ path, additions, deletions }: { path: string; additions: number; deletions: number }) {
  const total = additions + deletions || 1;
  const addFrac = additions / total;
  const delFrac = (additions + deletions) / total;
  return (
    <span data-testid={`review-file-stat-${path}`} className="inline-flex shrink-0 items-center gap-[2px]">
      {Array.from({ length: 5 }, (_, i) => {
        const frac = (i + 1) / 5;
        const color =
          frac <= addFrac
            ? 'bg-mf-success'
            : frac <= delFrac + 0.0001 && addFrac < frac
              ? 'bg-mf-diff-del-text'
              : 'bg-mf-chip';
        return <span key={i} className={`size-[7px] rounded-[2px] ${color}`} />;
      })}
    </span>
  );
}

export function ReviewFileTree({ files, selectedFile, onSelectFile, viewedFiles }: ReviewFileTreeProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-3.5 pb-1.5 pt-[12px] text-micro font-bold uppercase tracking-wide text-mf-text-3">
        Changed files
      </div>
      {files.length === 0 ? (
        <div className="px-3.5 py-4 text-caption text-muted-foreground">No changes to review</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-[8px]">
          {files.map((f) => {
            const isSelected = selectedFile === f.path;
            const isViewed = viewedFiles?.has(f.path) ?? false;
            const fileName = f.path.split('/').pop() ?? f.path;
            const dirPath = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
            return (
              <button
                key={f.path}
                type="button"
                data-testid={`review-file-row-${f.path}`}
                onClick={() => onSelectFile(f.path)}
                className={`mb-px flex w-full items-center gap-2.5 rounded-md border-none px-2.5 py-1.5 text-left hover:bg-accent ${
                  isSelected ? 'bg-mf-selection' : 'bg-transparent'
                } ${isViewed && !isSelected ? 'opacity-55' : ''}`}
              >
                <span
                  className={`inline-flex size-[16px] shrink-0 items-center justify-center rounded font-mono text-micro font-extrabold ${BADGE_CLASS[f.status]}`}
                >
                  {KIND_LABEL[f.status]}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    title={f.path}
                    className={`truncate font-mono text-label text-foreground ${isSelected ? 'font-semibold' : 'font-medium'} ${isViewed ? 'line-through' : ''}`}
                  >
                    {fileName}
                  </span>
                  {dirPath && <span className="truncate text-micro text-mf-text-3">{dirPath}</span>}
                </span>
                <StatMeter path={f.path} additions={f.additions} deletions={f.deletions} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
