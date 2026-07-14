/**
 * SessionRowHoverActions — tag / rename / archive icon buttons revealed on
 * row hover (artboard SessionRowDense `.tw-row-actions` shown on `:hover`,
 * swapping out the time). Extracted out of SessionRow.tsx to keep it under
 * the file-size limit. Each click stops propagation so it doesn't also
 * select the row, and wires to the same handlers the right-click context
 * menu uses.
 */
import type { MouseEvent } from 'react';
import { PaperclipIcon, TagIcon, XIcon } from 'lucide-react';
import { Hint } from '@/components/ui/hint';

export function RowHoverActions({
  onTags,
  onRename,
  onArchive,
}: {
  onTags: (rect: DOMRect) => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  const btn =
    'inline-flex size-[22px] items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };
  return (
    <div className="hidden flex-shrink-0 items-center group-hover:flex">
      <Hint label="Tags">
        <button
          data-testid="sessions-row-action-tags"
          type="button"
          className={btn}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onTags(e.currentTarget.getBoundingClientRect());
          }}
        >
          <TagIcon className="size-3.5" />
        </button>
      </Hint>
      <Hint label="Rename">
        <button data-testid="sessions-row-action-rename" type="button" className={btn} onClick={stop(onRename)}>
          <PaperclipIcon className="size-3.5" />
        </button>
      </Hint>
      <Hint label="Archive">
        <button data-testid="sessions-row-action-archive" type="button" className={btn} onClick={stop(onArchive)}>
          <XIcon className="size-3.5" />
        </button>
      </Hint>
    </div>
  );
}
