import { useState } from 'react';
import { ChevronDown, FolderGit2, GitBranch, Moon, ScanSearch, Search, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/store/theme';
import { useUiPrefs } from '@/store/ui-prefs';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useDisplayBranch } from '@/features/sessions/use-display-branch';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { Button } from '@v2/components/ui/button';
import { Hint } from '@v2/components/ui/hint';
import { Separator } from '@v2/components/ui/separator';
import { Toggle } from '@v2/components/ui/toggle';
import { BranchPopover } from '../features/git/BranchPopover';
import { ToolbarLaunchControls } from '../features/run/ToolbarLaunchControls';
import { SurfaceRail } from './SurfaceRail';
import { SidebarLeftGlyph, SidebarRightGlyph } from './surface-icons';

interface MainToolbarProps {
  /** Collapsed traffic-light clearance applied to the left group (0 when the sidebar is shown). */
  leadingInset: number;
  /** Whether the sidebar panel is currently rendered (hides the in-flow show-sidebar button). */
  sidebarRendered: boolean;
  /** One-click expand from either collapsed state. */
  onExpandSidebar: () => void;
  projectName: string;
  branchName?: string;
  /** Whether the active session runs in a git worktree (vs. the shared main repo). */
  isWorktree?: boolean;
  port: number;
  projectId?: string;
  chatId?: string;
}

const CHIP =
  'inline-flex h-6 min-w-0 max-w-[230px] items-center gap-1 rounded-md border px-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * Worktree vs main-repo chip styling — mirrors the Workspace Surfaces artboard
 * (02-chrome.jsx MainToolbar). Worktree: accent border + tint, foreground text;
 * main-repo: transparent border (no layout shift), neutral hover. Both keep the
 * open popover state subtle — the main-repo chip never turns accent.
 */
function chipClass(open: boolean, isWorktree: boolean): string {
  if (isWorktree) {
    return cn('border-primary/25 text-foreground', open ? 'bg-primary/15' : 'bg-primary/8 hover:bg-primary/12');
  }
  return cn('border-transparent text-muted-foreground', open ? 'bg-muted' : 'hover:bg-muted');
}

