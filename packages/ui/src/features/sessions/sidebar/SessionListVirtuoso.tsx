/**
 * SessionListVirtuoso — the windowed sessions list.
 *
 * The list can hold hundreds of sessions; rendering every row mounts a
 * ContextMenu + several tooltip roots + a ResizeObserver PER row, so a filter
 * switch (which swaps the whole visible set) used to unmount/mount hundreds of
 * heavy rows in one synchronous commit — the dominant cost behind the poor INP
 * when switching projects. GroupedVirtuoso keeps only the visible window mounted
 * (~20 rows), so the cost no longer scales with the session count.
 *
 * It preserves the existing layout contract:
 *   - the TIME/status group headers (Pinned / Today / …) via `groupContent`,
 *     with GroupedVirtuoso handling the sticky-header behavior itself;
 *   - one SessionRow per item via `renderItem`, keyed by the stable item id;
 *   - the `sessions-list-scroll` scroller test hook (on the Scroller component).
 *
 * `groups` is the already-arranged, already-filtered SessionGroupResult[]; the
 * flat item array and per-group counts are derived from it (GroupedVirtuoso
 * addresses items by a flat index alongside the group index).
 */
import { forwardRef, useMemo, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { GroupedVirtuoso } from 'react-virtuoso';
import type { SessionGroupResult } from '../view-model/group-sessions';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { SessionGroupHeader } from './SessionGroupHeader';
import { cn } from '@/lib/utils';

export interface SessionListVirtuosoProps {
  groups: SessionGroupResult[];
  showProject: boolean;
  renderItem: (item: SessionItem, flags: { inPinnedGroup: boolean; showProject: boolean }) => ReactNode;
}

// The scroll viewport. Carries the list test hook; forwardRef is required —
// Virtuoso attaches its scroll listener to this node. Defined at module scope
// so its identity is stable across renders (an inline component would remount
// the scroller every render).
const SessionsScroller = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  function SessionsScroller(props, ref) {
    const { className, ...rest } = props;
    return (
      <div
        ref={ref}
        className={cn('overscroll-contain bg-transparent', className)}
        {...rest}
        // After {...rest}: Virtuoso injects its own data-testid ("virtuoso-scroller")
        // which must not override the list's test hook.
        data-testid="sessions-list-scroll"
      />
    );
  },
);

// The pinned group-header host. Its SessionGroupHeader child paints translucent
// glass, but WKWebView's backdrop-filter does not reliably sample sibling rows
// scrolled beneath a sticky element — row text ghosted through the pinned
// header. Composite the glass tint over the opaque window color so the pinned
// copy (and only it — in-flow headers have nothing beneath them) is opaque.
const SessionsTopItemList = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(function SessionsTopItemList(
  { style, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      {...rest}
      style={{ ...style, background: 'linear-gradient(var(--mf-glass), var(--mf-glass)), var(--mf-window)' }}
    />
  );
});

const VIRTUOSO_COMPONENTS = { Scroller: SessionsScroller, TopItemList: SessionsTopItemList };

export function SessionListVirtuoso({ groups, showProject, renderItem }: SessionListVirtuosoProps) {
  const groupCounts = useMemo(() => groups.map((g) => g.items.length), [groups]);
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // Shrink-to-content, capped by the flex-1 space: `flex-1` alone always stretches
  // to fill whatever room is available (its default flex-basis), leaving a blank
  // gap below a short list and pushing TasksSidebarSection/TagFilterBar down with
  // it. Track the real rendered height via Virtuoso's own measurement and cap the
  // element to it with `maxHeight` — flex-grow still governs sizing (and internal
  // virtualized scrolling) once the session count is large enough to exceed it.
  //
  // flex-[9999_1_0%], not flex-1: SessionSidebar.tsx has a second flex-grow
  // sibling (the spacer before TagFilterBar) competing for the same leftover
  // space. Equal flex-grow (both flex-1) splits that space ~50/50 BEFORE
  // max-height is applied — if the list's content needs more than its half,
  // it gets frozen at the smaller half and scrolls internally even though the
  // spacer would happily have yielded more room. A much larger grow weight
  // here means the list is offered virtually all the leftover space first (so
  // it reaches its content-based max-height and stops growing there); only
  // once content genuinely exceeds the *entire* available space does it stay
  // capped and hand the (now real) leftover back to the spacer.
  const [contentHeight, setContentHeight] = useState<number>();

  return (
    // pb only: top padding on the scroller opens a see-through band above the
    // pinned group header (sticky pins to the content edge, below the padding).
    <GroupedVirtuoso
      className="min-h-0 flex-[9999_1_0%] pb-0.5"
      style={contentHeight != null ? { maxHeight: contentHeight } : undefined}
      totalListHeightChanged={setContentHeight}
      groupCounts={groupCounts}
      components={VIRTUOSO_COMPONENTS}
      // Skip the visible window as fast as it can; overscan a little so a quick
      // scroll doesn't reveal blank space before rows hydrate.
      increaseViewportBy={200}
      groupContent={(groupIndex) => <SessionGroupHeader label={groups[groupIndex]?.label ?? ''} />}
      itemContent={(index, groupIndex) => {
        const item = flatItems[index];
        const group = groups[groupIndex];
        if (item == null || group == null) return null;
        return renderItem(item, { inPinnedGroup: group.label === 'Pinned', showProject });
      }}
    />
  );
}
