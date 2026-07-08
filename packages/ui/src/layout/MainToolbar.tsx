import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, GitBranch, GitFork, Moon, Search, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type WindowStyle } from '@/store/theme';
import { useUiPrefs } from '@/store/ui-prefs';
import { windowStyleGeometry } from '@/lib/appearance/window-style';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { getGitBranch } from '@/lib/api/git';
import { BranchPopover } from '../features/git/BranchPopover';
import { ToolbarLaunchControls } from '../features/run/ToolbarLaunchControls';
import { SurfaceRail } from './SurfaceRail';
import { SidebarLeftGlyph, SidebarRightGlyph } from './surface-icons';
import { Hint } from '@/components/ui/hint';

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
  windowStyle: WindowStyle;
  port: number;
  projectId?: string;
  chatId?: string;
}

const ICON_BTN =
  'inline-flex h-[24px] w-[28px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent text-muted-foreground cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

const CHIP_BASE =
  'inline-flex h-[22px] min-w-0 max-w-[230px] items-center gap-[5px] rounded-[6px] border-[0.5px] border-solid px-[6px] font-mono text-caption font-normal';

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
  return cn('border-transparent text-muted-foreground', open ? 'bg-accent' : 'hover:bg-accent');
}

/**
 * Shell-level surface-area toolbar (above SurfaceHost): project · branch identity
 * on the left, workspace controls on the right. Wired: the in-flow show-sidebar
 * button (collapsed only) + the light/dark theme toggle. Search / launch / play /
 * inspector / branch-switch are gated stubs until their subsystems exist.
 */
