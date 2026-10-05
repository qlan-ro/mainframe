/**
 * TitleBarActions — the title bar's right cluster: search · Setup Advisor │
 * fork-parent link · side-chat toggle (single view only — in a split those
 * two live on each zone's `ZoneStrip`) · the session-details toggle.
 */
import { ScanSearch, Search } from 'lucide-react';
import { useAuiState } from '@assistant-ui/react';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { chordHint } from '@/features/shortcuts/chord-hint';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { ChatHeaderParentLink } from '@/features/chat/thread/ChatHeaderParentLink';
import { SessionPanelToggle } from '@/features/session-panel/SessionPanelToggle';
import { splitVisible, useZonesStore } from '@/features/chat/zones/zones-store';
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

export function TitleBarActions({ projectId }: { projectId?: string }) {
  const openSetupAdvisor = useSetupAdvisor((s) => s.openSheet);
  const searchChord = chordHint('app.search-palette');
  const layout = useLayoutStore((s) => s.layout);
  const filesScopeKey = useActiveBasesStore((s) => s.scopeKey);
  const filesOpen = useWorkspaceFilesPanel((s) => isWorkspaceFilesPanelOpen(s.openByScope, filesScopeKey));
  const shiftForFilesSidebar = filesOpen && isWorkspaceSidebarAtRightEdge(layout);
  const zones = useZonesStore((s) => s.zones);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const splitOnScreen = splitVisible(zones, mainThreadId);

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
      {projectId && (
        <Hint label="Setup Advisor">
          <Button
            data-testid="automation-recommender-open"
            variant="ghost"
            size="icon-sm"
            onClick={() => openSetupAdvisor()}
            className="text-muted-foreground"
          >
            <ScanSearch className="size-4" />
          </Button>
        </Hint>
      )}
      <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
      {/* Bound to the main thread through the root provider; a split moves both onto the zones' strips. */}
      {!splitOnScreen && <ChatHeaderParentLink />}
      <SessionPanelToggle />
    </div>
  );
}
