/**
 * The header for one section of the sessions list (Pinned / Today / … ), from
 * the second group on; the first group's is the parked `SidebarJumpSection`
 * header, which also carries the list's controls.
 *
 * 24px, bottom-aligned, with 14px above it (L4). The space above is padding
 * because Virtuoso measures the header box, and it has to stay opaque: the
 * pinned copy covers the rows scrolling beneath it.
 *
 * `GroupedVirtuoso` owns the sticky positioning, so there is no `sticky top-0`
 * here.
 */
import { SidebarGroupLabel } from '@/components/ui/sidebar';
import { FadeLabel } from '@/components/ui/fade-label';
import { JUMP_HEADER_HEIGHT } from '../shared/SidebarJumpSection';

/** The space above a group header, in px — tucked under the parked header once stuck. */
export const GROUP_GAP = 14;

/** Where a stuck header's box starts: its space is hidden behind the parked header. */
export const STUCK_HEADER_TOP = JUMP_HEADER_HEIGHT - GROUP_GAP;

/** How deep the parked header and the stuck one reach together, in px: `h-9.5` from there. */
export const HEADER_STACK_DEPTH = STUCK_HEADER_TOP + 38;

export function SessionGroupHeader({ label }: { label: string }) {
  return (
    <SidebarGroupLabel
      data-testid={`sessions-group-header-${label}`}
      className="h-9.5 items-end rounded-none bg-sidebar pt-3.5 pb-1"
    >
      <FadeLabel className="flex-1">{label}</FadeLabel>
    </SidebarGroupLabel>
  );
}