export function MainToolbar({
  leadingInset,
  sidebarRendered,
  onExpandSidebar,
  projectName,
  branchName,
  isWorktree = false,
  windowStyle,
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
  const geo = windowStyleGeometry(windowStyle);

  // Read the live current branch from git so the chip shows for EVERY session,
  // not just worktrees: a main-repo session has no persisted `chat.branchName`,
  // so without this fetch the whole chip disappears. Re-runs on identity change
  // (fresh, cancellation-guarded so a late response from a previous chat can't
  // leak) and after a popover write via handleBranchChanged — BranchPopover
  // writes don't broadcast `chat.updated`, so the prop alone would go stale.
  const [liveBranch, setLiveBranch] = useState<string | undefined>(undefined);
  useEffect(() => {
    setLiveBranch(undefined);
    if (!projectId) return;
    let cancelled = false;
    getGitBranch(port, projectId, chatId)
      .then(({ branch }) => {
        if (!cancelled) setLiveBranch(branch ?? undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) console.warn('[MainToolbar] failed to read current branch', err);
      });
    return () => {
      cancelled = true;
    };
  }, [port, projectId, chatId, branchName]);
  const handleBranchChanged = useCallback(() => {
    if (!projectId) return;
    getGitBranch(port, projectId, chatId)
      .then(({ branch }) => setLiveBranch(branch ?? undefined))
      .catch((err: unknown) => {
        console.warn('[MainToolbar] failed to refresh branch after popover write', err);
      });
  }, [port, projectId, chatId]);
  const displayBranch = liveBranch ?? branchName;

  return (
    <div
      data-testid="main-toolbar"
      data-drag-region
      className={`flex h-[40px] flex-shrink-0 items-center justify-between gap-2 pr-[12px] ${geo.toolbar}`}
    >
      {/* Left: identity */}
      <div
        className="flex min-w-0 items-center gap-[8px] pl-[8px]"
        style={leadingInset > 0 ? { paddingLeft: leadingInset } : undefined}
      >
        {!sidebarRendered && (
          <Hint label="Show sidebar">
            <button data-testid="show-sidebar-button" type="button" onClick={onExpandSidebar} className={ICON_BTN}>
              <SidebarLeftGlyph size={14} />
            </button>
          </Hint>
        )}
        <span className="flex min-w-0 items-center gap-[5px] text-body font-semibold tracking-tight text-foreground">
          <span className="truncate">{projectName}</span>
          {displayBranch && (
            <>
              <span className="font-normal text-mf-text-4">|</span>
              {displayBranch && projectId ? (
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
                      triggerLabel), around PopoverTrigger. Wrapping Hint here would
                      interpose a non-forwarding component inside PopoverTrigger's
                      asChild clone, dropping the ref Popper needs to position the
                      content (see BranchPopover.tsx's file header). */}
                  <button
                    data-testid="main-toolbar-branch"
                    data-worktree={isWorktree ? 'true' : 'false'}
                    type="button"
                    onClick={() => setBranchOpen((o) => !o)}
                    className={cn(CHIP_BASE, 'cursor-pointer', chipClass(branchOpen, isWorktree))}
                  >
                    {isWorktree ? (
                      <GitFork size={11} className="flex-shrink-0 text-primary" />
                    ) : (
                      <GitBranch size={11} className="flex-shrink-0 text-mf-text-3" />
                    )}
                    <span className="truncate">{displayBranch}</span>
                    {isWorktree && (
                      <span
                        data-testid="main-toolbar-branch-wt"
                        className="ml-[1px] inline-flex h-[14px] flex-shrink-0 items-center rounded-[4px] bg-primary/12 px-[5px] text-micro font-semibold uppercase tracking-wide text-primary"
                      >
                        wt
                      </span>
                    )}
                    <ChevronDown size={8} className="flex-shrink-0 text-mf-text-4" />
                  </button>
                </BranchPopover>
              ) : (
                <Hint label="Switch branch — coming with its surface">
                  <button
                    data-testid="main-toolbar-branch"
                    data-worktree={isWorktree ? 'true' : 'false'}
                    type="button"
                    disabled
                    className={cn(CHIP_BASE, 'cursor-not-allowed text-muted-foreground opacity-80')}
                  >
                    <GitBranch size={11} className="flex-shrink-0 text-mf-text-3" />
                    <span className="truncate">{displayBranch}</span>
                    <ChevronDown size={8} className="flex-shrink-0 text-mf-text-4" />
                  </button>
                </Hint>
              )}
            </>
          )}
        </span>
      </div>

      {/* Right: controls — order mirrors the artboard (search → launch → play → surfaces → theme → inspector). */}
      <div className="flex flex-shrink-0 items-center gap-[4px]">
        <Hint label="Search (⌘O)">
          <button
            data-testid="main-toolbar-search"
            type="button"
            onClick={() => emitSurfaceIntent({ type: 'open-search-palette' })}
            className={`${ICON_BTN} h-[24px] w-auto gap-[6px] pl-[7px] pr-[6px]`}
          >
            <Search size={14} />
            <span
              data-testid="main-toolbar-search-hint"
              className="inline-flex h-[17px] items-center rounded-[4px] bg-background px-[5px] text-caption font-semibold leading-none text-muted-foreground [border:0.5px_solid_var(--border)] shadow-[var(--mf-shadow-keycap)]"
            >
              ⌘O
            </span>
          </button>
        </Hint>
        <span className="mx-[4px] h-[16px] w-px bg-border" />
        {/* Launch picker ("Preview" dropdown) + run button, wired to the launch subsystem. */}
        <ToolbarLaunchControls port={port} projectId={projectId} chatId={chatId} />
        <span className="mx-[4px] h-[16px] w-px bg-border" />
        <SurfaceRail />
        <Hint label={isDark ? 'Switch to light' : 'Switch to dark'}>
          <button data-testid="main-toolbar-theme" type="button" onClick={toggleTheme} className={ICON_BTN}>
            {isDark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </Hint>
        <Hint label="Toggle inspector">
          <button
            data-testid="main-toolbar-inspector"
            type="button"
            aria-pressed={inspectorVisible}
            onClick={toggleInspector}
            className={`${ICON_BTN} ${inspectorVisible ? 'bg-mf-chip text-foreground' : ''}`}
          >
            <SidebarRightGlyph size={14} />
          </button>
        </Hint>
      </div>
    </div>
  );
}
