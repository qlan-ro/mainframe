/**
 * The v2 app shell — sidebar plus surface pane.
 *
 * Structure mirrors the shipped AppShell (window root → sidebar → surface
 * column) but drops everything that needs a live daemon: no runtime provider,
 * no overlay hosts, no session router. Those come back one at a time as the
 * surfaces they belong to are ported.
 *
 * The shipped app's three window styles (glass / unified / split) are gone with
 * the rest of the custom layer — one geometry until a second one earns itself.
 */
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@v2/components/ui/sidebar';
import { SessionSidebar } from '@v2/features/sessions/SessionSidebar';

function SurfacePlaceholder() {
  return (
    <div data-testid="v2-surface-chat" className="flex flex-1 flex-col items-center justify-center gap-2">
      <p className="text-lg font-medium">Chat surface</p>
      <p className="max-w-[46ch] text-center text-sm text-muted-foreground">
        Not ported yet. The sidebar is the first feature across; this pane exists so the shell has something to lay out
        against.
      </p>
    </div>
  );
}

export function V2Shell() {
  return (
    <SidebarProvider defaultOpen>
      <div data-testid="v2-window-root" className="flex h-full flex-1 overflow-hidden font-sans text-foreground">
        <SessionSidebar />

        <SidebarInset data-testid="v2-main-pane" className="overflow-hidden">
          <header className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
            <SidebarTrigger />
            <span className="text-sm font-medium">mainframe</span>
            <span className="text-xs text-muted-foreground">design/ui-v2-clone</span>
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            <SurfacePlaceholder />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
