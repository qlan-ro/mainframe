/**
 * SessionRowTrailingSlot — the row's one permanently reserved trailing
 * region (SESSION_ROW_TRAILING_SLOT_PX wide, never changes width or
 * position). At rest it holds the relative timestamp; on hover, the three
 * hover-action buttons paint over the exact same rectangle, absolutely
 * positioned, on the row's own resolved hover/active background — so
 * nothing else in the row reflows, and nothing bleeds through underneath
 * the icons. Requires an ancestor with the `group` class (SessionRow's
 * ThreadListItemPrimitive.Root) to drive group-hover/group-data-[active].
 */
import { RowHoverActions } from './SessionRowHoverActions';
import { formatRelativeTime } from '../view-model/relative-time';
import { SESSION_ROW_TRAILING_SLOT_PX } from './session-row-layout';

function RelativeTime({ updatedAt }: { updatedAt: number }) {
  const text = formatRelativeTime(updatedAt, Date.now());
  return (
    <span data-testid="sessions-row-relative-time" className="text-caption tabular-nums text-muted-foreground">
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
      <div className="absolute inset-0 hidden items-center justify-end bg-accent group-hover:flex group-data-[active=true]:bg-mf-selection">
        <RowHoverActions pinned={pinned} onPin={onPin} onUnpin={onUnpin} onTags={onTags} onArchive={onArchive} />
      </div>
    </div>
  );
}
