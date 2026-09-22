/**
 * NotesSubmitBar — the lifted-tab "N of M agent notes filled" submit bar.
 *
 * Shown once per file tab (markdown, CSV, SVG), in every mode that tab
 * offers, regardless of which mode or surface created each note. Reuses the
 * code/diff editor's testids so e2e selectors don't need a per-viewer variant.
 */
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface NotesSubmitBarProps {
  /** Total notes in the file tab's owned set, across every mode. */
  total: number;
  /** Notes (draft or saved) that currently have non-empty text. */
  filled: number;
  onSubmit: () => void;
}

export function NotesSubmitBar({ total, filled, onSubmit }: NotesSubmitBarProps) {
  return (
    <div
      data-testid="editor-submit-review"
      className="flex h-7.5 shrink-0 items-center gap-2 border-b border-border bg-card px-3"
    >
      <MessageSquare className="size-3 shrink-0 text-primary" aria-hidden />
      <span className="text-xs text-muted-foreground">
        {filled} of {total} agent {total === 1 ? 'note' : 'notes'} filled
      </span>
      <div className="flex-1" />
      <Button
        data-testid="editor-submit-review-btn"
        variant="default"
        size="xs"
        onClick={onSubmit}
        disabled={filled === 0}
      >
        Submit review ({total})
      </Button>
    </div>
  );
}
