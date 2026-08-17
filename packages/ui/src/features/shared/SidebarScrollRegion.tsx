/**
 * The sidebar's scrolling body — stock `SidebarContent`, which shadcn documents
 * as the scroller, with two things attached to it.
 *
 * Sessions and Tasks scroll as a unit here rather than each owning a scroller:
 * several scrollbars in one panel read as several panels, and a windowed list
 * nested inside a scrolling page traps the wheel at whichever boundary the
 * pointer happens to be over. The panel's switcher stays out of this, in
 * `SidebarHeader`, so a long session list can't scroll it away.
 *
 * The element is published through context because the session list is
 * virtualized — `GroupedVirtuoso` needs it as its `customScrollParent` to keep
 * windowing rows against a scroller it does not own.
 *
 * Content fades in and out at both edges instead of being clipped. The fade is
 * the shadcn `scroll-fade` utility, which drives its depth off a scroll
 * timeline, so an edge with nothing past it is not dimmed. All this component
 * adds is how far the sticky headers parked at each edge reach, which the
 * `scroll-fade-sticky` shape starts its ramps below.
 */
import { createContext, useContext, useState, type CSSProperties, type ReactNode } from 'react';
import { SidebarContent } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useStickyInsets } from './use-sticky-insets';

const ScrollRegionContext = createContext<HTMLDivElement | null>(null);

/** Null until the scroller mounts; consumers that need it should wait. */
export function useScrollRegion(): HTMLDivElement | null {
  return useContext(ScrollRegionContext);
}

export function SidebarScrollRegion({
  children,
  className,
  tut,
}: {
  children: ReactNode;
  className?: string;
  /** `data-tut` anchor, when this region is a first-run tour target. */
  tut?: string;
}) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const insets = useStickyInsets(viewport);

  return (
    <SidebarContent
      ref={setViewport}
      data-testid="sidebar-scroll"
      data-tut={tut}
      className={cn(
        // gap-0: a section's parked header and its content are siblings here —
        // they have to be, or the header could never lift above its own box —
        // so the stock gap would fall between a header and the rows it labels.
        'gap-0',
        // The panel is the whole surface; chaining a scroll out of it to the
        // window would move something the user cannot see.
        'overscroll-contain',
        'scroll-fade-y scroll-fade-sticky',
        className,
      )}
      style={
        {
          '--scroll-fade-inset-t': `${insets.top}px`,
          '--scroll-fade-inset-b': `${insets.bottom}px`,
        } as CSSProperties
      }
    >
      <ScrollRegionContext.Provider value={viewport}>{children}</ScrollRegionContext.Provider>
    </SidebarContent>
  );
}
