/**
 * ReviewFileTree — changed-file list with semantic status badges.
 *
 * Renders the list of changed files produced by `gitStatusToFiles`.
 * Each row has a `data-testid` keyed on the stable file path. The status
 * badge displays a single-char tint label (A/M/D/R) matching the ChangesPanel
 * convention, derived from the semantic `status` field — NOT from raw porcelain
 * codes (the mapper already ran).
 */
import { KIND_LABEL } from '@/lib/git-status-kind';
import { TruncatedWithTooltip } from '@/components/ui/truncated-with-tooltip';
import type { ReviewFile } from './git-status-to-files';

const BADGE_CLASS: Record<ReviewFile['status'], string> = {
  added: 'text-mf-diff-add-text',
  modified: 'text-mf-warning',
  deleted: 'text-mf-diff-del-text',
  renamed: 'text-mf-warning',
};

interface ReviewFileTreeProps {
  files: ReviewFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
}

export function ReviewFileTree({ files, selectedFile, onSelectFile }: ReviewFileTreeProps) {
  if (files.length === 0) {
    return <div className="px-3 py-4 text-caption text-muted-foreground">No changes to review</div>;
  }

  return (
    <div className="py-1 overflow-y-auto">
      {files.map((f) => {
        const badgeClass = BADGE_CLASS[f.status];
        const isSelected = selectedFile === f.path;
        const fileName = f.path.split('/').pop() ?? f.path;
        const dirPath = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
        return (
          <button
            key={f.path}
            type="button"
            data-testid={`review-file-row-${f.path}`}
            onClick={() => onSelectFile(f.path)}
            className={`flex h-[22px] w-full items-center gap-2 border-none bg-transparent px-3 text-left text-caption text-muted-foreground hover:bg-accent hover:text-foreground ${isSelected ? 'bg-mf-selection text-foreground' : ''}`}
          >
            <span className={`w-3 flex-shrink-0 text-center font-mono text-micro ${badgeClass}`}>
              {KIND_LABEL[f.status]}
            </span>
            {/* Filename gets priority (shows fully); the dir path truncates first to make room. */}
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <TruncatedWithTooltip
                text={fileName}
                tooltip={f.path}
                className="max-w-full flex-shrink-0 text-foreground"
                contentClassName="font-mono break-all"
              />
              {dirPath && <span className="min-w-0 truncate font-mono text-micro text-mf-text-3">{dirPath}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}
