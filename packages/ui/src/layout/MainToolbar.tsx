import { Moon, ScanSearch, Search, Sun } from 'lucide-react';
import { useTheme } from '@/store/theme';
import { useLayoutStore } from '@/store/layout';
import { useUiPrefs } from '@/store/ui-prefs';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { Separator } from '@v2/components/ui/separator';
import { Toggle } from '@v2/components/ui/toggle';
import { cn } from '@/lib/utils';
import { BranchChip } from '../features/git/BranchChip';
import { SessionTabs } from '../features/session-tabs/SessionTabs';
import { SurfaceRail } from './SurfaceRail';
import { SidebarLeftGlyph, SidebarRightGlyph } from './surface-icons';

interface MainToolbarProps {
  /** Collapsed traffic-light clearance applied to the left group (0 when the sidebar is shown). */
  leadingInset: number;
  /** Whether the sidebar panel is currently rendered (hides the in-flow show-sidebar button). */
  sidebarRendered: boolean;
  /** One-click expand from either collapsed state. */
  onExpandSidebar: () => void;
  branchName?: string;
  /** Whether the active session runs in a git worktree (vs. the shared main repo). */
  isWorktree?: boolean;
  port: number;
  projectId?: string;
  chatId?: string;
}

/**
 * Shell-level surface-area toolbar (above SurfaceHost): chrome-style session
 * tabs across the middle (the active session is the focused tab), workspace
 * controls (branch chip · search · advisor · surfaces · theme · files) on the
 * right. The old left identity section (project name + branch chip) is gone —
 * the sidebar and the session panel carry project context, and the branch
 * manager moved into the right cluster
 * (docs/plans/2026-08-08-session-tabs-and-workspace-files.md).
 */
export function MainToolbar({
  leadingInset,
  sidebarRendered,
  onExpandSidebar,
  branchName,
  isWorktree = false,
  port,
  projectId,
  chatId,
}: MainToolbarProps) {
  const mode = useTheme((s) => s.mode);
  const toggleTheme = useTheme((s) => s.toggle);
  const isDark = mode === 'dark';
  const filesCollapsed = useUiPrefs((s) => s.workspaceFilesCollapsed);
  // Pressed = the tree is ON SCREEN: expanded AND its host surface lit. The
  // intent handler applies the same rule, so the toggle never collapses an
  // invisible tree (see intent-subscriber's toggle-workspace-files).
  const workspaceLit = useLayoutStore((s) => s.layout.top.includes('workspace') || s.layout.bottom === 'workspace');
  const filesOnScreen = !filesCollapsed && workspaceLit;
  const openSetupAdvisor = useSetupAdvisor((s) => s.openSheet);

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

      {/* Right: controls — branch │ search │ project tools │ workspace. */}
      <div className="flex shrink-0 items-center gap-0.5">
        <BranchChip port={port} projectId={projectId} chatId={chatId} branchName={branchName} isWorktree={isWorktree} />
        <Hint label="Search (⌘O)">
          <Button
            data-testid="main-toolbar-search"
            variant="ghost"
            size="sm"
            onClick={() => emitSurfaceIntent({ type: 'open-search-palette' })}
            className="text-muted-foreground"
          >
            <Search className="size-4" />
            <kbd
              data-testid="main-toolbar-search-hint"
              className="pointer-events-none inline-flex items-center rounded-sm border bg-muted px-1 font-mono text-sm font-medium text-muted-foreground"
            >
              ⌘O
            </kbd>
          </Button>
        </Hint>
        <Separator orientation="vertical" className="mx-1 h-4" />
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
        <Hint label="Toggle files">
          <Toggle
            data-testid="main-toolbar-files"
            size="sm"
            pressed={filesOnScreen}
            // Routed through the intent so showing also lights the workspace
            // surface — an expanded tree inside a hidden surface shows nothing.
            onPressedChange={() => emitSurfaceIntent({ type: 'toggle-workspace-files' })}
            // Pressed chrome keys off the store flag, not data-[state=on] — the Hint's
            // TooltipTrigger asChild overwrites data-state with the tooltip's open-state.
            className={cn('size-8 min-w-8 p-0', filesOnScreen ? 'bg-accent text-foreground' : 'text-muted-foreground')}
          >
            <SidebarRightGlyph size={16} />
          </Toggle>
        </Hint>
      </div>
    </div>
  );
}
