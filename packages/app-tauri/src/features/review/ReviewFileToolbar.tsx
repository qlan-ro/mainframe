/**
 * ReviewFileToolbar — 40px toolbar above the diff for the selected file.
 * Mirrors the prototype ReviewModal file toolbar (07-review.jsx 245-270):
 * filename · dir/ · +X −Y · spacer · "Open in workspace" · "Viewed" toggle.
 */
import { Check, ExternalLink } from 'lucide-react';

interface ReviewFileToolbarProps {
  file: string;
  additions: number;
  deletions: number;
  viewed: boolean;
  onToggleViewed: () => void;
  onOpenInWorkspace: () => void;
}

export function ReviewFileToolbar({
  file,
  additions,
  deletions,
  viewed,
  onToggleViewed,
  onOpenInWorkspace,
}: ReviewFileToolbarProps) {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  const name = file.split('/').pop() ?? file;

  return (
    <div className="flex h-[40px] shrink-0 items-center gap-[10px] border-b border-border bg-mf-content2 px-[14px]">
      <span className="font-mono text-label font-semibold text-foreground">{name}</span>
      {dir && <span className="truncate font-mono text-caption text-mf-text-4">{dir}/</span>}
      <span className="inline-flex gap-[7px] font-mono text-caption">
        <span className="font-semibold text-mf-success">+{additions}</span>
        <span className="font-semibold text-destructive">−{deletions}</span>
      </span>

      <div className="flex-1" />

      <button
        type="button"
        data-testid="review-open-in-workspace"
        onClick={onOpenInWorkspace}
        className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-border bg-background px-[10px] text-caption font-semibold text-muted-foreground transition-colors hover:bg-accent"
      >
        <ExternalLink size={12} aria-hidden />
        Open in workspace
      </button>

      <button
        type="button"
        data-testid="review-viewed-toggle"
        aria-pressed={viewed}
        onClick={onToggleViewed}
        className={`inline-flex h-[26px] items-center gap-[7px] rounded-md border px-[10px] transition-colors ${
          viewed ? 'border-mf-success/40 bg-mf-success/10' : 'border-border bg-background hover:bg-accent'
        }`}
      >
        <span
          className={`inline-flex h-[15px] w-[15px] items-center justify-center rounded-[4px] border-[1.5px] ${
            viewed ? 'border-mf-success bg-mf-success' : 'border-mf-text-4 bg-transparent'
          }`}
        >
          {viewed && <Check size={10} strokeWidth={2.6} className="text-white" aria-hidden />}
        </span>
        <span className={`text-caption font-semibold ${viewed ? 'text-mf-success' : 'text-muted-foreground'}`}>
          Viewed
        </span>
      </button>
    </div>
  );
}
