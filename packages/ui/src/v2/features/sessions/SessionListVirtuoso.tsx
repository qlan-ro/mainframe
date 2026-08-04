/**
 * The windowed sessions list.
 *
 * Every row mounts a context menu, several tooltip roots and a ResizeObserver,
 * so rendering all of them made a filter switch unmount and mount hundreds of
 * heavy rows in one commit. `GroupedVirtuoso` keeps ~20 mounted, so the cost
 * stops scaling with the session count.
 *
 * `groups` arrives already filtered and arranged; the flat item array and the
 * per-group counts are derived here, since GroupedVirtuoso addresses items by a
 * flat index alongside the group index.
 *
 * The list does NOT own a scroller: it windows against the sidebar's shared one
 * via `customScrollParent`, so Tasks and Tags below it scroll as part of the
 * same surface instead of stranding the wheel at a nested boundary.
 */
import { useEffect, useMemo, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { GroupedVirtuoso } from 'react-virtuoso';
import type { SessionGroupResult } from '@/features/sessions/view-model/group-sessions';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { SidebarMenu } from '@v2/components/ui/sidebar';
import { JUMP_HEADER_HEIGHT } from '../shared/SidebarJumpSection';
import { useScrollRegion } from '../shared/SidebarScrollRegion';
import { SessionGroupHeader } from './SessionGroupHeader';

const PINNED_GROUP_LABEL = 'Pinned';

/**
 * One `<ul>` per row. Rows are `SidebarMenuItem`s — `<li>` elements — and
 * Virtuoso interleaves them with group-header divs, so a single list wrapper
 * would have to hold both. Per-row lists keep the markup valid without giving
 * up the stock menu contract.
 *
 * The gap is padding rather than the menu's own `gap`, which cannot reach
 * across two sibling lists: without it a hovered row and the selected row above
 * it fuse into one fill.
 */
function SessionsItem(props: ComponentPropsWithoutRef<'ul'>) {
  return <SidebarMenu {...props} className="gap-0 pb-0.5" />;
}

/**
 * Virtuoso sticks group headers at `top: 0` of the scroll parent, which is where
 * the list's own parked header already sits. Offsetting by its height lets the
 * two stack instead of the group header sliding underneath it.
 */
function SessionsGroup({ style, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div {...rest} style={{ ...style, top: JUMP_HEADER_HEIGHT }} />;
}

const VIRTUOSO_COMPONENTS = { Item: SessionsItem, Group: SessionsGroup };

export interface SessionListVirtuosoProps {
  groups: SessionGroupResult[];
  renderItem: (item: SessionItem, flags: { inPinnedGroup: boolean }) => ReactNode;
}

export function SessionListVirtuoso({ groups, renderItem }: SessionListVirtuosoProps) {
  const groupCounts = useMemo(() => groups.map((g) => g.items.length), [groups]);
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const scrollParent = useScrollRegion();

  // WKWebView boot race: Virtuoso measures its viewport once on mount, and on
  // some boots that instant lands mid-layout — the rect comes back empty. Its
  // only re-measure triggers are parent scroll/resize, but a blank list can't
  // scroll and the sidebar never resizes, so it wedges at zero rows forever.
  // A synthetic scroll event drives the exact re-measure path it listens to;
  // harmless when the mount measured correctly. Twice (post-paint + 300ms)
  // to cover a still-settling first layout.
  useEffect(() => {
    if (scrollParent == null) return;
    const nudge = () => scrollParent.dispatchEvent(new Event('scroll'));
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(nudge);
    });
    const timer = setTimeout(nudge, 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [scrollParent]);

  // Mounting before the viewport exists would make Virtuoso fall back to its own
  // scroller for a frame, then tear it down — one skipped frame is cheaper.
  if (scrollParent == null) return null;

  return (
    <GroupedVirtuoso
      customScrollParent={scrollParent}
      groupCounts={groupCounts}
      components={VIRTUOSO_COMPONENTS}
      // Overscan a little, so a fast scroll doesn't reveal blank space before
      // rows hydrate.
      increaseViewportBy={200}
      // The first group's header is parked above the list, so drawing it here
      // too would double it at the top of the scroll. A hairline stands in for
      // it rather than nothing: Virtuoso treats a zero-sized group as a bug.
      groupContent={(groupIndex) =>
        groupIndex === 0 ? (
          <div aria-hidden className="h-px" />
        ) : (
          <SessionGroupHeader label={groups[groupIndex]?.label ?? ''} />
        )
      }
      itemContent={(index, groupIndex) => {
        const item = flatItems[index];
        const group = groups[groupIndex];
        if (item == null || group == null) return null;
        return renderItem(item, { inPinnedGroup: group.label === PINNED_GROUP_LABEL });
      }}
    />
  );
}
