/**
 * The v2 app shell — floating panels, sidebar, surface pane.
 *
 * Structure mirrors the shipped AppShell (window root → sidebar panel → surface
 * column) but drops everything that needs a live daemon: no runtime provider,
 * no overlay hosts, no session router. Those come back one at a time as the
 * surfaces they belong to are ported.
 *
 * Window geometry is imported, not cloned — `windowStyleGeometry` is the
 * three-style contract and it has no scale bug to fix.
 */
import type { WindowStyle } from '@/store/theme';
import { windowStyleGeometry } from '@/lib/appearance/window-style';
import { SidebarProvider, SidebarTrigger } from '@v2/components/ui/sidebar';
import { SessionSidebar } from '@v2/features/sessions/SessionSidebar';
import { cn } from '@v2/lib/utils';

function SurfacePlaceholder({ className }: { className: string }) {
  return (
    <div
      data-testid="v2-surface-chat"
      className={cn('flex flex-1 flex-col items-center justify-center gap-2', className)}
    >
      <p className="text-heading font-medium">Chat surface</p>
      <p className="max-w-[46ch] text-center text-body text-muted-foreground">
        Not ported yet. The sidebar is the first feature across; this pane exists so the shell has something to lay out
        against.
      </p>
    </div>
  );
}

export function V2Shell({ windowStyle = 'glass' }: { windowStyle?: WindowStyle }) {
  const geo = windowStyleGeometry(windowStyle);

  return (
    <SidebarProvider defaultOpen>
      <div
        data-window-style={windowStyle}
        data-testid="v2-window-root"
        className={cn('flex h-full flex-1 overflow-hidden font-sans text-foreground', geo.windowRoot)}
      >
        <SessionSidebar className={geo.sidebar} />

        <div
          data-testid="v2-main-pane"
          className={cn('relative flex min-w-0 flex-1 flex-col overflow-hidden', geo.pane)}
        >
          <header className={cn('flex h-11 shrink-0 items-center gap-2 px-2', geo.toolbar)}>
            <SidebarTrigger />
            <span className="text-body font-medium">mainframe</span>
            <span className="text-caption text-muted-foreground">design/ui-v2-clone</span>
          </header>

          <div className={cn('flex min-h-0 flex-1 flex-col', geo.workspaceInset)}>
            <SurfacePlaceholder className={geo.surface} />
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}
