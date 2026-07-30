/**
 * SessionRowTrailingSlot — the row's one permanently reserved trailing
 * region (SESSION_ROW_TRAILING_SLOT_PX wide, never changes width or
 * position). At rest it holds the relative timestamp; on hover, the three
 * hover-action buttons paint over the exact same rectangle, absolutely
 * positioned. The slot's width is fixed inline, so hiding the timestamp
 * costs no geometry: the overlay carries no background of its own and the
 * timestamp goes `invisible` on hover instead, so nothing ever bleeds
 * through underneath the icons and the row's own hover/active background
 * (painted by SessionRow's Root, one layer down) shows through unchanged.
 * Requires an ancestor with the `group` class (SessionRow's
 * ThreadListItemPrimitive.Root) to drive group-hover.
 */
import { RowHoverActions } from './SessionRowHoverActions';
import { formatRelativeTime } from '../view-model/relative-time';
import { SESSION_ROW_TRAILING_SLOT_PX } from './session-row-layout';

function RelativeTime({ updatedAt }: { updatedAt: number }) {
  const text = formatRelativeTime(updatedAt, Date.now());
  return (
    <span
      data-testid="sessions-row-relative-time"
      className="text-caption tabular-nums text-muted-foreground group-hover:invisible"
    >
      {text}
    </span>
  );
}

export function SessionRowTrailingSlot({
  updatedAt,
  pinned,
  onPin,
  onUnpin,
  onTags,
  onArchive,
}: {
  updatedAt: number;
  pinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onTags: (rect: DOMRect) => void;
  onArchive: () => void;
}) {
  return (
    <div
      data-testid="sessions-row-trailing-slot"
      className="relative flex flex-shrink-0 items-center justify-end"
      style={{ width: SESSION_ROW_TRAILING_SLOT_PX }}
    >
      <RelativeTime updatedAt={updatedAt} />
      <div className="absolute inset-0 hidden items-center justify-end group-hover:flex">
        <RowHoverActions pinned={pinned} onPin={onPin} onUnpin={onUnpin} onTags={onTags} onArchive={onArchive} />
      </div>
    </div>
  );
}
