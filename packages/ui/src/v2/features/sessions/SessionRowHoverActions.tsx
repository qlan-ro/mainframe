/**
 * Pin / tag / archive, revealed on row hover.
 *
 * Three `SidebarMenuAction`s rather than one "more" menu: these are the primary
 * entry points (the pin glyph on a pinned row is an indicator, not a button),
 * and stock's reveal — opacity driven by `group/menu-item` — is exactly the
 * hand-rolled `group-hover:flex` this replaces. The primitive parks itself at
 * `right-1`, so stacking three only takes a right offset per slot; each is
 * `w-5`, so the rungs sit flush at 4/24/44px and read as one cluster.
 */
import type { MouseEvent } from 'react';
import { ArchiveIcon, PinIcon, PinOffIcon, TagIcon } from 'lucide-react';
import { SidebarMenuAction } from '@v2/components/ui/sidebar';
import { Hint } from '@v2/components/ui/hint';

interface RowHoverActionsProps {
  pinned: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onTags: (rect: DOMRect) => void;
  onArchive: () => void;
}

/** The row itself is the select target, so every action has to swallow its click. */
const stop = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  e.preventDefault();
  fn();
};

export function RowHoverActions({ pinned, onPin, onUnpin, onTags, onArchive }: RowHoverActionsProps) {
  return (
    <>
      <Hint label="Archive">
        <SidebarMenuAction
          showOnHover
          data-testid="sessions-row-action-archive"
          className="right-1"
          onClick={stop(onArchive)}
        >
          <ArchiveIcon />
        </SidebarMenuAction>
      </Hint>
      <Hint label="Tags">
        <SidebarMenuAction
          showOnHover
          data-testid="sessions-row-action-tags"
          className="right-6"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onTags(e.currentTarget.getBoundingClientRect());
          }}
        >
          <TagIcon />
        </SidebarMenuAction>
      </Hint>
      <Hint label={pinned ? 'Unpin' : 'Pin'}>
        <SidebarMenuAction
          showOnHover
          data-testid="sessions-row-action-pin"
          className="right-11"
          onClick={stop(pinned ? onUnpin : onPin)}
        >
          {pinned ? <PinOffIcon /> : <PinIcon />}
        </SidebarMenuAction>
      </Hint>
    </>
  );
}
