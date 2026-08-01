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
 */
import { useMemo, useState, type ComponentPropsWithoutRef, type ReactNode, type Ref } from 'react';
import { GroupedVirtuoso } from 'react-virtuoso';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type { SessionGroupResult } from '@/features/sessions/view-model/group-sessions';
import type { SessionItem } from '@/features/sessions/view-model/chat-to-thread-custom';
import { ScrollBar } from '@v2/components/ui/scroll-area';
import { SidebarMenu } from '@v2/components/ui/sidebar';
import { cn } from '@v2/lib/utils';
import { SessionGroupHeader } from './SessionGroupHeader';

const PINNED_GROUP_LABEL = 'Pinned';

interface ScrollerProps extends ComponentPropsWithoutRef<'div'> {
  ref?: Ref<HTMLDivElement>;
}

/**
 * The scroll viewport, carrying the list's test hook.
 *
 * Radix's overlay scrollbar rather than the native one: a classic bar reserves
 * layout width permanently, and at this row density the title column cannot
 * spare it. Virtuoso's ref must land on the Viewport — the element that
 * actually scrolls — so the Root only takes the flex sizing and the content
 * cap; handing it the rest of Virtuoso's style would make it a second scroll
 * container that Virtuoso never measures, stranding every row past the fold.
 *
 * Declared at module scope: an inline component identity would remount the
 * scroller on every render.
 */
function SessionsScroller({ className, style, children, ref, ...rest }: ScrollerProps) {
  const { maxHeight, ...viewportStyle } = style ?? {};
  return (
    <ScrollAreaPrimitive.Root type="hover" className={cn('relative overflow-hidden', className)} style={{ maxHeight }}>
      <ScrollAreaPrimitive.Viewport
        ref={ref}
        {...rest}
        style={viewportStyle}
        // `[&>div]:block!`: Radix wraps viewport children in a `display:table`
        // div, which shrink-wraps Virtuoso's item list and collapses the
        // measured content height to a single row.
        className="size-full overscroll-contain bg-transparent [&>div]:block!"
        // After {...rest}: Virtuoso injects its own data-testid, which must not
        // take the list's test hook.
        data-testid="sessions-list-scroll"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
    </ScrollAreaPrimitive.Root>
  );
}

/**
 * One `<ul>` per row. Rows are `SidebarMenuItem`s — `<li>` elements — and
 * Virtuoso interleaves them with group-header divs, so a single list wrapper
 * would have to hold both. Per-row lists keep the markup valid without giving
 * up the stock menu contract.
 */
function SessionsItem(props: ComponentPropsWithoutRef<'ul'>) {
  return <SidebarMenu {...props} className="gap-0" />;
}

const VIRTUOSO_COMPONENTS = { Scroller: SessionsScroller, Item: SessionsItem };

export interface SessionListVirtuosoProps {
  groups: SessionGroupResult[];
  renderItem: (item: SessionItem, flags: { inPinnedGroup: boolean }) => ReactNode;
}

export function SessionListVirtuoso({ groups, renderItem }: SessionListVirtuosoProps) {
  const groupCounts = useMemo(() => groups.map((g) => g.items.length), [groups]);
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  // Shrink-to-content, capped by the available space. `flex-1` alone stretches
  // to fill the panel, leaving a blank gap under a short list and pushing the
  // sections below it down; tracking Virtuoso's own measured height and capping
  // the element to it keeps growth content-driven until the list is long enough
  // to need the whole column.
  const [contentHeight, setContentHeight] = useState<number>();

  return (
    <GroupedVirtuoso
      className="min-h-0 flex-[9999_1_0%]"
      style={contentHeight != null ? { maxHeight: contentHeight } : undefined}
      totalListHeightChanged={setContentHeight}
      groupCounts={groupCounts}
      components={VIRTUOSO_COMPONENTS}
      // Overscan a little, so a fast scroll doesn't reveal blank space before
      // rows hydrate.
      increaseViewportBy={200}
      groupContent={(groupIndex) => <SessionGroupHeader label={groups[groupIndex]?.label ?? ''} />}
      itemContent={(index, groupIndex) => {
        const item = flatItems[index];
        const group = groups[groupIndex];
        if (item == null || group == null) return null;
        return renderItem(item, { inPinnedGroup: group.label === PINNED_GROUP_LABEL });
      }}
    />
  );
}
