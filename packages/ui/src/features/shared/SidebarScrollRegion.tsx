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
 * Content fades in and out at both edges instead of being clipped, matching the
 * `truncate-fade` ramp the row labels use.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { SidebarContent } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useScrollEdges, type ScrollEdges } from './use-scroll-edges';

/** Depth of the ramp, in px — long enough to read as a fade, short enough not to eat a row. */
const FADE = 20;

/**
 * The edge fades, as a mask on the scroller.
 *
 * The complication is that the section headers are sticky children of this same
 * scroller, so they sit exactly where the ramps want to be and a plain
 * top/bottom fade would dissolve them first. Each ramp therefore starts below
 * the measured header stack, with a hard stop holding full opacity across it.
 */
function edgeMask({ top, bottom, topInset, bottomInset }: ScrollEdges): string | undefined {
  if (!top && !bottom) return undefined;

  const stops = [`#000 0`, `#000 ${topInset}px`];
  if (top) stops.push(`transparent ${topInset}px`, `#000 ${topInset + FADE}px`);
  if (bottom) {
    stops.push(`#000 calc(100% - ${bottomInset + FADE}px)`, `transparent calc(100% - ${bottomInset}px)`);
  }
  stops.push(`#000 calc(100% - ${bottomInset}px)`, `#000 100%`);

  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

const ScrollRegionContext = createContext<HTMLDivElement | null>(null);

/** Null until the scroller mounts; consumers that need it should wait. */
export function useScrollRegion(): HTMLDivElement | null {
  return useContext(ScrollRegionContext);
}

export function SidebarScrollRegion({ children, className }: { children: ReactNode; className?: string }) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const edges = useScrollEdges(viewport);

  return (
    <SidebarContent
      ref={setViewport}
      data-testid="sidebar-scroll"
      className={cn(
        // gap-0: a section's parked header and its content are siblings here —
        // they have to be, or the header could never lift above its own box —
        // so the stock gap would fall between a header and the rows it labels.
        'gap-0',
        // The panel is the whole surface; chaining a scroll out of it to the
        // window would move something the user cannot see.
        'overscroll-contain',
        className,
      )}
      style={{ maskImage: edgeMask(edges) }}
    >
      <ScrollRegionContext.Provider value={viewport}>{children}</ScrollRegionContext.Provider>
    </SidebarContent>
  );
}
