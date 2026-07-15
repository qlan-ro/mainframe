/**
 * SessionRowHoverActions — pin / tag / archive icon buttons revealed on row
 * hover (artboard SessionRowDense `.tw-row-actions` shown on `:hover`,
 * swapping out the time). Extracted out of SessionRow.tsx to keep it under
 * the file-size limit. Each click stops propagation so it doesn't also
 * select the row, and wires to the same handlers the right-click context
 * menu uses.
 *
 * Pin/Unpin lives here AND in the context menu (this is the primary-interface
 * entry point — the persistent pin glyph shown on a pinned row is an
 * indicator only, not clickable). No inline Rename button here — the
 * right-click context menu (SessionContextMenu) already offers Rename, so a
 * duplicate inline shortcut is redundant.
 */
import type { MouseEvent } from 'react';
import { PinIcon, PinOffIcon, TagIcon, XIcon } from 'lucide-react';
import { Hint } from '@/components/ui/hint';

export function RowHoverActions({
  pinned,
  onPin,
  onUnpin,
  onTags,
  onArchive,
}: {
  pinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onTags: (rect: DOMRect) => void;
  onArchive: () => void;
}) {
  const btn =
    'inline-flex size-[26px] items-center justify-center rounded-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    fn();
  };
  return (
    <div className="hidden flex-shrink-0 items-center group-hover:flex">
      <Hint label={pinned ? 'Unpin' : 'Pin'}>
        <button
          data-testid="sessions-row-action-pin"
          type="button"
          className={btn}
          onClick={stop(pinned ? onUnpin : onPin)}
        >
          {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
        </button>
      </Hint>
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
      <Hint label="Archive">
        <button data-testid="sessions-row-action-archive" type="button" className={btn} onClick={stop(onArchive)}>
          <XIcon className="size-3.5" />
        </button>
      </Hint>
    </div>
  );
}