/** Shared chip innards — the interactive trigger and the disabled stub render identically. */
function BranchChipContent({ branch, isWorktree }: { branch: string; isWorktree: boolean }) {
  return (
    <>
      {/* Primary glyphs run 16px across the title bar — the sidebar header's
          icon size; only secondary chevrons stay 12px. */}
      {isWorktree ? (
        <FolderGit2 className="size-4 shrink-0 text-primary" />
      ) : (
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{branch}</span>
      {isWorktree && (
        <span
          data-testid="main-toolbar-branch-wt"
          className="inline-flex h-4 shrink-0 items-center rounded-sm bg-primary/12 px-1 text-xs font-semibold tracking-wide text-primary uppercase"
        >
          wt
        </span>
      )}
      <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
    </>
  );
}

/**
 * Shell-level surface-area toolbar (above SurfaceHost): project · branch identity
 * on the left, workspace controls (search · advisor · launch · surfaces · theme ·
 * inspector) on the right.
 */
export function MainToolbar({
  leadingInset,
  sidebarRendered,
  onExpandSidebar,
  projectName,
  branchName,
  isWorktree = false,
  port,
  projectId,
  chatId,
}: MainToolbarProps) {
  const [branchOpen, setBranchOpen] = useState(false);
  const mode = useTheme((s) => s.mode);
  const toggleTheme = useTheme((s) => s.toggle);
  const isDark = mode === 'dark';
  const inspectorVisible = useUiPrefs((s) => s.inspectorVisible);
  const toggleInspector = useUiPrefs((s) => s.toggleInspector);
  const openSetupAdvisor = useSetupAdvisor((s) => s.openSheet);

  // The chip shows for EVERY session, not just worktrees — see use-display-branch
  // for why that needs a live git read. `refetch` is the popover-write path: a
  // BranchPopover write broadcasts no `chat.updated`, so nothing else invalidates
  // it. The popover itself stays off for a worktree draft — useBranchActions
  // without a chatId would mutate the ROOT repo while the chip advertises
  // worktree isolation.
  const {
    branch: displayBranch,
    isDraftWorktree,
    refetch: handleBranchChanged,
  } = useDisplayBranch({ port, projectId, chatId, branchName, isWorktree });

  return (
    <div
      data-testid="main-toolbar"
      data-drag-region
      // The hairline is an inset shadow, not border-b: a border eats 1px of the
      // content box and shifts the centered row to a 23.5px midline, off the
      // sidebar header's 24px.
      className="flex h-12 shrink-0 items-center justify-between gap-2 bg-background pr-3 [box-shadow:inset_0_-1px_var(--border)]"
    >
      {/* Left: identity */}
      <div
        className="flex min-w-0 items-center gap-2 pl-2"
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
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold tracking-tight text-foreground">
          <span className="truncate">{projectName}</span>
          {displayBranch && (
            <>
              <Separator orientation="vertical" className="h-3.5" />
              {displayBranch && projectId && !isDraftWorktree ? (
                <BranchPopover
                  port={port}
                  projectId={projectId}
                  chatId={chatId}
                  open={branchOpen}
                  onOpenChange={setBranchOpen}
                  onBranchChanged={handleBranchChanged}
                  triggerLabel={isWorktree ? 'Switch branch · worktree' : 'Switch branch · main repo'}
                >
                  {/* Bare trigger — BranchPopover wraps this in Hint itself (via
                      triggerLabel), around DropdownMenuTrigger. Wrapping Hint here
                      would interpose a non-forwarding component inside the asChild
                      clone, dropping the ref Radix needs to anchor the menu (see
                      BranchPopover.tsx's file header). */}
                  <button
                    data-testid="main-toolbar-branch"
                    data-worktree={isWorktree ? 'true' : 'false'}
                    type="button"
                    onClick={() => setBranchOpen((o) => !o)}
                    className={cn(CHIP, 'cursor-pointer', chipClass(branchOpen, isWorktree))}
                  >
                    <BranchChipContent branch={displayBranch} isWorktree={isWorktree} />
                  </button>
                </BranchPopover>
              ) : (
                <Hint
                  label={
                    isDraftWorktree
                      ? 'Branch actions unlock on first message'
                      : 'Switch branch — coming with its surface'
                  }
                >
                  <button
                    data-testid="main-toolbar-branch"
                    data-worktree={isWorktree ? 'true' : 'false'}
                    type="button"
                    disabled
                    className={cn(
                      CHIP,
                      'cursor-not-allowed opacity-80',
                      isWorktree ? 'border-primary/25 bg-primary/8 text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <BranchChipContent branch={displayBranch} isWorktree={isWorktree} />
                  </button>
                </Hint>
              )}
            </>
          )}
        </span>
      </div>

      {/* Right: controls — the artboard's three groups: search │ project tools
          (Setup Advisor · launch · play) │ workspace (surfaces · theme · inspector). */}
      <div className="flex shrink-0 items-center gap-0.5">
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
        {/* Launch picker ("Preview" dropdown) + run button, wired to the launch subsystem. */}
        <ToolbarLaunchControls port={port} projectId={projectId} chatId={chatId} />
        <Separator orientation="vertical" className="mx-1 h-4" />
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
        <Hint label="Toggle inspector">
          <Toggle
            data-testid="main-toolbar-inspector"
            size="sm"
            pressed={inspectorVisible}
            onPressedChange={toggleInspector}
            // Pressed chrome keys off the store flag, not data-[state=on] — the Hint's
            // TooltipTrigger asChild overwrites data-state with the tooltip's open-state.
            className={cn(
              'size-8 min-w-8 p-0',
              inspectorVisible ? 'bg-accent text-foreground' : 'text-muted-foreground',
            )}
          >
            <SidebarRightGlyph size={16} />
          </Toggle>
        </Hint>
      </div>
    </div>
  );
}
