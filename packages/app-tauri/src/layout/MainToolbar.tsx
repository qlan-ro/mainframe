import { ChevronDown, GitBranch, Moon, PanelLeft, PanelRight, Play, Search, Sun } from 'lucide-react';
import { useTheme } from '@/store/theme';
import { useLayoutStore } from '@/store/layout';

interface MainToolbarProps {
  /** Collapsed traffic-light clearance applied to the left group (0 when the sidebar is shown). */
  leadingInset: number;
  /** Whether the sidebar panel is currently rendered (hides the in-flow show-sidebar button). */
  sidebarRendered: boolean;
  /** One-click expand from either collapsed state. */
  onExpandSidebar: () => void;
  projectName: string;
  branchName?: string;
}

const ICON_BTN =
  'inline-flex h-[22px] w-[26px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent text-muted-foreground cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

/** A gated chrome control: present (per the design) but disabled until its surface/subsystem lands. */
function StubButton({ testid, title, children }: { testid: string; title: string; children: React.ReactNode }) {
  return (
    <button
      data-testid={testid}
      type="button"
      title={`${title} — coming with its surface`}
      disabled
      className={`${ICON_BTN} cursor-not-allowed opacity-50 hover:bg-transparent`}
    >
      {children}
    </button>
  );
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
}: MainToolbarProps) {
  const mode = useTheme((s) => s.mode);
  const toggleTheme = useTheme((s) => s.toggle);
  const isDark = mode === 'dark';
  const inspectorVisible = useLayoutStore((s) => s.inspectorVisible);
  const toggleInspector = useLayoutStore((s) => s.toggleInspector);

  return (
    <div
      data-testid="main-toolbar"
      data-tauri-drag-region
      className="flex h-[38px] flex-shrink-0 items-center justify-between gap-2 bg-mf-tab-bar pr-1.5 [border-bottom:0.5px_solid_var(--border)]"
    >
      {/* Left: identity */}
      <div
        className="flex min-w-0 items-center gap-1.5 pl-2"
        style={leadingInset > 0 ? { paddingLeft: leadingInset } : undefined}
      >
        {!sidebarRendered && (
          <button
            data-testid="show-sidebar-button"
            type="button"
            title="Show sidebar"
            onClick={onExpandSidebar}
            className={ICON_BTN}
          >
            <PanelLeft size={14} />
          </button>
        )}
        <span className="flex min-w-0 items-center gap-1.5 text-caption font-semibold text-foreground">
          <span className="truncate">{projectName}</span>
          {branchName && (
            <>
              <span className="font-normal text-mf-text-4">|</span>
              <button
                data-testid="main-toolbar-branch"
                type="button"
                title="Switch branch — coming with its surface"
                disabled
                className="inline-flex min-w-0 max-w-[230px] cursor-not-allowed items-center gap-1.5 rounded-[6px] px-1.5 py-0.5 font-mono text-micro font-normal text-muted-foreground opacity-80"
              >
                <GitBranch size={11} className="flex-shrink-0 text-mf-text-3" />
                <span className="truncate">{branchName}</span>
                <ChevronDown size={8} className="flex-shrink-0 text-mf-text-4" />
              </button>
            </>
          )}
        </span>
      </div>

      {/* Right: controls */}
      <div className="flex flex-shrink-0 items-center gap-1">
        <StubButton testid="main-toolbar-search" title="Search (⌘O)">
          <Search size={14} />
        </StubButton>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <StubButton testid="main-toolbar-launch" title="Launch configurations">
          <ChevronDown size={12} />
        </StubButton>
        <StubButton testid="main-toolbar-play" title="Start">
          <Play size={12} />
        </StubButton>
        <span className="mx-0.5 h-4 w-px bg-border" />
        <button
          data-testid="main-toolbar-theme"
          type="button"
          title={isDark ? 'Switch to light' : 'Switch to dark'}
          onClick={toggleTheme}
          className={ICON_BTN}
        >
          {isDark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          data-testid="main-toolbar-inspector"
          type="button"
          title="Toggle inspector"
          aria-pressed={inspectorVisible}
          onClick={toggleInspector}
          className={`${ICON_BTN} ${inspectorVisible ? 'bg-mf-chip-bg text-foreground' : ''}`}
        >
          <PanelRight size={14} />
        </button>
      </div>
    </div>
  );
}
