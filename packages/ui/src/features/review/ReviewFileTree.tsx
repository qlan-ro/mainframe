/**
 * ReviewFileTree — changed-file list with status badges + stat meters.
 *
 * Mirrors the prototype ReviewModal file list (07-review.jsx 218-241):
 * a "Changed files" heading, then rows with a tinted square status badge,
 * filename + dir, and a 5-square +/- stat meter. The active row gets the
 * selection tint; viewed (non-active) rows dim and strike through.
 *
 * Badge and meter are per-file facts the daemon only reports for some change
 * scopes, so each is omitted when absent rather than defaulted: a "modified"
 * badge on a file nobody classified, or a flat meter on a file nobody counted,
 * both state something the payload never said.
 */
import { KIND_LABEL } from '@/lib/git-status-kind';
import type { ReviewFile } from './git-status-to-files';
import type { WorkingChangeFile } from './use-working-changes';

/**
 * Square badge tint per semantic status (text + chip background).
 * Alpha matches the design's exact `${statusColor}1f` hex-alpha (~12.16%).
 * These are the app's ordinary status hues, not the diff engine's palette: the
 * bridge's `mf-warning` / `mf-diff-del-text` were only ever here because v2
 * `warning` used to be a destructive mix. Measured on the amber: the badge
 * letter reads at 10.2–12.0:1 on every tint in both themes, so no bespoke
 * add/del token is warranted.
 */
const BADGE_CLASS: Record<ReviewFile['status'], string> = {
  added: 'text-foreground bg-success/[12.16%]',
  modified: 'text-foreground bg-warning/[12.16%]',
  deleted: 'text-foreground bg-destructive/[12.16%]',
  renamed: 'text-foreground bg-warning/[12.16%]',
};

interface ReviewFileTreeProps {
  files: WorkingChangeFile[];
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
          frac <= addFrac ? 'bg-success' : frac <= delFrac + 0.0001 && addFrac < frac ? 'bg-destructive' : 'bg-accent';
        return <span key={i} className={`size-[9px] rounded-[2px] ${color}`} />;
      })}
    </span>
  );
}

export function ReviewFileTree({ files, selectedFile, onSelectFile, viewedFiles }: ReviewFileTreeProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3.5 pb-1.5 pt-3 text-xs font-medium text-muted-foreground">Changed files</div>
      {files.length === 0 ? (
        <div data-testid="review-file-tree-empty" className="px-3.5 py-4 text-xs text-muted-foreground">
          No changes to review
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
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
                  isSelected ? 'bg-sidebar-selection' : 'bg-transparent'
                } ${isViewed && !isSelected ? 'opacity-55' : ''}`}
              >
                {f.status && (
                  <span
                    data-testid={`review-file-status-${f.path}`}
                    className={`inline-flex size-4 shrink-0 items-center justify-center rounded font-mono text-xs font-extrabold ${BADGE_CLASS[f.status]}`}
                  >
                    {KIND_LABEL[f.status]}
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    title={f.path}
                    className={`truncate font-mono text-xs text-foreground ${isSelected ? 'font-semibold' : 'font-medium'} ${isViewed ? 'line-through' : ''}`}
                  >
                    {fileName}
                  </span>
                  {dirPath && <span className="truncate text-xs text-muted-foreground">{dirPath}</span>}
                </span>
                {f.additions !== undefined && f.deletions !== undefined && (
                  <StatMeter path={f.path} additions={f.additions} deletions={f.deletions} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
