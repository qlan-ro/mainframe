import * as React from 'react';
import { PanelLeftIcon } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { cn } from '@v2/lib/utils';
import { clampSidebarWidth, useSidebar } from './context';

type Collapsible = 'offcanvas' | 'icon' | 'none';

interface SidebarProps extends React.ComponentProps<'div'> {
  side?: 'left' | 'right';
  collapsible?: Collapsible;
}

function collapsedWidth(collapsible: Collapsible): string {
  return collapsible === 'icon' ? 'var(--sidebar-width-icon)' : '0px';
}

/**
 * The panel itself.
 *
 * Upstream positions this `fixed` at `h-svh` and reserves the space with a
 * sibling spacer div, because it assumes a page that scrolls behind an overlay.
 * Mainframe's shell is a row of panels inside a window, so this is a plain flex
 * child that animates its own width — the spacer, the `md:` breakpoints, the
 * floating/inset variants and the mobile Sheet all disappear with it.
 *
 * The data attributes are upstream's, unchanged: every descendant styles itself
 * off `group-data-[collapsible=icon]` / `[data-state]`, so keeping the contract
 * keeps the whole family portable.
 */
export function Sidebar({
  side = 'left',
  collapsible = 'offcanvas',
  className,
  children,
  style,
  ...props
}: SidebarProps) {
  const { state, resizing } = useSidebar();
  const collapsed = collapsible !== 'none' && state === 'collapsed';

  return (
    <div
      data-slot="sidebar"
      data-state={collapsible === 'none' ? 'expanded' : state}
      data-collapsible={collapsed ? collapsible : ''}
      data-side={side}
      className={cn(
        'group peer relative flex h-full shrink-0 flex-col overflow-hidden',
        'bg-sidebar text-sidebar-foreground',
        // A width transition mid-drag lags a frame behind the pointer.
        resizing ? 'transition-none' : 'transition-[width] duration-200 ease-linear',
        'border-sidebar-border data-[side=left]:border-r data-[side=right]:border-l',
        className,
      )}
      style={{ width: collapsed ? collapsedWidth(collapsible) : 'var(--sidebar-width)', ...style }}
      {...props}
    >
      {/* Pinned to the panel's full width so the contents don't reflow while it
          animates shut — they slide out of the clip instead. */}
      <div className="flex h-full w-(--sidebar-width) min-w-(--sidebar-width) flex-col group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:min-w-0">
        {children}
      </div>
    </div>
  );
}

export function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();

  return (
    <Button
      data-slot="sidebar-trigger"
      data-sidebar="trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

/** The edge strip: a wide invisible hit area over a hairline that lights on hover. */
/** Drag past this and the gesture is a resize, not a click on the rail. */
const DRAG_SLOP = 3;

/**
 * The panel's right edge: drag to resize, click to collapse.
 *
 * Both gestures share one target because the edge is where a user reaches for
 * either. A pointer that moved less than the slop is treated as a click, so a
 * resize that lands back where it started does not also toggle the panel.
 */
export function SidebarRail({ className, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar, setWidth, setResizing } = useSidebar();

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    // Measured, not read from state: until the first drag the width is whatever
    // `SIDEBAR_WIDTH` resolves to, and only the DOM knows that in px.
    const panel = event.currentTarget.closest('[data-slot="sidebar"]');
    if (panel == null) return;
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    let moved = false;
    setResizing(true);

    const onMove = (move: PointerEvent) => {
      const delta = move.clientX - startX;
      if (Math.abs(delta) > DRAG_SLOP) moved = true;
      if (moved) setWidth(clampSidebarWidth(startWidth + delta));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setResizing(false);
      if (!moved) toggleSidebar();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  return (
    <button
      data-slot="sidebar-rail"
      data-sidebar="rail"
      aria-label="Resize sidebar"
      tabIndex={-1}
      title="Drag to resize, click to collapse"
      onPointerDown={onPointerDown}
      className={cn(
        'absolute inset-y-0 z-20 w-2 transition-all ease-linear',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] after:-translate-x-1/2 after:bg-transparent',
        'hover:after:bg-sidebar-border',
        'group-data-[side=left]:right-0 group-data-[side=right]:left-0',
        'group-data-[side=left]:cursor-col-resize group-data-[side=right]:cursor-col-resize',
        'group-data-[state=collapsed]:group-data-[side=left]:cursor-e-resize',
        'group-data-[state=collapsed]:group-data-[side=right]:cursor-w-resize',
        className,
      )}
      {...props}
    />
  );
}

/** The content pane beside the sidebar. */
export function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn('relative flex min-w-0 flex-1 flex-col bg-background', className)}
      {...props}
    />
  );
}
