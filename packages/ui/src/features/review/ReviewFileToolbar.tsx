/**
 * ReviewFileToolbar — 40px toolbar above the diff for the selected file.
 * Mirrors the prototype ReviewModal file toolbar (07-review.jsx 245-270):
 * filename · dir/ · +X −Y · spacer · "Open in workspace" · "Viewed" toggle.
 */
import { Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';

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
    <div className="flex h-10 shrink-0 items-center gap-2.5 border-b bg-card px-3.5">
      <span className="shrink-0 font-mono text-xs font-semibold text-foreground">{name}</span>
      {dir && <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{dir}/</span>}
      <span className="inline-flex gap-2 font-mono text-xs">
        <span className="font-semibold text-mf-diff-add-text">+{additions}</span>
        <span className="font-semibold text-mf-diff-del-text">−{deletions}</span>
      </span>

      <div className="flex-1" />

      <Button variant="outline" size="sm" data-testid="review-open-in-workspace" onClick={onOpenInWorkspace}>
        <ExternalLink aria-hidden />
        Open in workspace
      </Button>

      <Toggle
        variant="outline"
        size="sm"
        data-testid="review-viewed-toggle"
        pressed={viewed}
        onPressedChange={onToggleViewed}
        className="data-[state=on]:border-success/40 data-[state=on]:bg-success/10 data-[state=on]:text-foreground"
      >
        <Check strokeWidth={2.6} className={viewed ? 'text-success' : 'text-muted-foreground'} aria-hidden />
        Viewed
      </Toggle>
    </div>
  );
}
