/**
 * TitleBarActions — the title bar's right cluster: search │ side-chat toggle
 * (the focused chat's) · the session-details toggle. The "Forked from" link
 * lives in each chat column's header (ChatColumnHeader). The Setup Advisor
 * button moved to the nav rail (D8) — it's a rail view now, not a sheet.
 */
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { chordHint } from '@/features/shortcuts/chord-hint';
import { SideChatToggle } from '@/features/side-chat/SideChatToggle';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useLayoutStore } from '@/store/layout';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { isWorkspaceFilesPanelOpen, useWorkspaceFilesPanel } from '@/store/workspace-files-panel';

/**
 * True when the workspace surface's docked Files sidebar sits flush against
 * the window's right edge — the workspace is the bottom strip, or the
 * rightmost (or only) top column. The cluster then nudges left so it reads as
 * making room for the panel rather than sitting jammed on its corner.
 */
function isWorkspaceSidebarAtRightEdge(layout: { top: string[]; bottom: string | null }): boolean {
  if (layout.bottom === 'workspace') return true;
  return layout.top[layout.top.length - 1] === 'workspace';
}

export function TitleBarActions() {
  const searchChord = chordHint('app.search-palette');
  const layout = useLayoutStore((s) => s.layout);
  const filesScopeKey = useActiveBasesStore((s) => s.scopeKey);
  const filesOpen = useWorkspaceFilesPanel((s) => isWorkspaceFilesPanelOpen(s.openByScope, filesScopeKey));
  const shiftForFilesSidebar = filesOpen && isWorkspaceSidebarAtRightEdge(layout);

  return (
    <div
      data-testid="title-bar-actions"
      className={cn('flex shrink-0 items-center gap-0.5', shiftForFilesSidebar && 'mr-2')}
    >
      <Hint label={searchChord == null ? 'Search' : `Search (${searchChord})`}>
        <Button
          data-testid="main-toolbar-search"
          data-tut="search"
          variant="ghost"
          size="icon-sm"
          onClick={() => emitSurfaceIntent({ type: 'open-search-palette' })}
          className="text-muted-foreground"
        >
          <Search className="size-4" />
        </Button>
      </Hint>
      <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
      {/* The focused chat's side chat (the root provider follows the focused zone). */}
      <SideChatToggle />
    </div>
  );
}
