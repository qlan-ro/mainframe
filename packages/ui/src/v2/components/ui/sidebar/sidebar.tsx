import * as React from 'react';
import { PanelLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@v2/lib/utils';
import { useSidebar } from './context';

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
 * Upstream positions this `fixed` and reserves the space with a sibling spacer
 * div, because it assumes a page that scrolls behind an overlay. Mainframe's
 * shell is a row of floating panels, so this is a plain flex child that
 * animates its own width — the spacer, the `md:` breakpoints and the mobile
 * Sheet all disappear with it.
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
  const { state } = useSidebar();
  const collapsed = collapsible !== 'none' && state === 'collapsed';

  return (
    <div
      data-slot="sidebar"
      data-state={collapsible === 'none' ? 'expanded' : state}
      data-collapsible={collapsed ? collapsible : ''}
      data-side={side}
      className={cn(
        'group peer relative flex h-full shrink-0 flex-col overflow-hidden',
        'bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out',
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
      data-testid="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn('size-7', className)}
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
export function SidebarRail({ className, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      data-slot="sidebar-rail"
      data-testid="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      title="Toggle Sidebar"
      onClick={toggleSidebar}
      className={cn(
        'absolute inset-y-0 z-20 w-2 transition-colors',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent',
        'hover:after:bg-sidebar-border',
        'group-data-[side=left]:right-0 group-data-[side=right]:left-0',
        'group-data-[side=left]:cursor-w-resize group-data-[side=right]:cursor-e-resize',
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
