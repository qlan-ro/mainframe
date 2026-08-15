import { Moon, ScanSearch, Search, Sun } from 'lucide-react';
import { useTheme } from '@/store/theme';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { Separator } from '@/components/ui/separator';
import { chordHint } from '@/features/shortcuts/chord-hint';
import { SessionTabs } from '../features/session-tabs/SessionTabs';
import { SurfaceRail } from './SurfaceRail';
import { SidebarLeftGlyph } from './surface-icons';

interface MainToolbarProps {
  /** Collapsed traffic-light clearance applied to the left group (0 when the sidebar is shown). */
  leadingInset: number;
  /** Whether the sidebar panel is currently rendered (hides the in-flow show-sidebar button). */
  sidebarRendered: boolean;
  /** One-click expand from either collapsed state. */
  onExpandSidebar: () => void;
  projectId?: string;
}

/**
 * Shell-level surface-area toolbar (above SurfaceHost): chrome-style session
 * tabs across the middle (the active session is the focused tab), workspace
 * controls (search · advisor · surfaces · theme) on the right.
 * The old left identity section (project name + branch chip) is gone — the
 * sidebar and the session panel carry project context. Branch management left
 * the chrome entirely: it lives on the welcome screen and on the session
 * panel's branch row. The Files control lives on the workspace strip itself
 * (WorkspaceStripChrome), not here
 * (docs/plans/2026-08-08-session-tabs-and-workspace-files.md).
 */
export function MainToolbar({ leadingInset, sidebarRendered, onExpandSidebar, projectId }: MainToolbarProps) {
  const resolvedMode = useTheme((s) => s.resolvedMode);
  const toggleTheme = useTheme((s) => s.toggle);
  const isDark = resolvedMode === 'dark';
  const openSetupAdvisor = useSetupAdvisor((s) => s.openSheet);
  const searchChord = chordHint('app.search-palette');

  return (
    <div
      data-testid="main-toolbar"
      data-drag-region
      // The hairline is an inset shadow, not border-b: a border eats 1px of the
      // content box and shifts the centered row to a 23.5px midline, off the
      // sidebar header's 24px.
      className="flex h-12 shrink-0 items-center gap-2 bg-background pr-3 [box-shadow:inset_0_-1px_var(--border)]"
    >
      {/* Left: sidebar affordance only (identity left the chrome). */}
      <div
        className="flex shrink-0 items-center pl-2"
        style={leadingInset > 0 ? { paddingLeft: leadingInset } : undefined}
      >
        {!sidebarRendered && (
          <Hint label="Show sidebar">
            <Button
              data-testid="show-sidebar-button"
              variant="ghost"
              size="icon-sm"
              onClick={onExpandSidebar}
              className="text-muted-foreground"
            >
              <SidebarLeftGlyph size={16} />
            </Button>
          </Hint>
        )}
      </div>

      {/* Middle: the session tab strip (its trailing slack stays a drag region). */}
      <SessionTabs />

      {/* Right: controls — search │ project tools │ workspace. */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Hint label={searchChord == null ? 'Search' : `Search (${searchChord})`}>
          <Button
            data-testid="main-toolbar-search"
            variant="ghost"
            size="sm"
            onClick={() => emitSurfaceIntent({ type: 'open-search-palette' })}
            className="text-muted-foreground"
          >
            <Search className="size-4" />
            {/* No chip at all when the action is unassigned — an empty kbd box
                reads as a broken control rather than an absent shortcut. */}
            {searchChord != null && (
              <kbd
                data-testid="main-toolbar-search-hint"
                className="pointer-events-none inline-flex items-center rounded-sm border bg-muted px-1 font-mono text-sm font-medium text-muted-foreground"
              >
                {searchChord}
              </kbd>
            )}
          </Button>
        </Hint>
        <Separator orientation="vertical" className="mx-1 h-4 data-vertical:self-center" />
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
        <SurfaceRail />
        <Hint label={isDark ? 'Switch to light' : 'Switch to dark'}>
          <Button
            data-testid="main-toolbar-theme"
            variant="ghost"
            size="icon-sm"
            onClick={toggleTheme}
            className="text-muted-foreground"
          >
            {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </Hint>
      </div>
    </div>
  );
}
